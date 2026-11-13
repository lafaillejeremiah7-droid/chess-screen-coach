import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL,fenToBoard,boardToFen,tileFeature,recognizeTile} from '../src/recognition.js';
test('starting FEN roundtrip with White at bottom',()=>{
  const b=fenToBoard(INITIAL,'white');
  assert.equal(b[0].join(''),'rnbqkbnr');
  assert.equal(b[7].join(''),'RNBQKBNR');
  assert.equal(boardToFen(b,'white','w','KQkq','-'),INITIAL);
});
test('starting FEN roundtrip with Black at bottom',()=>{
  const b=fenToBoard(INITIAL,'black');
  assert.equal(b[0].join(''),'RNBKQBNR');
  assert.equal(b[7].join(''),'rnbkqbnr');
  assert.equal(boardToFen(b,'black','w','KQkq','-'),INITIAL);
});
test('sparse board FEN compression',()=>{
  const f='8/8/8/4k3/8/8/8/4K3 w - - 0 1';
  assert.equal(boardToFen(fenToBoard(f),'white'),f);
});
test('empty tile is classified empty',()=>{
  const data={width:48,height:48,data:new Uint8ClampedArray(48*48*4)};
  for(let i=0;i<data.data.length;i+=4){data.data[i]=238;data.data[i+1]=238;data.data[i+2]=210;data.data[i+3]=255;}
  const f=tileFeature(data);
  assert.equal(f.area,0);
  assert.equal(recognizeTile(f,{}).piece,'.');
});