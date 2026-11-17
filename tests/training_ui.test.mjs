import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/training.js',import.meta.url),'utf8');
const START='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const bank=Array.from({length:100},(_,n)=>({id:'p'+n,fen:START,theme:'opening',turn:'white'}));
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

function harness(){
  const intervals=[],events=new Map(),elements=new Map();
  let now=0,completeEvaluation=null;
  function element(){
    return {
      textContent:'',value:'',disabled:false,hidden:false,children:[],
      classList:{toggle(){}},
      replaceChildren(){this.children=[];},
      appendChild(value){this.children.push(value);},
      setAttribute(){},addEventListener(event,handler){this['on'+event]=handler;}
    };
  }
  for(const id of ['trainer-feedback','progress','avg-loss','accuracy','trainer-board','clock',
    'next','submit','start','candidate','position'])elements.set(id,element());
  const document={
    hidden:false,body:{classList:{toggle(){}}},
    getElementById(id){return elements.get(id);},
    createElement(){return element();},
    addEventListener(name,fn){
      const listeners=events.get(name)||[];
      listeners.push(fn);events.set(name,listeners);
    }
  };
  const fetch=async(path)=>{
    if(path==='/api/training/positions'){
      return {ok:true,json:async()=>({positions:bank})};
    }
    if(path==='/api/training/evaluate'){
      return new Promise(resolve=>{completeEvaluation=()=>resolve({ok:true,json:async()=>({
        played:'e2e4',played_san:'e4',best:'e2e4',best_san:'e4',
        centipawn_loss:0,matched_best:true,explanation:'Match'
      })});});
    }
    return {ok:true,json:async()=>({hidden:false})};
  };
  vm.runInNewContext(source,{
    document,fetch,
    localStorage:{getItem(){return null;},setItem(){}},
    Date:{now:()=>now},Math,
    setInterval(fn,ms){intervals.push({fn,ms});return intervals.length;},
    console
  });
  const el=id=>elements.get(id);
  return {
    document,el,
    async start(){await el('start').onclick();await flush();},
    submit(){el('candidate').value='e2e4';el('submit').onclick();},
    resolveEvaluation(){assert.ok(completeEvaluation);completeEvaluation();},
    visibility(hidden){document.hidden=hidden;for(const listener of events.get('visibilitychange')||[])listener();},
    advance(ms){now+=ms;for(const timer of intervals)timer.fn();}
  };
}

test('tab visibility pauses the ten-second countdown without losing time',async()=>{
  const h=harness();await h.start();
  assert.equal(h.el('clock').textContent,'10s');
  h.advance(3000);
  assert.equal(h.el('clock').textContent,'7s');
  h.visibility(true);
  h.advance(25000);
  assert.equal(h.el('clock').textContent,'Paused');
  h.visibility(false);
  assert.equal(h.el('clock').textContent,'7s');
  h.advance(5000);
  assert.equal(h.el('clock').textContent,'2s');
});

test('old evaluation cannot modify a newly restarted session',async()=>{
  const h=harness();await h.start();
  h.submit();await flush();
  await h.start();
  assert.equal(h.el('progress').textContent,'0 / 100');
  h.resolveEvaluation();await flush();
  assert.equal(h.el('progress').textContent,'0 / 100');
  assert.equal(h.el('accuracy').textContent,'—');
  assert.equal(h.el('next').hidden,true);
  assert.match(h.el('trainer-feedback').textContent,/Predict the best move/);
});
