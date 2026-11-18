/* Chess coach overlay: reads pieces from DOM, never captures pixels. */
(function(){
  "use strict";
  const reader=globalThis.ChessCoachBoard;
  if(!reader){
    const error=document.createElement("div");
    error.id="chess-study-no-share-overlay";
    error.textContent="Chess Study Coach: board reader failed to load. Reload this extension and tab.";
    (document.body||document.documentElement)?.appendChild(error);
    return;
  }
  // Ignore a second injection into the same extension execution context.
  if(globalThis.__ChessCoachContentActive)return;
  const SETTLE_MS=180, RETRY_MS=2000;
  let currentFen=null,currentBoard=null,lastColor=null;
  let lastSnapshotKey=null,settledText=null,analysisPending=false;
  let processing=false,dirty=false,generation=0,retryAt=0,badSnapshots=0;
  let observer=null,workTimer=null,watchTimer=null,lastPath=location.pathname;
  let lockedPlayerColor=null,coachHidden=false;
  const settings={playerSide:"auto",thinkSeconds:1,strengthElo:1400,fullStrength:true,coachHidden:false};
  function applySettings(values){
    if(!values)return;
    settings.playerSide=["auto","w","b"].includes(values.playerSide)?values.playerSide:"auto";
    settings.thinkSeconds=Number.isFinite(values.thinkSeconds)&&values.thinkSeconds>=0.1&&values.thinkSeconds<=120?values.thinkSeconds:1;
    settings.strengthElo=Number.isInteger(values.strengthElo)&&values.strengthElo>=1320&&values.strengthElo<=3190?values.strengthElo:1400;
    settings.fullStrength=values.fullStrength!==false;
    settings.coachHidden=values.coachHidden===true;
    setCoachHidden(settings.coachHidden);
    generation++; // Invalidate an in-flight answer from the previous strength.
    analysisPending=true;settledText=null;retryAt=0;
    schedule(0);
  }
  function playerColor(snapshot){
    if(settings.playerSide!=="auto")return settings.playerSide;
    if(snapshot.playerColor==="w"||snapshot.playerColor==="b"){
      lockedPlayerColor=snapshot.playerColor;
      return lockedPlayerColor;
    }
    // Orientation is only an initial fallback, never re-infer after a flip.
    if(!lockedPlayerColor)lockedPlayerColor=snapshot.bottomColor||snapshot.myColor||null;
    return lockedPlayerColor;
  }
function eligible(){
    return location.protocol==="https:"&&
      (location.hostname==="www.chess.com"||location.hostname==="chess.com");
  }
  // Route-independent visibility: supported Chess.com pages use the same coach controls.
  const active=()=>eligible()&&!document.hidden&&!coachHidden;
  const current=epoch=>active()&&epoch===generation;

  function makeOverlay(){
    const host=document.createElement("div");
    host.id="chess-study-no-share-overlay";
    host.setAttribute("role","status");
    host.setAttribute("aria-live","polite");
    // Inline important declarations beat competing Chess.com and extension CSS.
    const hostStyle={
      position:"fixed",top:"12px",right:"12px",left:"auto",transform:"none",
      display:"block",visibility:"visible",opacity:"1",zIndex:"2147483647",
      pointerEvents:"none",width:"max-content",maxWidth:"min(calc(100vw - 24px), 260px)"
    };
    for(const [name,value] of Object.entries(hostStyle))
      host.style?.setProperty?.(name.replace(/[A-Z]/g,c=>"-"+c.toLowerCase()),value,"important");
    // The shadow tree isolates the actual suggestion text from Chess.com's
    // global typography, color and visibility rules. Without Shadow DOM
    // the existing overlay.css remains the fallback.
    if(typeof host.attachShadow==="function"){
      const root=host.attachShadow({mode:"open"});
      const css=document.createElement("style");
      css.textContent=`
        :host { all: initial; position: fixed !important; top: 12px !important;
          right: 12px !important; left: auto !important; transform: none !important;
          display: block !important; visibility: visible !important;
          opacity: 1 !important; z-index: 2147483647 !important;
          pointer-events: none !important; max-width: min(calc(100vw - 24px), 260px) !important; }
        #chess-study-no-share-overlay-text {
          all: initial; box-sizing: border-box; display: block;
          max-width: min(calc(100vw - 24px), 260px);
          padding: 4px 8px; background: #182633; color: #fff;
          border: 1px solid #3b4f63; border-radius: 6px;
          box-shadow: 0 1px 4px rgba(0,0,0,.3);
          font: 500 11px/1.3 system-ui,-apple-system,sans-serif;
          white-space: normal; overflow-wrap: anywhere; text-align: left;
        }`;
      const label=document.createElement("div");
      label.id="chess-study-no-share-overlay-text";
      root.appendChild(css);
      root.appendChild(label);
    }
    document.body.appendChild(host);
    return host;
  }

  function show(message){
    if(!active())return;
    const element=document.getElementById("chess-study-no-share-overlay")||makeOverlay();
    // A long engine exception must never cover the board. Keep complete
    // diagnostics available to the popup while displaying only a short label.
    element.__coachDiagnostic=message;
    const compact=message.length>85&&/unavailable|failed|error|connection/i.test(message)
      ?"Engine offline — check extension":message;
    if(element.textContent!==compact)element.textContent=compact;
    const label=element.shadowRoot?.getElementById?.("chess-study-no-share-overlay-text");
    if(label&&label.textContent!==compact)label.textContent=compact;
  }

  function reset(){
    generation++;
    observer?.disconnect();observer=null;
    currentFen=null;currentBoard=null;lastColor=null;
    analysisPending=false;retryAt=0;
    lastSnapshotKey=null;settledText=null;badSnapshots=0;lockedPlayerColor=null;
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
    observer.observe(board,{childList:true,subtree:true,attributes:true,attributeFilter:["class","style","data-piece","data-square","data-fen","fen","data-orientation","data-player-color","data-user-color","data-player-side","data-turn","data-side-to-move","data-active-color","data-color-to-move","data-to-move","data-castling-rights","data-en-passant","data-ep-square"]});
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
          resolve(response||{ok:false,error:"No response from bundled Stockfish engine"});
        });
      }catch{
        resolve({ok:false,error:"Extension updated. Reload this chess tab."});
      }
    });
  }

  function snapshotKey(snapshot,side){
    return JSON.stringify([snapshot.placement,snapshot.fen||null,
      snapshot.turn||null,snapshot.turnConflict===true,
      snapshot.castling||null,snapshot.enPassant||null,side]);
  }
  function unchanged(epoch,snapshot){
    if(!current(epoch))return false;
    let latest=null;
    try{latest=reader.snapshot(document);}catch{}
    return !!latest&&latest.board===snapshot.board&&
      snapshotKey(latest,playerColor(latest))===
      snapshotKey(snapshot,playerColor(snapshot))&&location.pathname===lastPath;
  }

  async function tick(){
    if(!active())return;
    if(processing){dirty=true;return;}
    processing=true;
    if(location.pathname!==lastPath){lastPath=location.pathname;reset();}
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
        // A re-render can replace the board; read the new element.
        currentBoard=snapshot.board;
        lastColor=snapshot.myColor;
        analysisPending=true;settledText=null;
        watchBoard(currentBoard);
      }
      if(snapshot.myColor!==lastColor){
        // Flipping a board changes its orientation, not the game's position.
        lastColor=snapshot.myColor;
        analysisPending=true;settledText=null;
      }
      // The current DOM snapshot, not prior moves, defines the position.
      const side=playerColor(snapshot);
      const boardKey=snapshotKey(snapshot,side);
      if(boardKey===lastSnapshotKey&&!analysisPending){
        if(settledText)show(settledText);
        return;
      }
      show("Reading current board…");
      // Never reuse a prior FEN when the visible pieces changed.
      let position;
      try{
        position=reader.currentFen(snapshot);
      }catch(error){
        settledText=null;analysisPending=true;lastSnapshotKey=null;
        const detail=String(error?.message||error);
        // Failure to verify the turn is not an engine connection failure.
        show(/^Turn (unknown|indicators disagree)/.test(detail)?
          detail:"Current position unavailable: "+detail);
        schedule(1000);
        return;
      }
      if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
      currentFen=position.fen;
      lastSnapshotKey=boardKey;
      if(!side){
        analysisPending=false;
        settledText="Select your color in Chess Screen Coach settings.";
        show(settledText);
        return;
      }
      // The current turn must be verified from FEN, a live clock or an
      // explicit indicator. The board's orientation is never turn evidence.
      if(!position.turnVerified)throw Error("Turn unknown — waiting for active clock or turn indicator.");
      if(currentFen.split(" ")[1]!==side){
        analysisPending=false;
        settledText="Waiting for opponent";
        show(settledText);
        return;
      }
      show("Analyzing current board…");
      analysisPending=true;
      const answer=await request("analyze",{fen:currentFen,
        seconds:settings.thinkSeconds,
        elo:settings.fullStrength?"full":settings.strengthElo});
      if(!unchanged(epoch,snapshot)){if(current(epoch))dirty=true;return;}
      if(!answer.ok){
        lastSnapshotKey=null; // Recheck the same current board after errors.
        retry(answer.error||"Bundled Stockfish unavailable");
        return;
      }
      analysisPending=false;retryAt=0;
      const note=!position.rulesVerified?"Rule rights unverified: ":"";
      settledText=note+answer.instruction;
      show(settledText);
    }catch(error){
      if(current(epoch))retry("Chess Study Coach error: "+String(error?.message||error));
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
    show("Chess Study Coach active — checking chessboard…");
    // This lightweight check only discovers a missing/replaced board or route.
    // An unchanged board does not trigger a new engine request.
    watchTimer=setInterval(()=>{
      if(location.pathname!==lastPath){lastPath=location.pathname;reset();}
      if(!eligible())return;
      // Low-frequency safety scan recovers from missed DOM mutations and new boards.
      // It makes no engine request when the chess position is unchanged.
      schedule(0);
    },1000);
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
      settledText=null;analysisPending=true;retryAt=0;
    }else{
      settledText=null;analysisPending=true;retryAt=0;
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
    // Chrome storage notifies each open tab without a second polling loop.
    try{chrome.storage?.local?.set?.({coachHidden:hidden});}catch{}
  }

  document.addEventListener("keydown",handleHotkey,true);
  document.addEventListener("visibilitychange",resume);
  window.addEventListener("pagehide",stopWatching);
  window.addEventListener("pageshow",resume);
  chrome.storage?.onChanged?.addListener?.((changes,area)=>{
    if(area==="local"){
      const next={...settings};
      let settingsChanged=false;
      for(const key of Object.keys(settings)){
        if(changes[key]){
          next[key]=changes[key].newValue;
          settingsChanged=true;
        }
      }
      if(settingsChanged)applySettings(next);
    }
  });
  // The settings page can distinguish a missing content script from a missing
  // chessboard or a local Python/Stockfish failure.
  chrome.runtime?.onMessage?.addListener?.((message,_sender,sendResponse)=>{
    if(message?.action==="coachResync"){
      if(coachHidden){
        sendResponse({ok:false,error:"Coach is paused. Resume suggestions and try again."});
        return false;
      }
      let snapshot;
      try{snapshot=reader.snapshot(document);}
      catch(error){
        sendResponse({ok:false,error:"Cannot read the chessboard yet: "+String(error?.message||error)});
        return false;
      }
      if(!snapshot){
        sendResponse({ok:false,error:"No readable chessboard found. Open a game board before resyncing."});
        return false;
      }
      reset(); // A fresh DOM snapshot is sufficient, including midgame boards.
      resume(); // Reconnects the board observer and requests a new legal position.
      show("Resyncing board…");
      // Settings can be open in another tab; Chrome will resume its board
      // observer automatically when the Chess.com tab becomes visible.
      sendResponse({ok:true,started:!document.hidden,queued:document.hidden,boardFound:true});
      return false;
    }
    if(message?.action!=="coachStatus")return false;
    let boardFound=false,boardError=null;
    try{boardFound=!!reader.findBoard(document);}
    catch(error){boardError=String(error?.message||error);}
    sendResponse({
      injected:true,hidden:coachHidden,visible:active(),boardFound,boardError,
      status:document.getElementById("chess-study-no-share-overlay")?.__coachDiagnostic||
        document.getElementById("chess-study-no-share-overlay")?.textContent||"",
      path:location.pathname
    });
    return false;
  });
  // Display a startup status even if the Chrome storage callback is delayed.
  // Set the idempotency guard only after all listeners have been registered.
  show("Chess Study Coach initializing…");
  globalThis.__ChessCoachContentActive=true;
  // Read the saved hidden state before starting the observer or engine requests.
  if(chrome.storage?.local?.get)
    chrome.storage.local.get(settings,values=>{
      applySettings(values);
      if(!coachHidden)resume();
    });
  else resume();
})();
