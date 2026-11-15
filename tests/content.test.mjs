import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const initial='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const e4='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
const e5='rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};

function harness(respond){
  let now=0,serial=0,reads=0;
  const timers=new Map(),elements=new Map(),events=new Map(),observers=[];
  const requests=[];
  const state={placement:initial,myColor:'w',board:{isConnected:true}};
  const document={
    hidden:false,
    body:{appendChild(element){elements.set(element.id,element);}},
    getElementById(id){return elements.get(id);},
    createElement(){return {setAttribute(){},remove(){elements.delete(this.id);}};},
    addEventListener(name,callback){events.set(name,callback);}
  };
  const location={pathname:'/play/computer'};
  function timer(fn,delay,interval=0){
    const id=++serial;timers.set(id,{fn,at:now+delay,interval});return id;
  }
  const context={
    document,location,window:{addEventListener(){}},
    Date:{now:()=>now},
    setTimeout:(fn,delay=0)=>timer(fn,delay),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>timer(fn,delay,delay),clearInterval:id=>timers.delete(id),
    MutationObserver:class{
      constructor(callback){this.callback=callback;observers.push(this);}
      observe(board){this.board=board;}
      disconnect(){this.board=null;}
    },
    ChessCoachBoard:{initial,snapshot(){reads++;if(state.invalid)throw Error('Animating');return {...state};}},
    chrome:{runtime:{sendMessage(message,callback){
      requests.push(message);
      let response=respond?.(message,requests);
      if(response===undefined){
        if(message.action==='health')response={ok:true,stockfish:true};
        else if(message.action==='analyze')response={ok:true,instruction:'Move pawn from e2 to e4'};
        else response={ok:true,fen:state.placement+' b KQkq - 0 1'};
      }
      Promise.resolve(response).then(callback);
    }}}
  };
  vm.runInNewContext(source,context);
  return {
    state,requests,document,location,
    get reads(){return reads;},
    get timerCount(){return timers.size;},
    get text(){return elements.get('chess-study-no-share-overlay')?.textContent;},
    mutate(){for(const observer of observers)if(observer.board)observer.callback();},
    visibility(hidden){document.hidden=hidden;events.get('visibilitychange')();},
    async advance(ms){
      const end=now+ms;
      for(let step=0;step<10000;step++){
        const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next){now=end;await flush();return;}
        const [id,t]=next;now=t.at;
        if(t.interval)t.at+=t.interval;else timers.delete(id);
        t.fn();await flush();
      }
      throw Error('Timer loop did not settle');
    }
  };
}

test('unchanged boards do not cause repeated reads or engine requests',async()=>{
  const h=harness();await h.advance(0);
  assert.equal(h.text,'Move pawn from e2 to e4');
  const reads=h.reads,count=h.requests.length;
  await h.advance(60000);
  assert.equal(h.reads,reads);
  assert.equal(h.requests.length,count);
});

test('hidden tabs stop timers and observers, then catch up on return',async()=>{
  const h=harness();await h.advance(0);
  h.visibility(true);
  assert.equal(h.timerCount,0);
  const reads=h.reads,count=h.requests.length;
  h.state.placement=e4;h.mutate();await h.advance(60000);
  assert.equal(h.reads,reads);assert.equal(h.requests.length,count);
  h.visibility(false);await h.advance(0);
  assert.equal(h.requests.at(-1).action,'track');
  assert.equal(h.text,'Waiting for opponent');
});

test('piece animation events settle into one tracking request',async()=>{
  const h=harness();await h.advance(0);
  h.state.placement=e4;
  for(let i=0;i<10;i++){h.mutate();await h.advance(10);}
  assert.equal(h.requests.filter(r=>r.action==='track').length,0);
  await h.advance(180);
  assert.equal(h.requests.filter(r=>r.action==='track').length,1);
});

