import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const initial='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const e4='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
const e5='rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};

function harness(respond,pathname='/play/computer'){
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
  const location={pathname,protocol:'https:',hostname:'www.chess.com'};
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
    ChessCoachBoard:{initial,snapshot(){reads++;if(state.invalid)throw Error('Animating');if(state.missing)return null;return {...state};}},
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

test('unchanged boards are checked periodically without repeated engine requests',async()=>{
  const h=harness();await h.advance(0);
  assert.equal(h.text,'Move pawn from e2 to e4');
  const reads=h.reads,count=h.requests.length;
  await h.advance(60000);
  assert.ok(h.reads>reads&&h.reads<reads+20);
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

test('Chess.com human-game route is eligible for engine analysis',async()=>{
  const h=harness(undefined,'/play/online');
  await h.advance(0);
  assert.equal(h.text,'Move pawn from e2 to e4');
  assert.deepEqual(h.requests.map(x=>x.action),['health','analyze']);
  h.state.placement=e4;h.mutate();await h.advance(200);
  assert.equal(h.requests.at(-1).action,'track');
});

test('Chess.com analysis route remains eligible',async()=>{
  const h=harness(undefined,'/analysis');
  await h.advance(0);
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

test('a verified FEN attribute allows automatic mid-position recovery',async()=>{
  const h=harness();
  h.state.placement=e4;
  h.state.fen=e4+' b KQkq - 0 1';
  h.state.myColor='b';
  await h.advance(0);
  assert.equal(h.requests.at(-1).action,'analyze');
  assert.equal(h.requests.at(-1).fen,h.state.fen);
  assert.equal(h.text,'Move pawn from e2 to e4');
});
test('flipping an existing board keeps position history',async()=>{
  const h=harness();
  await h.advance(0);
  h.state.placement=e4;h.mutate();await h.advance(200);
  assert.equal(h.text,'Waiting for opponent');
  h.state.myColor='b';h.mutate();await h.advance(200);
  assert.equal(h.requests.at(-1).action,'analyze');
  assert.equal(h.requests.at(-1).fen,e4+' b KQkq - 0 1');
});
test('transient malformed board recovers without another mutation event',async()=>{
  const h=harness();await h.advance(0);
  h.state.invalid=true;h.mutate();await h.advance(200);
  assert.match(h.text,/Board updating/);
  h.state.invalid=false;
  await h.advance(450);
  assert.equal(h.text,'Move pawn from e2 to e4');
});
test('temporary blank board hides the old move, then recovers',async()=>{
  const h=harness();await h.advance(0);
  h.state.missing=true;h.mutate();await h.advance(200);
  assert.match(h.text,/unavailable; waiting/);
  h.state.missing=false;
  await h.advance(4000);
  assert.equal(h.text,'Move pawn from e2 to e4');
});
test('replaced board preserves a midgame position without restarting',async()=>{
  const h=harness();await h.advance(0);
  h.state.placement=e4;h.mutate();await h.advance(200);
  const tracked=h.requests.filter(x=>x.action==='track');
  assert.equal(tracked.length,1);
  assert.equal(h.text,'Waiting for opponent');
  h.state.missing=true;h.mutate();await h.advance(200);
  assert.match(h.text,/Chessboard unavailable/);
  h.state.board={isConnected:true}; // Chess.com re-renders the board node
  h.state.missing=false;
  await h.advance(4000);
  assert.equal(h.text,'Waiting for opponent');
  assert.equal(h.requests.filter(x=>x.action==='track').length,1);
  h.state.placement=e5;h.mutate();await h.advance(200);
  assert.equal(h.requests.at(-1).action,'track');
  assert.equal(h.requests.at(-1).previous,e4+' b KQkq - 0 1');
});
test('replaced board on the same turn reanalyzes verified position',async()=>{
  const h=harness();await h.advance(0);
  const first=h.requests.filter(x=>x.action==='analyze').length;
  h.state.missing=true;h.mutate();await h.advance(200);
  h.state.board={isConnected:true};
  h.state.missing=false;
  await h.advance(4000);
  assert.equal(h.text,'Move pawn from e2 to e4');
  assert.ok(h.requests.filter(x=>x.action==='analyze').length>first);
});
