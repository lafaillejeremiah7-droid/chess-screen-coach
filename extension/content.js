/* Chess coach overlay: reads pieces from DOM, never captures pixels. */
(function(){
  "use strict";
  const reader=globalThis.ChessCoachBoard;
  if(!reader)return;
  const INITIAL=reader.initial+" w KQkq - 0 1";
  const SETTLE_MS=180, RETRY_MS=10000;
  let currentFen=null,lastPlacement=null,currentBoard=null,lastColor=null;
  let lastText="",settledText=null,healthChecked=false,analysisPending=false,rejectedPosition=null;
  let processing=false,dirty=false,generation=0,retryAt=0,badSnapshots=0;
  let observer=null,workTimer=null,watchTimer=null,lastPath=location.pathname;
  let lockedPlayerColor=null,coachHidden=false,lastToggleAt=0;
  const settings={playerSide:"auto",thinkSeconds:1,strengthElo:1650,showDetails:false,coachHidden:false};
  function applySettings(values){
    if(!values)return;
    settings.playerSide=["auto","w","b"].includes(values.playerSide)?values.playerSide:"auto";
    settings.thinkSeconds=[0.2,0.5,1,2].includes(values.thinkSeconds)?values.thinkSeconds:1;
    settings.strengthElo=values.strengthElo==="full"?"full":
      Number.isInteger(values.strengthElo)&&values.strengthElo>=1320&&values.strengthElo<=3190?
        values.strengthElo:1650;
    const slider=document.getElementById("chess-study-elo-range");
    if(slider)slider.value=String(settings.strengthElo==="full"?3190:settings.strengthElo);
    const value=document.getElementById("chess-study-elo-value");
    if(value)value.textContent=String(settings.strengthElo==="full"?"Full":settings.strengthElo);
    settings.showDetails=values.showDetails===true;
    settings.coachHidden=values.coachHidden===true;
    setCoachHidden(settings.coachHidden);
    // Discard results computed under an old strength while a request is pending.
    generation++;dirty=true;
    analysisPending=true;settledText=null;retryAt=0;
    schedule(0);
  }
  function playerColor(snapshot){
    if(settings.playerSide!=="auto")return settings.playerSide;
    if(snapshot.playerColor==="w"||snapshot.playerColor==="b")return snapshot.playerColor;
    // Orientation is only an initial fallback, never re-infer after a flip.
    if(!lockedPlayerColor)lockedPlayerColor=snapshot.bottomColor||snapshot.myColor||null;
    return lockedPlayerColor;
  }
  function displayInstruction(answer){
    if(!settings.showDetails||
       !/^\/(?:analysis|play\/computer|puzzles)(?:\/|$)/.test(location.pathname))
      return answer.instruction;
    const parts=[answer.instruction];
    if(answer.reason)parts.push(answer.reason);
    if(Number.isInteger(answer.depth))parts.push("Depth "+answer.depth);
    if(Number.isInteger(answer.mate_in))parts.push("Mate in "+answer.mate_in+" (side to move)");
    else if(typeof answer.score_cp==="number")parts.push("Eval "+(answer.score_cp/100).toFixed(2)+" (side to move)");
    return parts.join(" | ");
  }

  function eligible(){
    return location.protocol==="https:"&&
      (location.hostname==="www.chess.com"||location.hostname==="chess.com")&&
      /^\/(?:analysis|play\/computer|puzzles)(?:\/|$)/.test(location.pathname);
  }
  // Route-independent visibility: supported Chess.com pages use the same coach controls.
  const active=()=>eligible()&&!document.hidden&&!coachHidden;
  const current=epoch=>active()&&epoch===generation;

  function show(message){
    if(!active())return;
    let element=document.getElementById("chess-study-no-share-overlay");
    if(!element){
      element=document.createElement("div");
      element.id="chess-study-no-share-overlay";
      const text=document.createElement("div");
      text.id="chess-study-no-share-message";
      text.setAttribute("role","status");
      text.setAttribute("aria-live","polite");
      element.appendChild(text);
      const label=document.createElement("label");
      label.id="chess-study-elo-control";
      label.textContent="Strength: ";
      const output=document.createElement("output");
      output.id="chess-study-elo-value";
      output.textContent=String(settings.strengthElo==="full"?"Full":settings.strengthElo);
      const input=document.createElement("input");
      input.id="chess-study-elo-range";
      input.type="range";input.min="1320";input.max="3190";input.step="10";
      input.value=String(settings.strengthElo==="full"?3190:settings.strengthElo);
      input.setAttribute("aria-label","Approximate Stockfish practice Elo");
      input.addEventListener("input",()=>{output.textContent=input.value;});
      input.addEventListener("change",()=>{
        const elo=Number(input.value);
        if(Number.isInteger(elo)&&elo>=1320&&elo<=3190)
          chrome.storage?.local?.set?.({strengthElo:elo});
      });
      label.append(output,input);
      element.appendChild(label);
      document.body.appendChild(element);
    }
    if(message!==lastText){
      element.querySelector("#chess-study-no-share-message").textContent=message;
      lastText=message;
    }
  }

  function reset(){
    generation++;
    observer?.disconnect();observer=null;
    currentFen=null;lastPlacement=null;currentBoard=null;lastColor=null;
    healthChecked=false;analysisPending=false;rejectedPosition=null;retryAt=0;
    lastText="";settledText=null;badSnapshots=0;lockedPlayerColor=null;
    document.getElementById("chess-study-no-share-overlay")?.remove();
  }

  function schedule(delay=SETTLE_MS){
    if(!active())return;
    clearTimeout(workTimer);
    workTimer=setTimeout(()=>{workTimer=null;void tick();},delay);
  }

  function watchBoard(board){
    observer?.disconnect();
    // Observe only this board, not clocks, chat, ads, or our overlay.
    observer=new MutationObserver(()=>schedule());
    observer.observe(board,{childList:true,subtree:true,attributes:true,attributeFilter:["class","style","data-piece","data-square","data-fen","data-orientation"]});
  }

  function retry(message, delay=RETRY_MS){
    show(message);
    retryAt=Date.now()+delay;
    schedule(delay);
  }

  function request(action,data={}){
    return new Promise(resolve=>{
      try{
        chrome.runtime.sendMessage({action,...data}, response=>{
          if(chrome.runtime.lastError){
            resolve({ok:false,error:chrome.runtime.lastError.message});return;
          }
          resolve(response||{ok:false,error:"No response from local Python server"});
        });
      }catch{
        resolve({ok:false,error:"Extension updated. Reload this chess tab."});
      }
    });
  }

  function unchanged(epoch,snapshot){
    if(!current(epoch))return false;
    let latest=null;
    try{latest=reader.snapshot(document);}catch{}
    // Identical pieces can represent different positions: compare full FEN and
    // move history as well as orientation before displaying an engine response.
    return latest&&latest.board===snapshot.board&&latest.placement===snapshot.placement&&
      latest.bottomColor===snapshot.bottomColor&&latest.playerColor===snapshot.playerColor&&
      latest.myColor===snapshot.myColor&&latest.fen===snapshot.fen&&
      JSON.stringify(latest.moves||[])===JSON.stringify(snapshot.moves||[]);
  }

  async function tick(){
    if(!active())return;
    if(processing){dirty=true;return;}
    processing=true;
    const epoch=generation;
    try{
      if(Date.now()<retryAt){schedule(retryAt-Date.now());return;}
      let snapshot;
      try{snapshot=reader.snapshot(document);}
      catch{
        show("Board updating; checking again.");
        badSnapshots=Math.min(badSnapshots+1,5);
        schedule(Math.min(400*badSnapshots,2000));
        return;
      }
      badSnapshots=0;
      if(!snapshot){
        // A transient empty/black board must never erase the last verified FEN.
        // Never show the previous move as if it were still current.
        settledText=null;analysisPending=true;
        show("Chessboard unavailable; waiting for it to return.");
        return;
      }
      if(snapshot.board!==currentBoard){
        // A site re-render can replace the element without changing the game.
        // Retain the FEN and verify the next placement by legal-move tracking.
        currentBoard=snapshot.board;
        lastColor=snapshot.myColor;
        analysisPending=true;rejectedPosition=null;settledText=null;
        watchBoard(currentBoard);
      }
      if(snapshot.myColor!==lastColor){
        // Flipping a board changes its orientation, not the game's position.
        lastColor=snapshot.myColor;
        analysisPending=true;rejectedPosition=null;settledText=null;
      }
      const placement=snapshot.placement;
      if(placement===lastPlacement&&!analysisPending&&(!snapshot.fen||snapshot.fen===currentFen)){if(settledText)show(settledText);return;}
      const positionKey=currentFen+"|"+placement;
      // A rejected board must change before another two-ply search is useful.
      if(positionKey===rejectedPosition)return;
      if(!currentFen&&placement!==reader.initial&&!snapshot.fen&&
         !(Array.isArray(snapshot.moves)&&snapshot.moves.length)){
        show("Start from the initial position, or provide a complete move history or FEN.");
        return;
      }
      if(!healthChecked){
        const health=await request("health");
        if(!current(epoch))return;
        if(!health.ok){retry(health.error||"Python server unavailable");return;}
        if(!health.stockfish){retry("Install Stockfish; restart the Python server.");return;}
        healthChecked=true;
      }

      let nextFen=currentFen;
      if(snapshot.fen){nextFen=snapshot.fen;}
      else if(placement===reader.initial){nextFen=INITIAL;}
      else if(!currentFen&&Array.isArray(snapshot.moves)&&snapshot.moves.length){
        const recovered=await request("recover",{moves:snapshot.moves,placement});
        if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
        if(!recovered.ok){
          rejectedPosition=positionKey;
          show("Move history cannot reconstruct this position. Resync using FEN.");
          return;
        }
        nextFen=recovered.fen;
      }
      else if(placement!==lastPlacement){
        const tracked=await request("track",{previous:currentFen,placement});
        if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
        if(!tracked.ok){
          if(tracked.status===400){
            // A complete SAN history can reconstruct more than two unseen plies.
            // Python validates every move and the final observed placement.
            const recovered=Array.isArray(snapshot.moves)&&snapshot.moves.length
              ?await request("recover",{moves:snapshot.moves,placement}):null;
            if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
            if(recovered?.ok)nextFen=recovered.fen;
            else{
              rejectedPosition=positionKey;
              show("Position tracking lost. Open a complete move list or resync with FEN.");
              return;
            }
          }else{retry(tracked.error||"Python server unavailable");return;}
        }else nextFen=tracked.fen;
      }
      if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
      currentFen=nextFen;lastPlacement=placement;rejectedPosition=null;
      const side=playerColor(snapshot);
      if(!side){
        analysisPending=false;
        show("Select your color in Chess Screen Coach settings.");
        return;
      }
      analysisPending=currentFen.split(" ")[1]===side;
      if(!analysisPending){settledText="Waiting for opponent";show(settledText);return;}
      show("Analyzing…");
      const answer=await request("analyze",{fen:currentFen,seconds:settings.thinkSeconds,elo:settings.strengthElo});
      if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
      if(!answer.ok){
        const message=answer.error||"Python server unavailable";
        // A healthy local engine may be occupied for <=2 s by another tab.
        // Keep the longer backoff for actual connectivity/engine failures.
        retry(message,/^Engine busy(?:\.|$)/.test(message)?1500:RETRY_MS);
        return;
      }
      analysisPending=false;retryAt=0;
      settledText=displayInstruction(answer);show(settledText);
    }finally{
      processing=false;
      if(dirty){dirty=false;schedule();}
    }
  }

  function stopWatching(){
    generation++;
    clearTimeout(workTimer);clearInterval(watchTimer);
    workTimer=null;watchTimer=null;dirty=false;
    observer?.disconnect();observer=null;
  }

  function resume(){
    stopWatching();
    if(document.hidden||coachHidden)return;
    if(location.pathname!==lastPath){lastPath=location.pathname;reset();}
    if(currentBoard?.isConnected)watchBoard(currentBoard);
    // This lightweight check only discovers a missing/replaced board or route.
    // A connected, unchanged board does not trigger reads or Python requests.
    watchTimer=setInterval(()=>{
      if(location.pathname!==lastPath){lastPath=location.pathname;reset();}
      if(!eligible())return;
      // Low-frequency safety scan recovers from missed DOM mutations and new boards.
      // It makes no engine request when the chess position is unchanged.
      schedule(0);
    },4000);
    schedule(0);
  }

  // H hides the entire injected coach, not only a training-mode message.
  // Paused tabs do not observe boards, poll for new positions, or request analysis.
  function setCoachHidden(hidden){
    if(coachHidden===hidden)return;
    coachHidden=hidden;
    if(hidden){
      stopWatching(); // Invalidates an in-flight response.
      document.getElementById("chess-study-no-share-overlay")?.remove();
      lastText="";settledText=null;analysisPending=true;retryAt=0;
    }else{
      lastText="";settledText=null;analysisPending=true;retryAt=0;
      resume();
    }
  }

  function handleHotkey(event){
    if(typeof event.key!=="string"||event.key.toLowerCase()!=="h"||
       event.repeat||event.isComposing||event.ctrlKey||event.altKey||event.metaKey)return;
    // Never hijack H while typing, searching, chatting, or editing a position.
    const target=event.target;
    const tag=target?.tagName?.toUpperCase?.()||"";
    if(["INPUT","TEXTAREA","SELECT"].includes(tag)||target?.isContentEditable||
       target?.closest?.('[contenteditable=""],[contenteditable="true"],[role="textbox"]'))return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const hidden=!coachHidden;
    setCoachHidden(hidden);
    // Keep other Chess.com tabs and reloads in the same hidden/visible state.
    lastToggleAt=Date.now();
    try{chrome.storage?.local?.set?.({coachHidden:hidden});}catch{}
    // Synchronize the old floating-window dashboard through the local server.
    void request("control",{hidden});
  }

  // A dashboard-side H key can also change the shared server control.
  // This lightweight sync does not read the board or request analysis.
  let controlTimer=null;
  const syncVisibility=async()=>{
    if(document.hidden||!eligible()||Date.now()-lastToggleAt<2200)return;
    const control=await request("control");
    if(document.hidden)return;
    if(control?.ok&&typeof control.hidden==="boolean"&&control.hidden!==coachHidden){
      setCoachHidden(control.hidden);
      chrome.storage?.local?.set?.({coachHidden:control.hidden});
    }
  };
  const refreshControlWatcher=()=>{
    clearInterval(controlTimer);controlTimer=null;
    if(!document.hidden)controlTimer=setInterval(()=>{void syncVisibility();},2000);
  };
  document.addEventListener("visibilitychange",refreshControlWatcher);
  window.addEventListener("pagehide",()=>{clearInterval(controlTimer);controlTimer=null;});
  window.addEventListener("pageshow",refreshControlWatcher);
  refreshControlWatcher();
  document.addEventListener("keydown",handleHotkey,true);
  document.addEventListener("visibilitychange",resume);
  window.addEventListener("pagehide",stopWatching);
  window.addEventListener("pageshow",resume);
  chrome.storage?.onChanged?.addListener?.((changes,area)=>{
    if(area==="local"){
      const next={...settings};
      for(const key of Object.keys(settings)){
        if(changes[key])next[key]=changes[key].newValue;
      }
      applySettings(next);
    }
  });
  // Read the saved hidden state before starting the observer or engine requests.
  if(chrome.storage?.local?.get)
    chrome.storage.local.get(settings,values=>{
      applySettings(values);
      if(coachHidden){
        lastToggleAt=Date.now();
        void request("control",{hidden:true});
      }
      if(!coachHidden)resume();
    });
  else resume();
})();
