import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url),'utf8'));
const background=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');

test('extension is injected on Chess.com including human-game URLs',()=>{
  assert.equal(manifest.version,'0.6.3');
  assert.ok(manifest.permissions.includes('storage'));
  assert.equal(manifest.options_page,'options.html');
  assert.ok(manifest.content_scripts[0].matches.includes('https://www.chess.com/*'));
  assert.ok(manifest.content_scripts[0].matches.includes('https://chess.com/*'));
  assert.ok(manifest.content_scripts[0].js.includes('content.js'));
  assert.ok(manifest.content_scripts[0].js.includes('board.js'));
});

test('Stockfish bridge authorizes Chess.com game URLs but no other hosts',async()=>{
  let listener;
  const responses=[];
  const sandbox={
    URL,AbortController,setTimeout,clearTimeout,
    fetch:async()=>({ok:true,json:async()=>({stockfish:true,python:true})}),
    chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}}
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
  assert.ok(responses.every(r=>r.ok&&r.stockfish));
});

test('engine requests only allow bounded analysis time',()=>{
  const src=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
  assert.match(src,/\[0\.2,0\.5,1,2\]\.includes\(body\.seconds\)/);
});
