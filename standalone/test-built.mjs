import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync,statSync} from "node:fs";
import {join} from "node:path";
import {Chess} from "chess.js";

const dir=join(process.cwd(),"dist","chess-screen-coach-standalone");
const manifest=JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8"));
const code=readFileSync(join(dir,"offscreen-engine.js"),"utf8");
function harness(){
  let handler;
  const commands=[];
  class FakeWorker{
    constructor(){this.onmessage=null;this.onerror=null;}
    postMessage(command){
      commands.push(command);
      let response;
      if(command==="uci")response="id name Stockfish 19 Lite WASM\nuciok";
      else if(command==="isready")response="readyok";
      else if(command.startsWith("go movetime "))response="info depth 12 score cp 34\nbestmove e2e4 ponder e7e5";
      if(response)queueMicrotask(()=>this.onmessage({data:response}));
    }
    terminate(){}
  }
  const chrome={
    runtime:{
      id:"extension-id",
      getURL:relative=>"chrome-extension://extension-id/"+relative,
      onMessage:{addListener(fn){handler=fn;}}
    }
  };
  vm.runInNewContext(code,{
    chrome,Worker:FakeWorker,WebAssembly:{},
    setTimeout,clearTimeout,queueMicrotask,Promise,URL,
  });
  function dispatch(action,body={}){
    return new Promise((resolve,reject)=>{
      const keep=handler({target:"standalone-engine",action,body},{id:"extension-id"},resolve);
      if(keep!==true)reject(Error("message handler not registered"));
    });
  }
  return {dispatch,commands};
}
test("packaged extension includes binary assets and offline CSP",()=>{
  assert.equal(manifest.version,"0.7.0");
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.content_security_policy.extension_pages.includes("wasm-unsafe-eval"));
  for(const path of ["engine/stockfish-19-lite-single.js",
    "engine/stockfish-19-lite-single.wasm","engine/STOCKFISH-LICENSE.txt",
    "offscreen.html","offscreen-engine.js","popup.html","manifest.json"])
    assert.ok(statSync(join(dir,path)).size>0,path);
  for(const filename of ["background.js","options.js","popup.js"]){
    const content=readFileSync(join(dir,filename),"utf8");
    assert.doesNotMatch(content,/127\.0\.0\.1:8765|localhost:8765/);
  }
});
test("offline health initializes Stockfish without any localhost requests",async()=>{
  const h=harness();
  const result=await h.dispatch("health");
  assert.equal(result.ok,true);
  assert.equal(result.standalone,true);
  assert.equal(result.stockfish19,true);
  assert.ok(h.commands.includes("uci"));
  assert.ok(h.commands.includes("isready"));
});
test("offline engine recommends a legal instruction for the starting position",async()=>{
  const h=harness();
  const result=await h.dispatch("analyze",{
    fen:new Chess().fen(),seconds:0.2,elo:"full"
  });
  assert.equal(result.ok,true);
  assert.equal(result.instruction,"Move pawn from e2 to e4");
  assert.equal(result.engine,"Stockfish 19 Lite WASM");
  assert.ok(h.commands.includes("go movetime 200"));
});
test("offline SAN history and two-ply position tracking are validated",async()=>{
  const h=harness(),chess=new Chess();
  chess.move("e4");chess.move("e5");
  const recovered=await h.dispatch("recover",{moves:["e4","e5"],placement:chess.fen().split(" ")[0]});
  assert.equal(recovered.ok,true);
  assert.equal(recovered.fen,chess.fen());
  const tracked=await h.dispatch("track",{
    previous:new Chess().fen(),placement:chess.fen().split(" ")[0]
  });
  assert.equal(tracked.ok,true);
  assert.equal(tracked.fen.split(" ")[0],chess.fen().split(" ")[0]);
});
test("hidden mode rejects engine analysis and resumes correctly",async()=>{
  const h=harness();
  const hidden=await h.dispatch("control",{hidden:true});
  assert.equal(hidden.hidden,true);
  const stopped=await h.dispatch("analyze",{fen:new Chess().fen(),seconds:1});
  assert.equal(stopped.ok,false);
  await h.dispatch("control",{hidden:false});
  const ready=await h.dispatch("health");
  assert.equal(ready.ok,true);
});
