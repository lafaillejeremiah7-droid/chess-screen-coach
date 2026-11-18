import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync,existsSync} from "node:fs";
import {resolve,join} from "node:path";
import vm from "node:vm";

const dist=resolve("dist/extension");
const read=path=>readFileSync(join(dist,path),"utf8");

test("minimal build contains Full Stockfish 19, not Lite, with no extra UI",()=>{
  for(const path of ["manifest.json","board.js","content.js","background.js",
    "offscreen.html","offscreen-bootstrap.js","engine-host.js",
    "engine/stockfish-19-single.js","engine/stockfish-19-single.wasm",
    "engine/COPYING-GPL-3.0.txt"])assert.ok(existsSync(join(dist,path)),path);
  assert.ok(statSync(join(dist,"engine/stockfish-19-single.wasm")).size>30000000);
  for(const path of ["popup.html","options.html","server.py","training.html"])
    assert.equal(existsSync(join(dist,path)),false,path);
  const manifest=JSON.parse(read("manifest.json"));
  assert.equal(manifest.version,"0.8.0");
  assert.deepEqual(manifest.permissions,["offscreen"]);
  assert.equal(manifest.action,undefined);
});

test("engine uses Full Stockfish with no Elo limit and a legal UCI move",async()=>{
  const callbacks=[],commands=[];
  class Worker{
    postMessage(cmd){
      commands.push(cmd);
      if(cmd==="uci")this.onmessage({data:"uciok"});
      if(cmd==="isready")this.onmessage({data:"readyok"});
      if(cmd.startsWith("go movetime"))this.onmessage({data:"bestmove e2e4"});
    }
    terminate(){}
  }
  const chrome={runtime:{
    getURL:path=>"chrome-extension://test/"+path,
    onMessage:{addListener:fn=>callbacks.push(fn)}
  }};
  vm.runInNewContext(read("engine-host.js"),{chrome,Worker,setTimeout,clearTimeout,
    Promise,Error,Number,console});
  const ask=(action,body={})=>new Promise(resolve=>{
    callbacks[0]({target:"standalone-engine",action,body},null,resolve);
  });
  assert.equal((await ask("ping")).ready,true);
  const fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const answer=await ask("analyze",{fen});
  assert.equal(answer.ok,true);
  assert.equal(answer.instruction,"Move pawn from e2 to e4");
  assert.ok(commands.includes("setoption name UCI_LimitStrength value false"));
  assert.ok(commands.includes("go movetime 1000"));
  assert.equal(commands.some(c=>c.includes("UCI_Elo")),false);
});