test('rejected positions are not retried until the board changes',async()=>{
  const h=harness(message=>message.action==='track'?{ok:false,status:400,error:'Lost'}:undefined);
  await h.advance(0);h.state.placement=e4;h.mutate();await h.advance(200);
  assert.match(h.text,/tracking lost/);
  for(let i=0;i<5;i++){h.mutate();await h.advance(2000);}
  assert.equal(h.requests.filter(r=>r.action==='track').length,1);
  h.state.placement=e5;h.mutate();await h.advance(200);
  assert.equal(h.requests.filter(r=>r.action==='track').length,2);
});

test('temporary server failures back off and retry the pending analysis',async()=>{
  let attempts=0;
  const h=harness(message=>message.action==='analyze'&&++attempts===1
    ?{ok:false,status:503,error:'Unavailable'}:undefined);
  await h.advance(0);assert.equal(attempts,1);
  for(let i=0;i<8;i++){h.mutate();await h.advance(1000);}
  assert.equal(attempts,1);
  await h.advance(2000);
  assert.equal(attempts,2);assert.equal(h.text,'Move pawn from e2 to e4');
});

test('an answer arriving after hiding cannot replace the paused display',async()=>{
  let finish;
  const h=harness(message=>message.action==='analyze'?new Promise(resolve=>{finish=resolve;}):undefined);
  await h.advance(0);assert.equal(h.text,'Analyzing…');
  h.visibility(true);finish({ok:true,instruction:'Stale answer'});await flush();
  assert.equal(h.text,'Analyzing…');assert.equal(h.timerCount,0);
});

test('a move during analysis is tracked without displaying the stale answer',async()=>{
  let finish;
  const h=harness(message=>message.action==='analyze'?new Promise(resolve=>{finish=resolve;}):undefined);
  await h.advance(0);
  h.state.placement=e4;h.mutate();await h.advance(200);
  finish({ok:true,instruction:'Stale answer'});await flush();await h.advance(200);
  assert.equal(h.text,'Waiting for opponent');
  assert.equal(h.requests.filter(r=>r.action==='track').length,1);
});

test('new games on a reused board restart from the initial position',async()=>{
  const h=harness();await h.advance(0);
  h.state.placement=e4;h.mutate();await h.advance(200);
  assert.equal(h.text,'Waiting for opponent');
  h.state.placement=initial;h.mutate();await h.advance(200);
  assert.equal(h.requests.at(-1).action,'analyze');
  assert.equal(h.requests.at(-1).fen,initial+' w KQkq - 0 1');
});

test('leaving a supported route removes the overlay and stops board work',async()=>{
  const h=harness();await h.advance(0);
  const count=h.requests.length;
  h.location.pathname='/play/online';h.mutate();await h.advance(10000);
  assert.equal(h.requests.length,count);assert.equal(h.text,undefined);
  h.location.pathname='/play/computer';await h.advance(2000);
  assert.equal(h.text,'Move pawn from e2 to e4');
});

test('returning before an old request finishes still resumes analysis',async()=>{
  let finish,attempts=0;
  const h=harness(message=>message.action==='analyze'&&++attempts===1
    ?new Promise(resolve=>{finish=resolve;}):undefined);
  await h.advance(0);
  h.visibility(true);h.visibility(false);await h.advance(0);
  finish({ok:true,instruction:'Stale answer'});await flush();await h.advance(200);
  assert.equal(attempts,2);
  assert.equal(h.text,'Move pawn from e2 to e4');
});

test('temporary piece overlap restores the last verified instruction',async()=>{
  const h=harness();await h.advance(0);
  const count=h.requests.length;
  h.state.invalid=true;h.mutate();await h.advance(200);
  assert.match(h.text,/Board updating/);
  h.state.invalid=false;h.mutate();await h.advance(200);
  assert.equal(h.text,'Move pawn from e2 to e4');
  assert.equal(h.requests.length,count);
});

test('returning to the last verified position clears a tracking error',async()=>{
  const h=harness(message=>message.action==='track'?{ok:false,status:400,error:'Lost'}:undefined);
  await h.advance(0);h.state.placement=e4;h.mutate();await h.advance(200);
  assert.match(h.text,/tracking lost/);
  h.state.placement=initial;h.mutate();await h.advance(200);
  assert.equal(h.text,'Move pawn from e2 to e4');
});
