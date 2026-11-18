import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../extension/options.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../extension/overlay.css',import.meta.url),'utf8');
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
    runtime:{lastError:null},
    storage:{local:{
      get(defaults,callback){callback(defaults);},
      set(_values,callback){callback?.();}
    }},
    tabs:{
      query(filter,callback){actions.push({action:'query',filter});callback(tabs);},
      sendMessage(tabId,message,callback){actions.push({action:'send',tabId,message});callback(reply);},
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

test('visible overlay has a definite contrasting foreground and background',()=>{
  assert.match(css,/color:\s*#ffffff\s*!important/);
  assert.match(css,/background:\s*#182633\s*!important/);
  assert.match(css,/visibility:\s*visible\s*!important/);
  assert.match(html,/id="checkChessPage"/);
  assert.match(html,/id="reloadChessPage"/);
});
