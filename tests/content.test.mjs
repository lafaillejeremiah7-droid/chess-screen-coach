import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../extension/content.js",import.meta.url),"utf8");
test("live agent analyzes the current board without Elo or game-mode settings",()=>{
  const calls=[],timers=[];
  const makeElement=()=>({
    style:{cssText:""},textContent:"",isConnected:false,
    appendChild(){},attachShadow(){return {appendChild(){}};}
  });
  const document={
    body:{appendChild(el){el.isConnected=true;}},
    createElement:makeElement
  };
  const chrome={runtime:{
    lastError:null,
    sendMessage(message,callback){
      calls.push(message);
      callback({ok:true,instruction:"Move pawn from e2 to e4"});
    }
  }};
  const context={document,chrome,
    ChessCoachBoard:{
      snapshot(){return {board:{}};},
      currentFen(){return {fen:"8/8/8/8/8/8/8/K6k w - - 0 1"};}
    },
    MutationObserver:class{observe(){}disconnect(){}},
    setTimeout(fn){timers.push(fn);return timers.length;},
    clearTimeout(){},setInterval(){}
  };
  vm.runInNewContext(source,context);
  timers.shift()();
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,"analyze");
  assert.equal(calls[0].elo,undefined);
  assert.equal(calls[0].seconds,undefined);
  assert.match(calls[0].fen,/ w /);
  assert.doesNotMatch(source,/moveHistory|recoverPosition|trackPosition|playerSide/);
});
