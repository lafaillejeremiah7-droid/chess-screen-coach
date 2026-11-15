/* Chess coach overlay: reads pieces from DOM, never captures pixels. */
(function(){
  "use strict";
  const reader=globalThis.ChessCoachBoard;
  const INITIAL=reader.initial+" w KQkq - 0 1";
  let currentFen=null,lastPlacement=null,currentBoard=null,processing=false,lastColor=null;
  let lastText="",healthChecked=false;

  function eligible(){
    return /^\/play\/computer(?:\/|$)/.test(location.pathname) ||
      /^\/analysis(?:\/|$)/.test(location.pathname);
  }

  function show(message){
    if(!eligible())return;
    let element=document.getElementById("chess-study-no-share-overlay");
    if(!element){
      element=document.createElement("div");
      element.id="chess-study-no-share-overlay";
      element.setAttribute("role","status");
      element.setAttribute("aria-live","polite");
      document.body.appendChild(element);
    }
    if(message!==lastText){
      element.textContent=message;
      lastText=message;
    }
  }

  function reset(){
    currentFen=null;lastPlacement=null;currentBoard=null;lastColor=null;healthChecked=false;
    lastText="";
    document.getElementById("chess-study-no-share-overlay")?.remove();
  }

  function request(action,data={}){
    return new Promise(resolve=>{
      chrome.runtime.sendMessage({action,...data}, response=>{
        if(chrome.runtime.lastError){
          resolve({ok:false,error:chrome.runtime.lastError.message});return;
        }
        resolve(response||{ok:false,error:"No response from local Python server"});
      });
    });
  }

  async function tick(){
    if(!eligible()){
      if(currentFen!==null||lastText)reset();
      return;
    }
    if(processing)return;
    processing=true;
    try{
      let snapshot;
      try{snapshot=reader.snapshot(document);}
      catch(error){
        show("Board updating; checking again.");
        return;
      }
      if(!snapshot){
        show("Open a Chess.com bot or analysis board.");
        return;
      }
      if(snapshot.board!==currentBoard){
        currentBoard=snapshot.board;
        currentFen=null;
        lastPlacement=null;
        lastColor=snapshot.myColor;
        healthChecked=false;
      }
      if(snapshot.myColor!==lastColor){
        lastColor=snapshot.myColor;
        // Orientation switches in analysis need explicit board resync.
        currentFen=null;lastPlacement=null;
      }
      if(snapshot.placement===lastPlacement)return;
      const placement=snapshot.placement;
      if(!healthChecked){
        const health=await request("health");
        if(!health.ok){show(health.error||"Python server unavailable");return;}
        if(!health.stockfish){show("Install Stockfish; restart the Python server.");return;}
        healthChecked=true;
      }

      let nextFen;
      if(!currentFen){
        if(placement!==reader.initial){
          show("Start from a new bot game, or enter FEN in the analysis dashboard.");
          return;
        }
        nextFen=INITIAL;
      }else{
        const tracked=await request("track",{previous:currentFen,placement});
        if(!tracked.ok){
          show("Position tracking lost. Start a new game or use FEN analysis.");
          return;
        }
        nextFen=tracked.fen;
      }
      // Confirm the board has not changed while waiting for Python.
      let latest=null;
      try{latest=reader.snapshot(document);}
      catch{}
      if(!latest||latest.board!==currentBoard||latest.placement!==placement)return;
      currentFen=nextFen;
      lastPlacement=placement;

      if(currentFen.split(" ")[1]!==snapshot.myColor){
        show("Waiting for opponent");
        return;
      }
      show("Analyzing…");
      const answer=await request("analyze",{fen:currentFen});
      latest=null;
      try{latest=reader.snapshot(document);}
      catch{}
      if(!latest||latest.board!==currentBoard||latest.placement!==placement)return;
      show(answer.ok?answer.instruction:(answer.error||"Python server unavailable"));
    }finally{processing=false;}
  }

  if(!reader){return;}
  if(eligible())show("Reading chessboard…");
  setInterval(()=>{void tick();},1200);
  void tick();
})();
