import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";

const file=resolve(dirname(fileURLToPath(import.meta.url)),"..","..","extension","background.js");
const src=readFileSync(file,"utf8");

function harness(){
  let receiver,offscreenCreates=0,contextChecks=0;
  const saved={coachHidden:false};
  const chrome={
    runtime:{
      id:"test-extension",
      getURL:path=>"chrome-extension://test-extension/"+path,
      getContexts:async()=>{contextChecks++;return [];},
      sendMessage:async message=>({
        ok:true,stockfish:true,standalone:true,
        engine:"Stockfish 19 Lite (WASM)",action:message.action
      }),
      onMessage:{addListener(fn){receiver=fn;}},
      onInstalled:{addListener(){}}
    },
    offscreen:{
      createDocument:async()=>{offscreenCreates++;}
      // hasDocument intentionally absent: only available in newer Chrome.
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
  vm.runInNewContext(src,{chrome,URL,AbortController,Promise,setTimeout,clearTimeout});
  const sender={url:"https://www.chess.com/play/computer"};
  function request(action,more={}){
    return new Promise(resolve=>{
      assert.equal(receiver({action,...more},sender,resolve),true);
    });
  }
  return {chrome,request,invoke:(message,sender,callback)=>receiver(message,sender,callback),saved,get offscreenCreates(){return offscreenCreates;},
    get contextChecks(){return contextChecks;}};
}
test("Chrome 116 offscreen creation uses getContexts, not hasDocument",async()=>{
  const h=harness();
  const response=await h.request("health");
  assert.equal(response.ok,true);
  assert.equal(response.stockfish,true);
  assert.equal(h.contextChecks,1);
  assert.equal(h.offscreenCreates,1);
});
test("pause state uses service-worker storage and never opens offscreen engine",async()=>{
  const h=harness();
  const a=await h.request("control",{hidden:true});
  assert.equal(a.ok,true);
  assert.equal(a.hidden,true);
  assert.equal(h.saved.coachHidden,true);
  assert.equal(h.contextChecks,0);
  assert.equal(h.offscreenCreates,0);
  const b=await h.request("control",{hidden:false});
  assert.equal(b.ok,true);
  assert.equal(b.hidden,false);
  assert.equal(h.saved.coachHidden,false);
});
test("untrusted website messages cannot request internal engine operations",()=>{
  const h=harness();
  assert.equal(h.invoke({action:"health"},{url:"https://example.com"},()=>{}),false);
  assert.equal(h.invoke({action:"control",hidden:true},{url:"https://example.com"},()=>{}),false);
  assert.equal(h.offscreenCreates,0);
});
