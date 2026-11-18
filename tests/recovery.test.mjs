import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const background=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
const popup=readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../extension/popup.html',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};

function backgroundHarness({url='https://www.chess.com/play/computer',denied=false,already=false}={}){
  let injected=already;
  let onUpdated,onActivated,onInstalled,onMessage;
  const injectedFiles=[];
  const tab={id:7,url};
  const chrome={
    runtime:{id:'extension-id',onMessage:{addListener(fn){onMessage=fn;}},
      onInstalled:{addListener(fn){onInstalled=fn;}}},
    tabs:{
      get:async()=>tab,
      sendMessage:async(_tabId,message)=>{
        assert.equal(message.action,'coachStatus');
        if(!injected)throw Error('No receiver');
        return {injected:true,boardFound:true,hidden:false,visible:true,
          status:'Move pawn from e2 to e4'};
      },
      query:async()=>[tab],
      onUpdated:{addListener(fn){onUpdated=fn;}},
      onActivated:{addListener(fn){onActivated=fn;}}
    },
    scripting:{
      executeScript:async spec=>{
        if(denied)throw Error('Site access denied');
        injectedFiles.push(...spec.files);
        injected=true;
      }
    }
  };
  vm.runInNewContext(background,{chrome,URL,AbortController,setTimeout,clearTimeout,
    fetch:async()=>({ok:true,json:async()=>({stockfish:true})})});
  return {
    chrome,tab,injectedFiles,
    onUpdated(status='complete',u=url){return onUpdated(tab.id,{status},{id:tab.id,url:u});},
    onActivated(){return onActivated({tabId:tab.id});},
    onInstalled(){return onInstalled();},
    manualRepair(){
      return new Promise(resolve=>{
        const keepOpen=onMessage({action:'repairTab',tabId:tab.id},
          {id:'extension-id',url:'chrome-extension://extension-id/options.html'},resolve);
        assert.equal(keepOpen,true);
      });
    }
  };
}

test('automatic repair injects missing board and content scripts after page load',async()=>{
  const h=backgroundHarness();
  h.onUpdated();
  await flush();
  assert.deepEqual(h.injectedFiles,['board.js','content.js']);
  const result=await h.manualRepair();
  assert.equal(result.ok,true);
  assert.equal(result.method,'already_loaded');
  assert.equal(result.status,'Move pawn from e2 to e4');
  assert.equal(h.injectedFiles.length,2);
});

test('already-running script is not injected again',async()=>{
  const h=backgroundHarness({already:true});
  h.onActivated();
  await flush();
  assert.equal(h.injectedFiles.length,0);
});

test('Chrome site-access denial returns a clear failure',async()=>{
  const h=backgroundHarness({denied:true});
  const result=await h.manualRepair();
  assert.equal(result.ok,false);
  assert.match(result.error,/site access/i);
  assert.equal(h.injectedFiles.length,0);
});

test('a non-Chess.com tab cannot be automatically or manually injected',async()=>{
  const h=backgroundHarness({url:'https://example.com'});
  h.onUpdated('complete','https://example.com');
  await flush();
  const result=await h.manualRepair();
  assert.equal(result.ok,false);
  assert.equal(h.injectedFiles.length,0);
});

function popupHarness({url='https://www.chess.com/play/computer',isInjected=true}={}){
  const elements=new Map(),events=new Map();
  const el=id=>{
    if(!elements.has(id))elements.set(id,{
      textContent:'',disabled:false,addEventListener(type,cb){events.set(id+':'+type,cb);}
    });
    return elements.get(id);
  };
  const chrome={
    tabs:{
      query:async()=>[{id:7,url}],
      sendMessage:async()=>{
        if(!isInjected)throw Error('Receiving end does not exist');
        return {injected:true,boardFound:true,hidden:false,status:'Move pawn from e2 to e4'};
      }
    },
    runtime:{sendMessage:async()=>{isInjected=true;return {ok:true};}},
    storage:{local:{set:async()=>{}}}
  };
  vm.runInNewContext(popup,{document:{getElementById:el},chrome,URL,Promise,
    fetch:async()=>({ok:true})});
  return {el,click(id){return events.get(id+':click')();}};
}

test('toolbar popup independently displays the most recent suggestion',async()=>{
  const ui=popupHarness();
  await flush();
  assert.equal(ui.el('suggestion').textContent,'Move pawn from e2 to e4');
});

test('toolbar popup still displays an actionable error without a content script',async()=>{
  const ui=popupHarness({isInjected:false});
  await flush();
  assert.match(ui.el('suggestion').textContent,/unavailable/);
  await ui.click('repair');
  await flush();
  assert.equal(ui.el('suggestion').textContent,'Move pawn from e2 to e4');
});

test('popup has an accessible entry point even when Chess.com overlay fails',()=>{
  assert.match(html,/id="suggestion"/);
  assert.match(html,/id="repair"/);
  assert.match(html,/src="popup.js"/);
});
