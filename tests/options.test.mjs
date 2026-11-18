import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../extension/options.js',import.meta.url),'utf8');
const content=readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../extension/options.html',import.meta.url),'utf8');

function optionsHarness({tabs=[{id:42,active:false,lastAccessed:123}],reply={
  injected:true,hidden:false,visible:true,boardFound:true,status:'Move knight from g1 to f3'
}}={}){
  const elements=new Map(),callbacks=new Map(),actions=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      textContent:'',value:'1400',checked:false,disabled:false,
      addEventListener(type,callback){callbacks.set(id+':'+type,callback);}
    });
    return elements.get(id);
  };
  const chrome={
    runtime:{lastError:null,
      sendMessage(message,callback){
        if(message.action==='health')return Promise.resolve({ok:true,stockfish:true,standalone:true});
        if(message.action==='control')return Promise.resolve({ok:true,hidden:false});
        actions.push({action:'repair',message});
        callback({ok:true,injected:true,boardFound:true,status:'Move pawn from e2 to e4'});
      }},
    storage:{local:{
      get(defaults,callback){callback(defaults);},
      set(_values,callback){callback?.();}
    }},
    tabs:{
      query(filter,callback){actions.push({action:'query',filter});callback(tabs);},
      sendMessage(tabId,message,callback){
        actions.push({action:'send',tabId,message});
        callback(message.action==='coachResync'?{ok:true,started:true,queued:false}:reply);
      },
      reload(tabId,callback){actions.push({action:'reload',tabId});callback();}
    }
  };
  vm.runInNewContext(source,{document:{getElementById:element},
    chrome,setTimeout,clearTimeout,fetch:()=>Promise.reject(Error('not needed')),
    AbortController,Number,Promise});
  return {element,actions,click(id){const fn=callbacks.get(id+':click');assert.ok(fn);return fn();}};
}

test('diagnostics checks an actual Chess.com tab and content-script state',()=>{
  const ui=optionsHarness();
  ui.click('checkChessPage');
  assert.equal(ui.actions[0].action,'query');
  assert.equal(ui.actions[1].action,'send');
  assert.equal(ui.actions[1].message.action,'coachStatus');
  assert.match(ui.element('pageStatus').textContent,/Extension loaded; board found/);
});

test('diagnostics reports absent injection instead of claiming server readiness',()=>{
  const ui=optionsHarness({reply:null});
  ui.click('checkChessPage');
  assert.match(ui.element('pageStatus').textContent,/did not inject/);
});

test('diagnostics reports unsupported board markup',()=>{
  const ui=optionsHarness({reply:{injected:true,visible:true,hidden:false,boardFound:false}});
  ui.click('checkChessPage');
  assert.match(ui.element('pageStatus').textContent,/no supported chessboard/);
});

test('reload control reloads the identified Chess.com tab on a direct click',()=>{
  const ui=optionsHarness();
  ui.click('reloadChessPage');
  assert.equal(ui.actions[1].action,'reload');
  assert.equal(ui.actions[1].tabId,42);
});

test('options page repairs the selected Chess.com tab through verified background action',()=>{
  const ui=optionsHarness();
  ui.click('repairChessPage');
  assert.equal(ui.actions[1].action,'repair');
  assert.equal(ui.actions[1].message.action,'repairTab');
  assert.equal(ui.actions[1].message.tabId,42);
  assert.match(ui.element('pageStatus').textContent,/Page script running/);
});

test('Resync board in extension options invokes page resync without reloading the tab',()=>{
  const ui=optionsHarness();
  ui.click('resyncChessPage');
  assert.equal(ui.actions[0].action,'query');
  assert.equal(ui.actions[1].action,'send');
  assert.equal(ui.actions[1].message.action,'coachResync');
  assert.equal(ui.actions[1].tabId,42);
  assert.match(ui.element('pageStatus').textContent,/Resync started/);
  assert.equal(ui.actions.some(a=>a.action==='reload'),false);
});

test('visible overlay has a definite contrasting foreground and background',()=>{
  assert.match(content,/background: #182633/);
  assert.match(content,/color: #fff/);
  assert.match(content,/visibility: visible !important/);
  assert.match(html,/id="checkChessPage"/);
  assert.match(html,/id="reloadChessPage"/);
  assert.match(html,/id="resyncChessPage"/);
});

test('analysis time uses a freely editable numeric input, not four fixed choices',()=>{
  assert.match(html,/<input type="number" id="thinkSeconds"[^>]*step="any"/);
  assert.match(source,/const validTime=seconds=>Number\.isFinite\(seconds\)/);
  assert.doesNotMatch(source,/\[0\.2,0\.5,1,2\]/);
});

test('on-page status is compact, right-aligned and out of the middle of the board',()=>{
  assert.match(content,/top:"12px",right:"12px",left:"auto",transform:"none"/);
  assert.match(content,/max-width: min\(calc\(100vw - 24px\), 260px\)/);
  assert.doesNotMatch(content,/left: 50% !important/);
  assert.match(content,/top:"12px",right:"12px",left:"auto",transform:"none"/);
  assert.match(content,/font: 500 11px\/1\.3 system-ui/);
  assert.doesNotMatch(content,/translateX\(-50%\)/);
});
