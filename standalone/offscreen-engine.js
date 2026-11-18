/* Bundled Stockfish 19 Lite WASM engine + chess.js rules, in a Chrome offscreen page.
   No Linux process, localhost service, internet requests, or Chess.com APIs. */
import { Chess } from "chess.js";

const file=chrome.runtime.getURL("engine/stockfish-19-lite-single.js");
let worker=null,starting=null,paused=false,serial=Promise.resolve();
const listeners=new Set();
let lastError=null;
const PIECE={p:"pawn",n:"knight",b:"bishop",r:"rook",q:"queen",k:"king"};
const matchesPlacement=(fen,placement)=>fen.split(" ")[0]===placement;
function fail(message,status=400){return {ok:false,status,error:message};}
function lineReceived(raw){
  for(const line of String(raw||"").split(/\r?\n/)){
    for(const listener of [...listeners])listener(line);
  }
}
function waitFor(pattern,command,ms=18000){
  if(!worker)return Promise.reject(Error("Engine worker was not initialized"));
  return new Promise((resolve,reject)=>{
    const wait=line=>{
      if(!pattern.test(line))return;
      clearTimeout(timeout);listeners.delete(wait);resolve(line);
    };
    const timeout=setTimeout(()=>{
      listeners.delete(wait);
      reject(Error("Stockfish timed out responding to "+command));
    },ms);
    listeners.add(wait);
    try{worker.postMessage(command);}
    catch(error){clearTimeout(timeout);listeners.delete(wait);reject(error);}
  });
}
function stopEngine(){
  try{worker?.terminate();}catch{}
  worker=null;
  listeners.clear();
}
async function init(){
  if(worker)return;
  if(starting)return starting;
  starting=(async()=>{
    try{
      if(typeof WebAssembly!=="object"||typeof Worker!=="function")
        throw Error("This browser cannot run bundled WebAssembly workers");
      worker=new Worker(file);
      worker.onmessage=event=>lineReceived(event.data);
      worker.onerror=event=>{
        lastError=String(event?.message||"Stockfish browser worker failed");
        stopEngine();
      };
      await waitFor(/^uciok$/, "uci", 30000);
      worker.postMessage("setoption name Hash value 16");
      await waitFor(/^readyok$/, "isready", 15000);
      lastError=null;
    }catch(error){
      stopEngine();lastError=String(error?.message||error);throw error;
    }
  })();
  try{await starting;}finally{starting=null;}
}
function queue(task){
  const result=serial.then(task,task);
  serial=result.catch(()=>{});
  return result;
}
function validFen(fen){
  if(typeof fen!=="string"||fen.length>120)throw Error("Invalid FEN");
  return new Chess(fen);
}
function validPlacement(value){
  if(typeof value!=="string"||value.length>90||!/^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+$/.test(value))
    throw Error("Invalid board placement");
  return value;
}
function track(previous,placement){
  const game=validFen(previous);
  const target=validPlacement(placement);
  if(matchesPlacement(game.fen(),target))return {fen:game.fen(),changed:false};
  const one=new Set(),two=new Set();
  for(const first of game.moves({verbose:true})){
    game.move(first);
    if(matchesPlacement(game.fen(),target))one.add(game.fen());
    if(one.size===0){
      for(const second of game.moves({verbose:true})){
        game.move(second);
        if(matchesPlacement(game.fen(),target))two.add(game.fen());
        game.undo();
      }
    }
    game.undo();
    if(one.size>1)throw Error("Ambiguous single-move transition");
  }
  if(one.size===1)return {fen:[...one][0],changed:true};
  if(two.size===1)return {fen:[...two][0],changed:true};
  throw Error("Cannot reconstruct board from two legal moves");
}
function recover(moves,placement){
  if(!Array.isArray(moves)||moves.length<1||moves.length>400)
    throw Error("A complete move history is required");
  const target=validPlacement(placement),game=new Chess();
  for(const item of moves){
    if(typeof item!=="string"||item.length>14)throw Error("Invalid move history token");
    let result;
    if(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(item))
      result=game.move({from:item.slice(0,2),to:item.slice(2,4),promotion:item[4]});
    else result=game.move(item);
    if(!result)throw Error("Move history contains an illegal move");
  }
  if(!matchesPlacement(game.fen(),target))
    throw Error("Move history does not match the detected board");
  return {fen:game.fen(),recovered_moves:moves.length};
}
function formatMove(game,uci){
  const legal=game.moves({verbose:true}).find(move=>
    move.from+move.to+(move.promotion||"")===uci);
  if(!legal)throw Error("Stockfish produced a move that is not legal in this position");
  const promotion=legal.promotion?" (promote to "+PIECE[legal.promotion]+")":"";
  return {
    instruction:"Move "+PIECE[legal.piece]+" from "+legal.from+" to "+legal.to+promotion,
    from:legal.from,to:legal.to,uci
  };
}
async function think(payload){
  if(paused)throw Error("Chess coach is paused");
  const game=validFen(payload.fen);
  const seconds=payload.seconds===undefined?1:Number(payload.seconds);
  if(![0.2,0.5,1,2].includes(seconds))throw Error("Unsupported analysis time");
  const elo=payload.elo===undefined?"full":payload.elo;
  if(elo!=="full"&&(!Number.isInteger(elo)||elo<1320||elo>3190))
    throw Error("Unsupported Stockfish UCI Elo");
  if(game.isGameOver())return {instruction:"Game over",from:null,to:null,fen:game.fen(),seconds};
  await init();
  const strength=elo==="full"?
    "setoption name UCI_LimitStrength value false":
    "setoption name UCI_LimitStrength value true";
  worker.postMessage(strength);
  if(elo!=="full")worker.postMessage("setoption name UCI_Elo value "+elo);
  await waitFor(/^readyok$/, "isready",10000);
  worker.postMessage("position fen "+game.fen());
  let depth=null,score_cp=null,mate_in=null;
  const infoLine=line=>{
    if(!line.startsWith("info "))return;
    const match=line.match(/\bdepth (\d+)/);
    if(match)depth=Number(match[1]);
    const cp=line.match(/\bscore cp (-?\d+)/);
    const mate=line.match(/\bscore mate (-?\d+)/);
    if(cp)score_cp=Number(cp[1]);
    if(mate)mate_in=Number(mate[1]);
  };
  listeners.add(infoLine);
  let line;
  try{
    line=await waitFor(/^bestmove\s+\S+/, "go movetime "+Math.round(seconds*1000), 18000);
  }finally{listeners.delete(infoLine);}
  if(paused)throw Error("Chess coach is paused");
  const uci=line.split(/\s+/)[1];
  return {...formatMove(game,uci),fen:game.fen(),seconds,depth,score_cp,mate_in,
    reason:"Stockfish 19 Lite WASM analysis (local browser engine).",
    engine:"Stockfish 19 Lite WASM",standalone:true};
}
async function dispatch(action,body){
  switch(action){
    case "health":
      await init();
      return {python:false,stockfish:true,stockfish19:true,standalone:true,
        engine:"Stockfish 19 Lite WASM",default_seconds:1,default_elo:"full"};
    case "control":
      if(typeof body?.hidden==="boolean"){
        paused=body.hidden;
        if(paused)worker?.postMessage("stop");
      }
      return {hidden:paused,engine_running:!!worker};
    case "track":return track(body.previous,body.placement);
    case "recover":return recover(body.moves,body.placement);
    case "analyze":return queue(()=>think(body));
    default:throw Error("Unsupported offline action");
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.target!=="standalone-engine")return false;
  if(sender.id!==chrome.runtime.id)return false;
  Promise.resolve().then(()=>dispatch(message.action,message.body||{}))
    .then(value=>respond({ok:true,...value}))
    .catch(error=>respond(fail(String(error?.message||error),503)));
  return true;
});
