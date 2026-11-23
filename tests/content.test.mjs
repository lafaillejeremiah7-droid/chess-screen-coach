import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const source = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
const MOVED = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

function harness(){
  let now=10000, nextId=0, overlay=null;
  const timers=new Map(), intervals=[], events=new Map(), requests=[], cancels=[];
  const observations=[];
  const layout={};
  function makeBoard(){
    return {closest:()=>layout, parentElement:layout};
  }
  const state={board:makeBoard(),fen:START,missing:false,invalid:false};
  const document={
    hidden:false,
    body:{appendChild(node){overlay=node;}},
    createElement(){
      return {style:{},textContent:"",id:""};
    },
    addEventListener(event,callback){events.set(event,callback);}
  };
  const chrome={runtime:{
    lastError:null,
    sendMessage(msg,respond){
      if(msg.type==="cancel"){
        cancels.push(msg);
        respond?.({ok:true});
      }else requests.push({msg,respond});
    }
  }};
  class MutationObserver{
    constructor(callback){this.callback=callback;observations.push(this);}
    observe(target){this.target=target;}
    disconnect(){this.target=null;}
  }
  const reader={
    snapshot(){
      if(state.invalid)throw Error("Board updating");
      return state.missing?null:{board:state.board};
    },
    currentFen(){return {fen:state.fen};}
  };
  vm.runInNewContext(source,{document,chrome,MutationObserver,
    ChessCoachBoard:reader,
    setTimeout(fn,delay){const id=++nextId;timers.set(id,{fn,delay});return id;},
    clearTimeout(id){timers.delete(id);},
    setInterval(fn){intervals.push(fn);},
    Date:{now:()=>now}
  });
  return {
    state,requests,cancels,observations,
    get text(){return overlay?.textContent;},
    poll(){intervals[0]();},
    visibility(hidden){document.hidden=hidden;events.get("visibilitychange")();},
    respond(index,data){requests[index].respond(data);},
    flush(){const items=[...timers.values()];timers.clear();for(const item of items)item.fn();},
    setNow(value){now=value;},
    makeBoard
  };
}

test("current FEN is sent once; duplicate polls do not queue searches",()=>{
  const h=harness();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].msg.fen,START);
  for(let i=0;i<20;i++)h.poll();
  assert.equal(h.requests.length,1);
  h.respond(0,{ok:true,instruction:"Move pawn from e2 to e4"});
  assert.match(h.text,/Move pawn/);
  for(let i=0;i<20;i++)h.poll();
  assert.equal(h.requests.length,1);
});

test("reply is rejected when pieces change before the polling interval",()=>{
  const h=harness();
  h.state.fen=MOVED;
  h.respond(0,{ok:true,instruction:"STALE MOVE"});
  assert.notEqual(h.text,"STALE MOVE");
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].msg.fen,MOVED);
  h.respond(1,{ok:true,instruction:"Move knight from g8 to f6"});
  assert.equal(h.text,"Move knight from g8 to f6");
});

test("old reply never replaces the newer position",()=>{
  const h=harness();
  h.state.fen=MOVED;
  h.poll();
  assert.equal(h.requests.length,2);
  assert.equal(h.cancels.length,1);
  h.respond(0,{ok:true,instruction:"STALE MOVE"});
  assert.notEqual(h.text,"STALE MOVE");
  h.respond(1,{ok:true,instruction:"CURRENT MOVE"});
  assert.equal(h.text,"CURRENT MOVE");
});

test("whose-turn change triggers analysis even if every piece stays put",()=>{
  const h=harness();
  h.respond(0,{ok:true,instruction:"WHITE MOVE"});
  h.state.fen=BLACK;
  h.poll();
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].msg.fen,BLACK);
  assert.notEqual(h.text,"WHITE MOVE");
});

test("board replacement invalidates a move even with identical FEN",()=>{
  const h=harness();
  h.respond(0,{ok:true,instruction:"OLD BOARD"});
  h.state.board=h.makeBoard();
  h.poll();
  assert.equal(h.requests.length,2);
  assert.notEqual(h.text,"OLD BOARD");
});

test("blackout hides previous suggestion and recovers on same position",()=>{
  const h=harness();
  h.respond(0,{ok:true,instruction:"OLD MOVE"});
  h.state.missing=true;
  h.poll();
  assert.match(h.text,/Waiting for chessboard/);
  h.state.missing=false;
  h.poll();
  assert.equal(h.requests.length,2);
  h.respond(1,{ok:true,instruction:"NEW MOVE"});
  assert.equal(h.text,"NEW MOVE");
});

test("invalid board during analysis aborts the old request",()=>{
  const h=harness();
  h.state.invalid=true;
  h.poll();
  assert.equal(h.cancels.length,1);
  h.respond(0,{ok:true,instruction:"STALE"});
  assert.notEqual(h.text,"STALE");
  h.state.invalid=false;
  h.poll();
  assert.equal(h.requests.length,2);
});

test("hidden tab rejects replies and resynchronizes when visible",()=>{
  const h=harness();
  h.visibility(true);
  assert.equal(h.cancels.length,1);
  h.respond(0,{ok:true,instruction:"HIDDEN MOVE"});
  assert.notEqual(h.text,"HIDDEN MOVE");
  h.visibility(false);
  assert.equal(h.requests.length,2);
});

test("DOM observer also watches the surrounding clock layout",()=>{
  const h=harness();
  assert.equal(h.observations.length,2);
  assert.equal(h.observations[0].target,h.state.board);
  assert.ok(h.observations[1].target);
  h.state.fen=BLACK;
  h.observations[1].callback();
  h.flush();
  assert.equal(h.requests.length,2);
});

test("failed search backs off instead of repeatedly flooding the server",()=>{
  const h=harness();
  h.respond(0,{ok:false,error:"Cannot reach the local engine"});
  assert.match(h.text,/Cannot reach the local engine/);
  h.poll();
  assert.equal(h.requests.length,1);
  h.setNow(12000);
  h.poll();
  assert.equal(h.requests.length,2);
});

test("rejected board waits for a new position",()=>{
  const h=harness();
  h.respond(0,{ok:false,status:400,error:"Game over: no legal move"});
  assert.match(h.text,/Game over/);
  h.setNow(14000);
  h.poll();
  assert.equal(h.requests.length,1);
  h.state.fen=MOVED;
  h.poll();
  assert.equal(h.requests.length,2);
});
