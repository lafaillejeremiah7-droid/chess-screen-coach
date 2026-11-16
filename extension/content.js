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

  function eligible(){
    return location.protocol==="https:"&&
      (location.hostname==="www.chess.com"||location.hostname==="chess.com");
  }
  const active=()=>eligible()&&!document.hidden;
  const current=epoch=>active()&&epoch===generation;

  function show(message){
    if(!active())return;
    let element=document.getElementById("chess-study-no-share-overlay");
    if(!element){
      element=document.createElement("div");
      element.id="chess-study-no-share-overlay";
      element.setAttribute("role","status");
      element.setAttribute("aria-live","polite");
      document.body.appendChild(element);
    }
    if(message!==lastText){element.textContent=message;lastText=message;}
  }

  function reset(){
    generation++;
    observer?.disconnect();observer=null;
    currentFen=null;lastPlacement=null;currentBoard=null;lastColor=null;
    healthChecked=false;analysisPending=false;rejectedPosition=null;retryAt=0;
    lastText="";settledText=null;badSnapshots=0;
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

  function retry(message){
    show(message);
    retryAt=Date.now()+RETRY_MS;
    schedule(RETRY_MS);
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
    return latest&&latest.board===snapshot.board&&latest.placement===snapshot.placement&&
      latest.myColor===snapshot.myColor;
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
        // Do not leave a stale instruction on a page with no chessboard.
        document.getElementById("chess-study-no-share-overlay")?.remove();
        lastText="";settledText=null;
        return;
      }
      if(snapshot.board!==currentBoard){
        currentBoard=snapshot.board;currentFen=null;lastPlacement=null;
        lastColor=snapshot.myColor;analysisPending=false;rejectedPosition=null;settledText=null;
        watchBoard(currentBoard);
      }
      if(snapshot.myColor!==lastColor){
        // Flipping a board changes its orientation, not the game's position.
        lastColor=snapshot.myColor;
        analysisPending=true;rejectedPosition=null;settledText=null;
      }
      const placement=snapshot.placement;
      if(placement===lastPlacement&&!analysisPending){if(settledText)show(settledText);return;}
      const positionKey=currentFen+"|"+placement;
      // A rejected board must change before another two-ply search is useful.
      if(positionKey===rejectedPosition)return;
      if(!currentFen&&placement!==reader.initial&&!snapshot.fen){
        show("Start from the initial position, or enter FEN in the analysis dashboard.");
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
      if(placement===reader.initial){nextFen=INITIAL;}
      else if(!currentFen&&snapshot.fen){nextFen=snapshot.fen;}
      else if(placement!==lastPlacement){
        const tracked=await request("track",{previous:currentFen,placement});
        if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
        if(!tracked.ok){
          if(tracked.status===400){
            rejectedPosition=positionKey;
            show("Position tracking lost. Start a new game or use FEN analysis.");
          }else{retry(tracked.error||"Python server unavailable");}
          return;
        }
        nextFen=tracked.fen;
      }
      if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
      currentFen=nextFen;lastPlacement=placement;rejectedPosition=null;
      analysisPending=currentFen.split(" ")[1]===snapshot.myColor;
      if(!analysisPending){settledText="Waiting for opponent";show(settledText);return;}
      show("Analyzing…");
      const answer=await request("analyze",{fen:currentFen});
      if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
      if(!answer.ok){retry(answer.error||"Python server unavailable");return;}
      analysisPending=false;retryAt=0;
      settledText=answer.instruction;show(settledText);
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
    if(document.hidden)return;
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

  document.addEventListener("visibilitychange",resume);
  window.addEventListener("pagehide",stopWatching);
  window.addEventListener("pageshow",resume);
  resume();
})();
