import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url),'utf8'));
const background=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');

test('extension is injected on Chess.com including human-game URLs',()=>{
  assert.equal(manifest.version,'0.7.8');
  assert.match(manifest.description,/FULL Stockfish 19/);
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.match(manifest.content_security_policy.extension_pages,/wasm-unsafe-eval/);
  assert.equal(manifest.host_permissions.some(x=>x.includes('localhost')||x.includes('127.0.0.1')),false);
  assert.equal(manifest.action?.default_popup,'popup.html');
  assert.ok(manifest.host_permissions.includes('https://www.chess.com/*'));
  assert.ok(manifest.host_permissions.includes('https://chess.com/*'));
  assert.equal(manifest.options_page,'options.html');
  assert.ok(manifest.content_scripts[0].matches.includes('https://www.chess.com/*'));
  assert.ok(manifest.content_scripts[0].matches.includes('https://chess.com/*'));
  assert.ok(manifest.content_scripts[0].js.includes('content.js'));
  assert.ok(manifest.content_scripts[0].js.includes('board.js'));
});

test('standalone WASM bridge authorizes Chess.com game URLs but no other hosts',async()=>{
  let listener;
  const responses=[];
  const sandbox={
    URL,AbortController,setTimeout,clearTimeout,
    fetch:async()=>({ok:true,json:async()=>({stockfish:true,python:true})}),
    chrome:{
      offscreen:{createDocument:async()=>{}},
      runtime:{id:'extension-id',getURL:path=>'chrome-extension://extension-id/'+path,
        getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT'}],
        sendMessage:async message=>message.action==="ping"
          ?{ok:true,ready:true,host:"offscreen"}
          :{ok:true,stockfish:true,standalone:true},
        onMessage:{addListener(fn){listener=fn;}}}
    }
  };
  vm.runInNewContext(background,sandbox);
  assert.equal(typeof listener,'function');
  for(const url of [
    'https://www.chess.com/play/online',
    'https://www.chess.com/game/live/123',
    'https://chess.com/analysis'
  ]){
    assert.equal(listener({action:'health'},{url},value=>responses.push(value)),true);
  }
  for(const url of [
    'https://notchess.com/play/online',
    'http://www.chess.com/play/online',
    'https://chess.com.attacker.example/game'
  ]){
    assert.equal(listener({action:'health'},{url},()=>{}),false);
  }
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(responses.length,3);
  assert.ok(responses.every(r=>r.ok&&r.stockfish&&r.standalone));
});

test('engine accepts custom analysis times rather than four hardcoded choices',()=>{
  const src=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
  assert.match(src,/body\.seconds>=0\.1&&body\.seconds<=120/);
  assert.doesNotMatch(src,/\[0\.2,0\.5,1,2\]\.includes/);
});
