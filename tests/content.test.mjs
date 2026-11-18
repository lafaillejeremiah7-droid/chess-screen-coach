import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const initial='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const e4='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
const e5='rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR';
const middle='r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

function harness(respond,pathname='/play/computer',options=null){
  let now=0,serial=0,reads=0;
  const timers=new Map(),elements=new Map(),events=new Map(),observers=[];
  const requests=[],controlRequests=[],contentListeners=[];
  const state={placement:initial,turn:'w',castling:'KQkq',enPassant:'-',
    myColor:'w',board:{isConnected:true}};
  let hiddenState=options?.serverHidden===true;
  const document={
    hidden:false,
    body:{appendChild(el){elements.set(el.id,el);}},
    getElementById(id){return elements.get(id);},
    createElement(){
      const el={setAttribute(){},remove(){elements.delete(this.id);}};
      if(options?.shadowSupport){
        el.style={setProperty(){}};
        el.attachShadow=()=>{
          const children=new Map();
          const root={appendChild(child){if(child.id)children.set(child.id);},
            getElementById(id){return children.get(id);}};
          el.shadowRoot=root;
          return root;
        };
      }
      return el;
    },
    addEventListener(name,cb){const listeners=events.get(name)||[];listeners.push(cb);events.set(name,listeners);}
  };
  const location={pathname,protocol:'https:',hostname:'www.chess.com'};
  const timer=(fn,delay,interval=0)=>{
    const id=++serial;timers.set(id,{fn,at:now+delay,interval});return id;
  };
  const chrome={
    runtime:{
      onMessage:{addListener(cb){contentListeners.push(cb);}},
      sendMessage(message,callback){
        if(message.action==='control')controlRequests.push(message);
        else requests.push(message);
        if(message.action==='control'&&typeof message.hidden==='boolean')
          hiddenState=message.hidden;
        const custom=respond?.(message,requests);
        const response=custom===undefined?
          message.action==='control'?{ok:true,hidden:hiddenState}:
          message.action==='health'?{ok:true,stockfish:true}:
          message.action==='analyze'?{ok:true,instruction:'Move pawn from e2 to e4'}:
          {ok:false,error:'History-dependent tracking must not be called'}:
          custom;
        Promise.resolve(response).then(callback);
      }
    }
  };
  if(options)chrome.storage={local:{get(_defaults,callback){callback(options);},set(){}},
    onChanged:{addListener(){}}};
  const context={
    document,location,chrome,window:{addEventListener(){}},
    Date:{now:()=>now},
    setTimeout:(fn,delay=0)=>timer(fn,delay),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>timer(fn,delay,delay),clearInterval:id=>timers.delete(id),
    MutationObserver:class{
      constructor(cb){this.callback=cb;observers.push(this);}
      observe(board){this.board=board;}
      disconnect(){this.board=null;}
    },
    ChessCoachBoard:{initial,
      findBoard(){return state.missing?null:state.board;},
      snapshot(){
        reads++;
        if(state.invalid)throw Error('Animating');
        if(state.missing)return null;
        return {...state};
      },
      currentFen(snapshot){
        if(snapshot.turnConflict)throw Error('Turn indicators disagree; waiting for synchronization.');
        if(!snapshot.turn)throw Error('Turn unknown — waiting for active clock or turn indicator.');
        if(snapshot.fen)return {fen:snapshot.fen,turnVerified:true,rulesVerified:true};
        return {fen:snapshot.placement+' '+snapshot.turn+' '+(snapshot.castling||'-')+
            ' '+(snapshot.enPassant||'-')+' 0 1',
          turnVerified:true,
          rulesVerified:snapshot.castling!=null&&snapshot.enPassant!=null};
      }
    }
  };
  vm.runInNewContext(script,context);
  const dispatch=action=>{
    let response;
    for(const listener of contentListeners)
      listener({action},null,value=>{response=value;});
    return response;
  };
  return{
    state,requests,controlRequests,document,location,dispatch,
    get text(){return elements.get('chess-study-no-share-overlay')?.textContent;},
    get shadowText(){return elements.get('chess-study-no-share-overlay')?.shadowRoot?.getElementById('chess-study-no-share-overlay-text')?.textContent;},
    get reads(){return reads;},
    mutate(){for(const observer of observers)if(observer.board)observer.callback();},
    visibility(hidden){document.hidden=hidden;for(const cb of events.get('visibilitychange')||[])cb();},
    key(key,changes={}){for(const cb of events.get('keydown')||[])cb({
      key,repeat:false,isComposing:false,ctrlKey:false,altKey:false,metaKey:false,
      target:{tagName:'BODY',isContentEditable:false},...changes});},
    async advance(ms){
      const end=now+ms;
      for(let i=0;i<12000;i++){
        const next=[...timers.entries()].filter(([,t])=>t.at<=end)
          .sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next){now=end;await flush();return;}
        const [id,t]=next;now=t.at;
        if(t.interval)t.at+=t.interval;else timers.delete(id);
        t.fn();await flush();
      }
      throw Error('Timer loop failed to settle');
    }
  };
}
const analyses=h=>h.requests.filter(r=>r.action==='analyze');
const assertNoHistory=h=>assert.equal(
  h.requests.filter(r=>['track','recover','advance'].includes(r.action)).length,0);

