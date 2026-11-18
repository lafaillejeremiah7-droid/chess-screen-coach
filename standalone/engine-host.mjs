import {parseBoard,formatMove} from "./chess-core.mjs";

// Runs inside a persistent MV3 offscreen document, not a service worker.
// Stockfish's Web Worker and its matching WASM are packaged with the extension.
let engine=null,initializing=null,readyResolve=null,readyReject=null,pending=null;
let queue=Promise.resolve(),latestInfo=null;

function resetEngine(reason){
  const error=reason instanceof Error?reason:Error(String(reason));
  if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}
  if(readyReject){readyReject(error);readyResolve=null;readyReject=null;}
  try{engine?.terminate();}catch{}
  engine=null;initializing=null;latestInfo=null;
}
function handleEngineLine(raw){
  for(const line of String(raw).split(/\r?\n/)){
    const text=line.trim();
    if(!text)continue;
    if(text==="uciok"){
      engine?.postMessage("setoption name Hash value 16");
      engine?.postMessage("isready");
    }else if(text==="readyok"&&readyResolve){
      const resolve=readyResolve;readyResolve=null;readyReject=null;
      resolve();
    }else if(text.startsWith("info ")&&pending){
      const depth=text.match(/\bdepth (\d+)\b/);
      const cp=text.match(/\bscore cp (-?\d+)\b/);
      const mate=text.match(/\bscore mate (-?\d+)\b/);
      if(depth)latestInfo={depth:Number(depth[1]),score_cp:cp?Number(cp[1]):null,
        mate_in:mate?Number(mate[1]):null};
    }else if(text.startsWith("bestmove ")&&pending){
      const active=pending;pending=null;clearTimeout(active.timer);
      active.resolve({move:text.split(/\s+/)[1],...latestInfo});
    }
  }
}
function startEngine(){
  if(initializing)return initializing;
  initializing=new Promise((resolve,reject)=>{
    let timer;
    try{
      engine=new Worker(chrome.runtime.getURL("engine/stockfish-19-single.js"));
      readyResolve=()=>{clearTimeout(timer);resolve();};
      readyReject=error=>{clearTimeout(timer);reject(error);};
      engine.onmessage=event=>handleEngineLine(event.data);
      engine.onerror=event=>{
        resetEngine(Error("Bundled Stockfish failed to load. Install the standalone extension build, not the source ZIP."));
      };
      timer=setTimeout(()=>resetEngine(Error("Stockfish WASM initialization timed out. Try reloading the extension.")),60000);
      engine.postMessage("uci");
    }catch(error){
      clearTimeout(timer);
      resetEngine(error);
      reject(error);
    }
  });
  // A synchronous Worker construction error can reject before the assignment
  // above completes. Never cache that rejected promise permanently.
  const attempt=initializing;
  void attempt.catch(()=>{if(initializing===attempt)initializing=null;});
  return attempt;
}
function enqueue(job){
  const next=queue.catch(()=>{}).then(job);
  queue=next.catch(()=>{});
  return next;
}
async function analyze(body){
  const fen=body.fen;
  const board=parseBoard(fen);
  if(board.isGameOver())throw Error("Game over; no legal move available");
  const seconds=1; // Live search duration, never an Elo or strength cap.
  return enqueue(async()=>{
    await startEngine();
    const result=await new Promise((resolve,reject)=>{
      if(pending){reject(Error("Engine is already analyzing"));return;}
      latestInfo=null;
      const timer=setTimeout(()=>{
        resetEngine(Error("Stockfish search timed out. Retrying on the next position."));
      },Math.round(seconds*1000)+8000);
      pending={resolve,reject,timer};
      try{
        engine.postMessage("setoption name UCI_LimitStrength value false");
        engine.postMessage(`position fen ${fen}`);
        engine.postMessage(`go movetime ${Math.round(seconds*1000)}`);
      }catch(error){resetEngine(error);}
    });
    const move=formatMove(fen,result.move);
    return {...move,seconds,engine:"Stockfish 19 Full (single-threaded WASM)",
      depth:result.depth??null,score_cp:result.score_cp??null,mate_in:result.mate_in??null};
  });
}
async function dispatch(action,body={}){
  if(action==="ping")return {ready:true,host:"offscreen",engine:"Stockfish 19 Full"};
  if(action==="analyze")return analyze(body);
  throw Error("Unknown engine request");
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.target!=="standalone-engine")return false;
  void Promise.resolve().then(()=>dispatch(message.action,message.body||{}))
    .then(result=>sendResponse({ok:true,...result}))
    .catch(error=>sendResponse({ok:false,status:400,error:String(error?.message||error)}));
  return true;
});

// The bootstrap listener confirms the entire bundled script initialized.
globalThis.__chessEngineBoot?.ready?.();
