import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";

const file=resolve(dirname(fileURLToPath(import.meta.url)),"..","..","extension","background.js");
const src=readFileSync(file,"utf8");

function harness({delayedPings=0,noListener=false,dropFirstRequest=false,existing=false}={}){
  let receiver,offscreenCreates=0,contextChecks=0,closed=0,pings=0;
  let exists=existing;
  let loseRequest=dropFirstRequest;
  const saved={coachHidden:false};
  const chrome={
    runtime:{
      id:"test-extension",
      getURL:path=>"chrome-extension://test-extension/"+path,
      getContexts:async()=>{contextChecks++;return exists?[{contextType:"OFFSCREEN_DOCUMENT"}]:[];},
      sendMessage:async message=>{
        if(message.target!=="standalone-engine")throw Error("Unexpected target");
        if(message.action==="ping"){
          pings++;
          if(noListener||pings<=delayedPings)
            throw Error("Could not establish connection. Receiving end does not exist.");
          return {ok:true,ready:true,host:"offscreen"};
        }
        if(loseRequest){
          loseRequest=false;
          throw Error("Could not establish connection. Receiving end does not exist.");
        }
        return {ok:true,stockfish:true,standalone:true,
          engine:"Stockfish 19 Full (WASM)",action:message.action};
      },
      onMessage:{addListener(fn){receiver=fn;}},
      onInstalled:{addListener(){}}
    },
    offscreen:{
      createDocument:async()=>{exists=true;offscreenCreates++;},
      closeDocument:async()=>{exists=false;closed++;}
    },
    storage:{local:{
      get:async defaults=>({...defaults,...saved}),
      set:async value=>Object.assign(saved,value)
    }},
    tabs:{
      onUpdated:{addListener(){}},
      onActivated:{addListener(){}},
      get:async()=>null,
      query:async()=>[]
    }
  };
  const nextTurn=fn=>{queueMicrotask(fn);return 1;};
  vm.runInNewContext(src,{chrome,URL,AbortController,Promise,
    setTimeout:nextTurn,clearTimeout:()=>{}});
  const sender={url:"https://www.chess.com/play/computer"};
  function request(action,more={}){
    return new Promise(resolve=>{
      assert.equal(receiver({action,...more},sender,resolve),true);
    });
  }
  return {chrome,request,saved,
    invoke:(message,sender,callback)=>receiver(message,sender,callback),
    get offscreenCreates(){return offscreenCreates;},
    get contextChecks(){return contextChecks;},
    get closes(){return closed;},
    get pings(){return pings;}};
}
test("Chrome 116 creates offscreen document and pings host before starting WASM",async()=>{
  const h=harness();
  const response=await h.request("health");
  assert.equal(response.ok,true);
  assert.equal(response.stockfish,true);
  assert.equal(h.contextChecks,1);
  assert.equal(h.offscreenCreates,1);
  assert.equal(h.pings,1);
});
test("delayed offscreen registration retries without breaking the first connection check",async()=>{
  const h=harness({delayedPings:3});
  const response=await h.request("health");
  assert.equal(response.ok,true);
  assert.equal(h.pings,4);
  assert.equal(h.offscreenCreates,1);
  assert.equal(h.closes,0);
});
test("a stale offscreen document is closed and recreated once",async()=>{
  const h=harness({noListener:true,existing:true});
  const result=await h.request("health");
  assert.equal(result.ok,false);
  assert.match(result.error,/offscreen engine script did not start/i);
  assert.match(result.error,/chrome:\/\/extensions/);
  assert.equal(h.closes,1);
  assert.equal(h.offscreenCreates,1);
  assert.equal(h.pings,40);
});
test("if host disappears after handshake, reconnect once and retry request",async()=>{
  const h=harness({dropFirstRequest:true});
  const result=await h.request("health");
  assert.equal(result.ok,true);
  assert.equal(result.stockfish,true);
  assert.equal(h.closes,1);
  assert.equal(h.offscreenCreates,2);
});
test("concurrent engine checks share one offscreen creation",async()=>{
  const h=harness({delayedPings:2});
  const results=await Promise.all([h.request("health"),h.request("health")]);
  assert.ok(results.every(x=>x.ok&&x.stockfish));
  assert.equal(h.offscreenCreates,1);
});
test("unused legacy control and history endpoints are rejected",()=>{
  const h=harness();
  for(const action of ["control","track","recover"]){
    assert.equal(h.invoke({action},{url:"https://www.chess.com/play/computer"},()=>{}),false);
  }
  assert.equal(h.contextChecks,0);
});
test("untrusted website messages cannot request internal engine operations",()=>{
  const h=harness();
  assert.equal(h.invoke({action:"health"},{url:"https://example.com"},()=>{}),false);
  assert.equal(h.invoke({action:"control",hidden:true},{url:"https://example.com"},()=>{}),false);
  assert.equal(h.offscreenCreates,0);
});
