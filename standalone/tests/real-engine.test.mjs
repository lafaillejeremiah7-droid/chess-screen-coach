import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {Chess} from "chess.js";

const require=createRequire(import.meta.url);

test("real pinned Stockfish 19 Lite WASM produces a legal move without Python",{
  timeout:45000
},async()=>{
  const createEngine=require("stockfish");
  let engine,timer;
  const best=await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(Error("Stockfish WASM did not return bestmove")),30000);
    try{
      engine=createEngine("lite-single",line=>{
        const match=String(line).match(/\bbestmove ([a-h][1-8][a-h][1-8][qrbn]?)/);
        if(match)resolve(match[1]);
      });
      engine.processCommand("uci");
      engine.processCommand("position startpos");
      engine.processCommand("go movetime 100");
    }catch(error){reject(error);}
  }).finally(()=>{
    clearTimeout(timer);
    try{engine?.terminate();}catch{}
  });
  const board=new Chess();
  const legal=board.moves({verbose:true}).map(m=>m.from+m.to+(m.promotion||""));
  assert.ok(legal.includes(best),"Engine produced illegal move: "+best);
});