test('starting position analyzes live DOM placement with full Stockfish and 1s default',async()=>{
  const h=harness();
  await h.advance(0);
  assert.equal(analyses(h).length,1);
  assert.equal(analyses(h)[0].fen,initial+' w KQkq - 0 1');
  assert.equal(analyses(h)[0].elo,'full');
  assert.equal(analyses(h)[0].seconds,1);
  assertNoHistory(h);
});
test('middle-of-game board can be read without any old position or moves',async()=>{
  const h=harness(undefined,'/analysis');
  h.state.placement=middle;h.state.turn='w';h.state.castling=null;
  h.state.enPassant=null;h.state.moves=[];
  await h.advance(0);
  assert.equal(analyses(h)[0].fen,middle+' w - - 0 1');
  assert.match(h.text,/Rule rights unverified:/);
  assertNoHistory(h);
});
test('jumping across multiple pieces never requires tracking or history reconstruction',async()=>{
  const h=harness();
  await h.advance(0);
  h.state.placement=middle;h.state.turn='w';h.state.castling='-';h.state.moves=[];
  h.mutate();await h.advance(250);
  assert.equal(analyses(h).length,2);
  assert.equal(analyses(h)[1].fen,middle+' w - - 0 1');
  assertNoHistory(h);
});
test('an outdated move list has no effect on current-board analysis',async()=>{
  const h=harness();
  await h.advance(0);
  h.state.moves=['e4','e5','incorrect history'];
  h.state.placement=middle;h.state.turn='w';h.state.castling='-';
  h.mutate();await h.advance(250);
  assert.equal(analyses(h)[1].fen,middle+' w - - 0 1');
  assertNoHistory(h);
});
test('history-only DOM changes do not trigger another engine search',async()=>{
  const h=harness();
  await h.advance(0);
  h.state.moves=['e4','e5'];h.mutate();await h.advance(250);
  assert.equal(analyses(h).length,1);
});
test('current DOM turn can suppress a suggestion on the opponent turn',async()=>{
  const h=harness();
  h.state.turn='b';
  await h.advance(0);
  assert.equal(analyses(h).length,0);
  assert.equal(h.text,'Waiting for opponent');
  h.state.turn='w';h.mutate();await h.advance(250);
  assert.equal(analyses(h).length,1);
});
test('without turn metadata the agent withholds moves until a clock verifies the turn',async()=>{
  const h=harness();
  h.state.placement=middle;h.state.turn=null;h.state.castling='-';
  await h.advance(0);
  assert.equal(analyses(h).length,0);
  assert.match(h.text,/Turn unknown/);
  h.state.turn='w';h.mutate();await h.advance(250);
  assert.equal(analyses(h).length,1);
  assert.equal(analyses(h)[0].fen,middle+' w - - 0 1');
});
test('contradictory turn indicators suppress search and recover after synchronization',async()=>{
  const h=harness();
  h.state.turnConflict=true;
  await h.advance(0);
  assert.equal(analyses(h).length,0);
  assert.match(h.text,/Turn indicators disagree/);
  h.state.turnConflict=false;
  h.mutate();await h.advance(250);
  assert.equal(analyses(h).length,1);
});
test('a verified opponent turn never receives an engine instruction',async()=>{
  const h=harness();
  h.state.turn='b';await h.advance(0);
  assert.equal(analyses(h).length,0);
  assert.equal(h.text,'Waiting for opponent');
});
test('current verified page FEN always outranks inferred turn and rights',async()=>{
  const h=harness(undefined,'/analysis');
  h.state.placement=middle;h.state.fen=middle+' b - - 3 8';h.state.turn='w';
  await h.advance(0);
  assert.equal(analyses(h).length,0);
  assert.equal(h.text,'Waiting for opponent');
});
test('changes in current rule metadata request fresh analysis',async()=>{
  const h=harness();
  await h.advance(0);
  h.state.castling='-';h.mutate();await h.advance(250);
  assert.equal(analyses(h).length,2);
  assert.equal(analyses(h)[1].fen,initial+' w - - 0 1');
});
test('changes during analysis never render a stale move',async()=>{
  let finish;
  let calls=0;
  const h=harness(message=>message.action==='analyze'&&++calls===1?
    new Promise(resolve=>{finish=resolve;}):undefined);
  await h.advance(0);
  h.state.placement=middle;h.state.turn='w';h.state.castling='-';
  h.mutate();
  finish({ok:true,instruction:'STALE MOVE'});
  await flush();
  await h.advance(250);
  assert.notEqual(h.text,'STALE MOVE');
  assert.equal(analyses(h).at(-1).fen,middle+' w - - 0 1');
});
test('unchanged board polls every second without re-running Stockfish',async()=>{
  const h=harness();
  await h.advance(0);
  await h.advance(5000);
  assert.equal(analyses(h).length,1);
  assert.ok(h.reads>=5);
});
test('a disappearing board hides prior suggestions and catches up on return',async()=>{
  const h=harness();
  await h.advance(0);
  h.state.missing=true;h.mutate();await h.advance(250);
  assert.match(h.text,/Chessboard unavailable/);
  h.state.missing=false;h.state.placement=middle;h.state.turn='w';
  h.state.castling='-';h.mutate();await h.advance(250);
  assert.equal(analyses(h).at(-1).fen,middle+' w - - 0 1');
});
test('malformed transient board retries without requiring a new mutation',async()=>{
  const h=harness();
  h.state.invalid=true;await h.advance(0);
  assert.match(h.text,/Board updating/);
  h.state.invalid=false;await h.advance(1500);
  assert.equal(analyses(h).length,1);
});
test('new board element on same page is reanalyzed from current pieces',async()=>{
  const h=harness();
  await h.advance(0);
  h.state.board={isConnected:true};
  h.state.placement=middle;h.state.turn='w';h.state.castling='-';
  await h.advance(1000);
  assert.equal(analyses(h).length,2);
  assert.equal(analyses(h)[1].fen,middle+' w - - 0 1');
});
test('resync reconstructs a midgame board without FEN or move history',async()=>{
  const h=harness();
  h.state.placement=middle;h.state.castling=null;h.state.enPassant=null;
  h.state.moves=[];
  await h.advance(0);
  const result=h.dispatch('coachResync');
  assert.equal(result.ok,true);
  await h.advance(0);
  assert.equal(analyses(h).length,2);
  assert.equal(analyses(h)[1].fen,middle+' w - - 0 1');
  assertNoHistory(h);
});
test('resync while backgrounded finishes on return without stale output',async()=>{
  const h=harness();await h.advance(0);
  h.visibility(true);
  h.state.placement=middle;h.state.castling='-';
  const result=h.dispatch('coachResync');
  assert.equal(result.ok,true);assert.equal(result.queued,true);
  h.visibility(false);await h.advance(0);
  assert.equal(analyses(h).at(-1).fen,middle+' w - - 0 1');
});
test('resync requires a readable board and respects pause',async()=>{
  const h=harness();await h.advance(0);
  h.state.missing=true;
  assert.match(h.dispatch('coachResync').error,/No readable chessboard/);
  h.state.missing=false;h.key('h');
  assert.match(h.dispatch('coachResync').error,/paused/i);
  assert.equal(h.text,undefined);
});
test('H toggles pause without further board or engine searches',async()=>{
  const h=harness();await h.advance(0);
  h.key('h');const count=analyses(h).length;
  await h.advance(3000);
  assert.equal(analyses(h).length,count);
  h.key('h');await h.advance(0);
  assert.ok(analyses(h).length>count);
});
test('hidden pages never search and catch up with changed board on return',async()=>{
  const h=harness();await h.advance(0);
  h.visibility(true);h.state.placement=middle;h.state.turn='w';
  await h.advance(1000);assert.equal(analyses(h).length,1);
  h.visibility(false);await h.advance(0);
  assert.equal(analyses(h).length,2);
});
test('configured color and search time are kept independent of history',async()=>{
  const h=harness(undefined,'/analysis',{playerSide:'b',thinkSeconds:7.5,fullStrength:false,strengthElo:2300});
  h.state.turn='b';await h.advance(0);
  assert.equal(analyses(h).length,1);
  assert.equal(analyses(h)[0].elo,2300);
  assert.equal(analyses(h)[0].seconds,7.5);
});
test('opening page reports the current readable board in popup diagnostics',async()=>{
  const h=harness();await h.advance(0);
  const r=h.dispatch('coachStatus');
  assert.equal(r.injected,true);
  assert.equal(r.boardFound,true);
  assert.equal(r.status,'Move pawn from e2 to e4');
});
test('engine errors back off then retry the same board instead of freezing',async()=>{
  let calls=0;
  const h=harness(m=>m.action==='analyze'&&++calls===1?
    {ok:false,error:'Transient engine restart'}:undefined);
  await h.advance(0);
  assert.equal(h.text,'Transient engine restart');
  await h.advance(10500);
  assert.equal(analyses(h).length,2);
  assert.match(h.text,/Move pawn/);
});
test('all supported Chess.com paths use current-board mode',async()=>{
  for(const path of ['/play/online','/analysis','/play/computer','/puzzles']){
    const h=harness(undefined,path);await h.advance(0);
    assert.equal(analyses(h).length,1,path);
    assertNoHistory(h);
  }
});

test('a changed board bypasses the retry delay from the previous failed position',async()=>{
  let calls=0;
  const h=harness(m=>m.action==='analyze'&&++calls===1?
    {ok:false,error:'Temporary engine issue'}:undefined);
  await h.advance(0);
  assert.equal(analyses(h).length,1);
  h.state.placement=middle;h.state.turn='w';h.state.castling='-';
  h.mutate();await h.advance(250);
  assert.equal(analyses(h).length,2);
  assert.equal(analyses(h)[1].fen,middle+' w - - 0 1');
  assert.match(h.text,/Move pawn/);
});
test('an unchanged failed board backs off before retrying',async()=>{
  let calls=0;
  const h=harness(m=>m.action==='analyze'&&++calls===1?
    {ok:false,error:'Temporary engine issue'}:undefined);
  await h.advance(0);
  await h.advance(1100);
  assert.equal(analyses(h).length,1);
  await h.advance(1100);
  assert.equal(analyses(h).length,2);
});
