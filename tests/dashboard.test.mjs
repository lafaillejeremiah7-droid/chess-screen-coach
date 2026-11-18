import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {INITIAL} from '../src/recognition.js';

const source=readFileSync(new URL('../src/app.js', import.meta.url),'utf8').replace(/^import .*;\n/,'');
function dashboard(fetch){
  const elements=new Map(), listeners={}, intervals=[];
  const element=()=>({value:'',textContent:'',addEventListener(){},getContext(){return {};},classList:{toggle(){}}});
  function get(id){
    if(!elements.has(id))elements.set(id,element());
    return elements.get(id);
  }
  const document={getElementById:get,createElement:element,body:element(),
    addEventListener(type,fn){listeners[type]=fn;}};
  vm.runInNewContext(source,{INITIAL,document,fetch,loadTemplates:async()=>({}),
    localStorage:{getItem:()=>null},clearTimeout(){},setInterval(fn,ms){intervals.push({fn,ms});}});
  return {get,poll:intervals.find(timer=>timer.ms===1400).fn,
    toggle:()=>listeners.keydown({key:'h',preventDefault(){},stopPropagation(){}})};
}
const reply=data=>({ok:true,json:async()=>data});

test('changing color while the dashboard searches discards the previous move',async()=>{
  let finish;
  const h=dashboard(async path=>path==='/api/analyze'?
    new Promise(resolve=>{finish=resolve;}):reply({stockfish:true}));
  h.get('fen').value=INITIAL;h.get('myColor').value='w';
  const pending=h.get('analyzeFen').onclick();
  h.get('myColor').value='b';h.get('myColor').onchange();
  finish(reply({instruction:'Stale move'}));await pending;
  assert.equal(h.get('move').textContent,'Waiting for your turn');
});

test('a dashboard control poll cannot undo a later H keypress',async()=>{
  let finish;
  const h=dashboard(async(path,opts)=>path==='/api/control'&&!opts?
    new Promise(resolve=>{finish=resolve;}):reply({stockfish:true}));
  const pending=h.poll();h.toggle();
  finish(reply({hidden:false}));await pending;
  // Pressing H for the second time must resume the previously paused page.
  h.toggle();
  assert.equal(h.get('status').textContent,'Coach visible. Resume analysis when ready.');
});
