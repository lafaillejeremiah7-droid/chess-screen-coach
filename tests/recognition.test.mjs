import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL,fenToBoard,boardToFen,tileFeature,recognizeTile,isBlackCapture,trustedScreenshotFen} from '../src/recognition.js';
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
test('all-black screen capture is rejected without recognizing pieces',()=>{
  const data=new Uint8ClampedArray(32*32*4);
  for(let i=3;i<data.length;i+=4)data[i]=255;
  assert.equal(isBlackCapture({data}),true);
});
test('normal dark board containing visible pieces is not classified as a black capture',()=>{
  const data=new Uint8ClampedArray(32*32*4);
  for(let i=0;i<data.length;i+=4){
    const bright=(i/4)%8===0;
    data[i]=data[i+1]=data[i+2]=bright?210:4;
    data[i+3]=255;
  }
  assert.equal(isBlackCapture({data}),false);
});
test('invalid capture samples do not incorrectly report a blackout',()=>{
  assert.equal(isBlackCapture({data:new Uint8ClampedArray()}),false);
});

test('screenshot resync preserves trusted FEN including en passant and clocks',()=>{
  const observed='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
  const full=observed+' b KQkq e3 0 1';
  assert.equal(trustedScreenshotFen({observed,priorFen:full,startingFen:INITIAL}),full);
});

test('midgame screenshot never silently invents castling or en-passant rights',()=>{
  const observed='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
  assert.throws(()=>trustedScreenshotFen({observed,startingFen:INITIAL}),/exact full FEN/);
  assert.throws(()=>trustedScreenshotFen({
    observed,suppliedFen:INITIAL,lastWrittenFen:null,startingFen:INITIAL
  }),/exact full FEN/);
});

test('explicit full FEN may initialize a matching midgame screenshot only once',()=>{
  const observed='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
  const full=observed+' b KQkq e3 0 1';
  assert.equal(trustedScreenshotFen({observed,suppliedFen:full,startingFen:INITIAL}),full);
  assert.throws(()=>trustedScreenshotFen({
    observed,suppliedFen:full,lastWrittenFen:full,startingFen:INITIAL
  }),/exact full FEN/);
  assert.equal(trustedScreenshotFen({
    observed:INITIAL.split(' ')[0],startingFen:INITIAL
  }),INITIAL);
});
