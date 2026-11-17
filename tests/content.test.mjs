import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const initial='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const e4='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
const e5='rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};

function harness(respond,pathname='/play/computer',options=null){
  let now=0,serial=0,reads=0;
  const timers=new Map(),elements=new Map(),events=new Map(),observers=[];
  const requests=[],controlRequests=[];
  const serverState={hidden:false};
  const state={placement:initial,myColor:'w',board:{isConnected:true}};
  const document={
    hidden:false,
    body:{appendChild(element){elements.set(element.id,element);}},
    getElementById(id){return elements.get(id)||elements.get('chess-study-no-share-overlay')?.querySelector('#'+id);},
    createElement(){
      return {
        _text:'',children:[],listeners:new Map(),
        set textContent(value){this._text=String(value);this.children=[];},
        get textContent(){return this._text+this.children.map(x=>x.textContent).join('');},
        setAttribute(){},
        appendChild(child){this.children.push(child);},
        append(...children){for(const child of children)this.appendChild(child);},
        querySelector(selector){
          if(selector[0]!=='#')return null;
          const id=selector.slice(1);
          const queue=[...this.children];
          while(queue.length){
            const child=queue.shift();
            if(child.id===id)return child;
            queue.push(...child.children);
          }
          return null;
        },
        addEventListener(name,callback){this.listeners.set(name,callback);},
        dispatch(name){this.listeners.get(name)?.();},
        remove(){elements.delete(this.id);}
      };
    },
    addEventListener(name,callback){const listeners=events.get(name)||[];listeners.push(callback);events.set(name,listeners);}
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
      if(message.action==='control')controlRequests.push(message);
      else requests.push(message);
      if(message.action==='control'&&typeof message.hidden==='boolean')
        serverState.hidden=message.hidden;
      let response=respond?.(message,requests);
      if(response===undefined){
        if(message.action==='control')response={ok:true,hidden:serverState.hidden};
        else if(message.action==='health')response={ok:true,stockfish:true};
        else if(message.action==='analyze')response={ok:true,instruction:'Move pawn from e2 to e4'};
        else response={ok:true,fen:state.placement+' b KQkq - 0 1'};
      }
      Promise.resolve(response).then(callback);
    }}}
  };
  if(options){
    context.chrome.storage={
      local:{get(_defaults,callback){callback(options);}},
      onChanged:{addListener(){}}
    };
  }
  vm.runInNewContext(source,context);
  return {
    state,requests,controlRequests,serverState,document,location,
    get reads(){return reads;},
    get timerCount(){return timers.size;},
    get text(){return elements.get('chess-study-no-share-overlay')?.querySelector('#chess-study-no-share-message')?.textContent;},
    mutate(){for(const observer of observers)if(observer.board)observer.callback();},
    visibility(hidden){document.hidden=hidden;for(const listener of events.get('visibilitychange')||[])listener();},
    key(key,overrides={}){for(const listener of events.get('keydown')||[])listener({key,repeat:false,isComposing:false,ctrlKey:false,altKey:false,metaKey:false,target:{tagName:'BODY',isContentEditable:false},...overrides});},
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

test('default engine request uses one second',async()=>{
  const h=harness();
  await h.advance(0);
  const first=h.requests.find(message=>message.action==='analyze');
  assert.equal(first.seconds,1);
  assert.equal(first.elo,1650);
});
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

test('practice routes share the same engine and H-key controls',async()=>{
  for(const route of ['/analysis','/play/computer','/puzzles']){
    const h=harness(undefined,route);
    await h.advance(0);
    assert.equal(h.text,'Move pawn from e2 to e4');
    assert.deepEqual(h.requests.map(x=>x.action),['health','analyze']);
    h.key('h');
    assert.equal(h.text,undefined);
    assert.equal(h.serverState.hidden,true);
    h.key('h');
    await h.advance(0);
    assert.equal(h.text,'Move pawn from e2 to e4');
  }
});

test('live human-game routes never request engine recommendations',async()=>{
  for(const route of ['/play/online','/game/live/123']){
    const h=harness(undefined,route);
    await h.advance(5000);
    assert.equal(h.text,undefined);
    assert.equal(h.requests.length,0);
  }
});

test('fresh midgame position can reconstruct FEN from a complete history',async()=>{
  const h=harness(message=>message.action==='recover'
    ?{ok:true,fen:e5+' w KQkq - 0 2'}:undefined);
  h.state.placement=e5;
  h.state.moves=['e4','e5'];
  await h.advance(0);
  assert.deepEqual(h.requests.map(x=>x.action),['health','recover','analyze']);
  assert.equal(h.requests.at(-1).fen,e5+' w KQkq - 0 2');
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
test('board flip never changes the chosen player color',async()=>{
  const h=harness();
  await h.advance(0);
  h.state.placement=e4;h.mutate();await h.advance(200);
  assert.equal(h.text,'Waiting for opponent');
  const count=h.requests.filter(x=>x.action==='analyze').length;
  h.state.myColor='b';h.mutate();await h.advance(200);
  assert.equal(h.text,'Waiting for opponent');
  assert.equal(h.requests.filter(x=>x.action==='analyze').length,count);
});
test('explicit Black side overrides White-at-bottom orientation',async()=>{
  const h=harness(undefined,'/play/computer',{playerSide:'b',thinkSeconds:0.5,showDetails:false});
  await h.advance(0);
  assert.equal(h.text,'Waiting for opponent');
  h.state.placement=e4;h.mutate();await h.advance(200);
  assert.equal(h.requests.at(-1).action,'analyze');
  assert.equal(h.requests.at(-1).seconds,0.5);
  assert.equal(h.requests.at(-1).fen,e4+' b KQkq - 0 1');
});
test('optional analysis diagnostics render on practice pages only',async()=>{
  const respond=m=>m.action==='analyze'
    ?{ok:true,instruction:'Move pawn from e2 to e4',reason:'Occupies the center.',depth:17,score_cp:45}:undefined;
  const settings={playerSide:'w',thinkSeconds:1,showDetails:true};
  const practice=harness(respond,'/play/computer',settings);
  await practice.advance(0);
  assert.match(practice.text,/Depth 17/);
  assert.match(practice.text,/Eval 0.45/);
  assert.equal(practice.requests.at(-1).seconds,1);
  const other=harness(respond,'/play/online',settings);
  await other.advance(0);
  assert.equal(other.text,undefined);
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

test('H hides the entire coach and pauses observation and engine requests until restored',async()=>{
  const h=harness();await h.advance(0);
  assert.equal(h.text,'Move pawn from e2 to e4');
  const count=h.requests.length,reads=h.reads;
  h.key('h');
  assert.equal(h.text,undefined);
  assert.equal(h.timerCount,1); // Only the control-state sync timer remains.
  h.state.placement=e4;h.mutate();await h.advance(12000);
  assert.equal(h.requests.length,count);
  assert.equal(h.reads,reads);
  h.key('H');
  await h.advance(0);
  assert.equal(h.requests.at(-1).action,'track');
  assert.equal(h.text,'Waiting for opponent');
});

test('H is ignored while typing, with modifiers, or during key auto-repeat',async()=>{
  const h=harness();await h.advance(0);
  for(const opts of [
    {repeat:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true},
    {target:{tagName:'INPUT'}},{target:{tagName:'TEXTAREA'}},
    {target:{tagName:'DIV',isContentEditable:true}}
  ])h.key('h',opts);
  assert.equal(h.text,'Move pawn from e2 to e4');
  h.key('h');
  assert.equal(h.text,undefined);
});

test('a pending engine reply never reappears after H hides the coach',async()=>{
  let finish;
  const h=harness(m=>m.action==='analyze'?new Promise(resolve=>{finish=resolve;}):undefined);
  await h.advance(0);
  assert.equal(h.text,'Analyzing…');
  h.key('h');
  finish({ok:true,instruction:'Stale best move'});
  await flush();
  assert.equal(h.text,undefined);
  assert.equal(h.timerCount,1); // No board watching or engine polling.
});

test('persisted hidden setting blocks initial board reads and engine requests',async()=>{
  const h=harness(undefined,'/analysis',{playerSide:'w',thinkSeconds:1,showDetails:false,coachHidden:true});
  await h.advance(12000);
  assert.equal(h.reads,0);
  assert.equal(h.requests.length,0);
  h.key('h');
  await h.advance(0);
  assert.equal(h.text,'Move pawn from e2 to e4');
});

test('history resync is attempted after a rejected multi-move transition',async()=>{
  const h=harness(message=>{
    if(message.action==='track')return {ok:false,status:400,error:'Too many moves'};
    if(message.action==='recover')return {ok:true,fen:e5+' w KQkq - 0 2'};
  });
  await h.advance(0);
  h.state.placement=e5;h.state.moves=['e4','e5'];
  h.mutate();await h.advance(200);
  assert.equal(h.requests.at(-1).action,'analyze');
  assert.ok(h.requests.some(m=>m.action==='recover'));
});

test('H control updates local server even when the move overlay is removed',async()=>{
  const h=harness();await h.advance(0);
  h.key('h');
  await h.advance(0);
  assert.equal(h.controlRequests.at(-1).hidden,true);
  h.key('h');
  await h.advance(0);
  assert.equal(h.controlRequests.at(-1).hidden,false);
});

test('visibility changes made by the dashboard propagate to the extension',async()=>{
  const h=harness();
  await h.advance(0);
  h.serverState.hidden=true;
  await h.advance(4100);
  assert.equal(h.text,undefined);
  assert.equal(h.requests.filter(x=>x.action==='analyze').length,1);
  h.serverState.hidden=false;
  await h.advance(2200);
  assert.equal(h.text,'Move pawn from e2 to e4');
});
