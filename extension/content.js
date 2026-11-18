/* Read the current Chess.com board and ask full-strength Stockfish 19. */
(function(){
  "use strict";
  if(globalThis.__fullStockfish19Started)return;
  globalThis.__fullStockfish19Started=true;
  const reader=globalThis.ChessCoachBoard;
  if(!reader)return;
  let host=null,label=null,board=null,observer=null,timer=null;
  let lastFen=null,revision=0;
  function show(message){
    if(!document.body)return;
    if(!host||!host.isConnected){
      host=document.createElement("div");
      host.id="full-stockfish-19";
      host.style.cssText="position:fixed!important;top:12px!important;right:12px!important;"+
        "z-index:2147483647!important;pointer-events:none!important;";
      const shadow=host.attachShadow?.({mode:"open"});
      if(shadow){
        const style=document.createElement("style");
        style.textContent="div{display:block;box-sizing:border-box;max-width:260px;"+
          "padding:5px 8px;background:#182633;color:#fff;border-radius:6px;"+
          "font:500 11px/1.3 system-ui,sans-serif;overflow-wrap:anywhere;}";
        label=document.createElement("div");
        shadow.appendChild(style);shadow.appendChild(label);
      }else{
        label=host;
        host.style.cssText+="max-width:260px;padding:5px 8px;background:#182633;"+
          "color:#fff;font:500 11px/1.3 system-ui,sans-serif;";
      }
      document.body.appendChild(host);
    }
    if(label.textContent!==message)label.textContent=message;
  }
  function schedule(delay=150){
    clearTimeout(timer);
    timer=setTimeout(inspect,delay);
  }
  function invalidate(message){
    lastFen=null;
    revision++;
    show(message);
  }
  function inspect(){
    let snapshot;
    try{snapshot=reader.snapshot(document);}
    catch{invalidate("Board updating");return;}
    if(!snapshot){invalidate("Waiting for chessboard");return;}
    if(snapshot.board!==board){
      observer?.disconnect();
      board=snapshot.board;
      observer=new MutationObserver(()=>schedule());
      observer.observe(board,{
        childList:true,subtree:true,attributes:true,
        attributeFilter:["class","style","data-piece","data-square","data-fen",
          "data-turn","data-side-to-move","data-active-color","data-castling-rights",
          "data-en-passant","data-ep-square"]
      });
    }
    let fen;
    try{fen=reader.currentFen(snapshot).fen;}
    catch{invalidate("Waiting for verified turn");return;}
    if(fen===lastFen)return;
    lastFen=fen;
    const request=++revision;
    show("Stockfish 19 analyzing...");
    try{
      chrome.runtime.sendMessage({action:"analyze",fen},response=>{
        if(request!==revision)return;
        let now;
        try{now=reader.currentFen(reader.snapshot(document)).fen;}
        catch{schedule(0);return;}
        if(now!==fen){schedule(0);return;}
        if(chrome.runtime.lastError||!response?.ok){
          show("Stockfish unavailable — retrying");
          lastFen=null;
          schedule(2000);
          return;
        }
        show(response.instruction);
      });
    }catch{
      show("Reload the extension and chess tab");
      lastFen=null;
      schedule(2000);
    }
  }
  // One recovery scan per second; unchanged positions never restart Stockfish.
  setInterval(()=>schedule(0),1000);
  schedule(0);
})();
