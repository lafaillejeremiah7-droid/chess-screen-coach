import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../../extension/background.js",import.meta.url),"utf8");
test("one offscreen host serves analysis without extra controls",async()=>{
  let listener,created=0,searches=0,exists=false;
  const chrome={
    runtime:{
      getURL:path=>"chrome-extension://test/"+path,
      getContexts:async()=>exists?[{}]:[],
      sendMessage:async msg=>{
        if(msg.action==="ping")return {ok:true,ready:true};
        if(msg.action==="analyze"){searches++;return {ok:true,instruction:"Move pawn from e2 to e4"};}
        throw Error("Unexpected request");
      },
      onMessage:{addListener:fn=>listener=fn}
    },
    offscreen:{
      createDocument:async()=>{created++;exists=true;},
      closeDocument:async()=>{exists=false;}
    }
  };
  vm.runInNewContext(source,{chrome,URL,Promise,setTimeout,clearTimeout});
  const fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const request=(url,action)=>new Promise(resolve=>{
    const accepted=listener({action,fen},{url},resolve);
    if(!accepted)resolve({blocked:true});
  });
  assert.equal((await request("https://www.chess.com/game/live/123","analyze")).ok,true);
  assert.equal((await request("https://chess.com/analysis","analyze")).ok,true);
  assert.equal(created,1);
  assert.equal(searches,2);
  assert.equal((await request("https://example.com","analyze")).blocked,true);
  assert.equal((await request("https://www.chess.com/play/computer","control")).blocked,true);
});
