import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../extension/background.js",import.meta.url),"utf8");
const fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function harness(){
  const requests=[],answers=[];
  let receiver;
  const chrome={runtime:{onMessage:{addListener(fn){receiver=fn;}}}};
  const fetch=(_url,options)=>new Promise((resolve,reject)=>{
    const request={options,resolve:body=>resolve({ok:true,json:async()=>body})};
    options.signal.addEventListener("abort",()=>{
      request.aborted=true;
      reject(Error("aborted"));
    });
    requests.push(request);
  });
  vm.runInNewContext(source,{chrome,fetch,URL,AbortController,Promise});
  function send(type,tabId=1,sourceUrl="https://www.chess.com/play/online"){
    const msg={type,fen};
    let answer;
    const accepted=receiver(msg,{url:sourceUrl,tab:{id:tabId},frameId:0},
      value=>{answer=value;answers.push(value);});
    return {accepted,read:()=>answer};
  }
  return {requests,answers,send};
}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

test("newer analysis aborts prior HTTP fetch from the same tab",async()=>{
  const h=harness();
  const first=h.send("analyze");
  const second=h.send("analyze");
  assert.equal(first.accepted,true);
  assert.equal(second.accepted,true);
  assert.equal(h.requests[0].aborted,true);
  assert.equal(h.requests[1].aborted,undefined);
  h.requests[1].resolve({instruction:"CURRENT"});
  await flush();
  assert.equal(second.read().instruction,"CURRENT");
  assert.equal(first.read().ok,false);
});

test("cancel aborts work immediately when board disappears",async()=>{
  const h=harness();
  h.send("analyze");
  const cancelled=h.send("cancel");
  assert.equal(cancelled.read().ok,true);
  assert.equal(h.requests[0].aborted,true);
  await flush();
});

test("one tab does not cancel another tab's search",()=>{
  const h=harness();
  h.send("analyze",1);
  h.send("analyze",2);
  assert.equal(h.requests[0].aborted,undefined);
  assert.equal(h.requests[1].aborted,undefined);
  h.send("cancel",1);
  assert.equal(h.requests[0].aborted,true);
  assert.equal(h.requests[1].aborted,undefined);
});

test("rejects untrusted senders and non-analysis requests",()=>{
  const h=harness();
  assert.equal(h.send("analyze",1,"https://example.com/").accepted,false);
  assert.equal(h.send("analyze",1,"http://chess.com/").accepted,false);
  assert.equal(h.send("other").accepted,false);
  assert.equal(h.requests.length,0);
});
