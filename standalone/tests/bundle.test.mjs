import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {dirname,join,resolve} from "node:path";

const base=dirname(fileURLToPath(import.meta.url));
const dist=resolve(base,"..","..","dist","extension");
const read=name=>readFileSync(join(dist,name),"utf8");

test("build contains local engine JS, WASM, license and offscreen document",()=>{
  for(const name of ["manifest.json","offscreen.html","engine-host.js",
    "engine/stockfish-19-lite-single.js","engine/stockfish-19-lite-single.wasm",
    "engine/COPYING-GPL-3.0.txt"]){
    assert.ok(statSync(join(dist,name)).size>0,name);
  }
  const manifest=JSON.parse(read("manifest.json"));
  assert.equal(manifest.version,"0.7.0");
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.match(manifest.content_security_policy.extension_pages,/wasm-unsafe-eval/);
  assert.equal(manifest.host_permissions.some(x=>/127\.0\.0\.1|localhost/.test(x)),false);
});
test("offscreen worker UCI and legal move formatting work without Python",async()=>{
  const callbacks=[];
  const commands=[];
  class Worker{
    constructor(url){assert.match(url,/stockfish-19-lite-single\.js$/);}
    postMessage(command){
      commands.push(command);
      if(command==="uci")this.onmessage({data:"uciok"});
      if(command==="isready")this.onmessage({data:"readyok"});
      if(command.startsWith("go movetime")){
        this.onmessage({data:"info depth 12 score cp 22"});
        this.onmessage({data:"bestmove e2e4"});
      }
    }
    terminate(){}
  }
  const stored={coachHidden:false};
  const chrome={
    runtime:{
      getURL:path=>"chrome-extension://test/"+path,
      onMessage:{addListener:fn=>callbacks.push(fn)}
    },
    storage:{local:{
      get:async()=>stored,
      set:async data=>{Object.assign(stored,data);}
    }}
  };
  vm.runInNewContext(read("engine-host.js"),{chrome,Worker,setTimeout,clearTimeout,
    Promise,Error,Number,console});
  const request=(action,body)=>new Promise(resolve=>{
    assert.equal(callbacks[0]({target:"standalone-engine",action,body},null,resolve),true);
  });
  const health=await request("health");
  assert.equal(health.ok,true);
  assert.equal(health.stockfish,true);
  const fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const result=await request("analyze",{fen,seconds:0.2,elo:"full"});
  assert.equal(result.ok,true);
  assert.equal(result.instruction,"Move pawn from e2 to e4");
  assert.equal(result.depth,12);
  assert.ok(commands.includes("go movetime 200"));
  const control=await request("control",{hidden:true});
  assert.equal(control.hidden,true);
  assert.equal((await request("control")).hidden,true);
});
