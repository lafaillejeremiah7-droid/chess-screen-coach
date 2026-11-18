import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../extension/board.js',import.meta.url),'utf8');
const initial='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const middle='r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R';
function pieceNodes(placement){
  const out=[],rows=placement.split('/');
  for(let r=0;r<rows.length;r++){
    let file=1;
    for(const token of rows[r]){
      if(/[1-8]/.test(token)){file+=Number(token);continue;}
      const color=token===token.toUpperCase()?'w':'b';
      const cls='piece '+color+token.toLowerCase()+' square-'+file+(8-r);
      out.push({getAttribute:name=>name==='class'?cls:null,closest:()=>null});
      file++;
    }
  }
  return out;
}
function harness(placement,attributes={}){
  const root={};
  vm.runInNewContext(script,root);
  const nodes=pieceNodes(placement);
  const board={
    getAttribute(name){return attributes[name]??null;},
    classList:{contains(name){return name===attributes.classFlag;}},
    getBoundingClientRect(){return {width:400,height:400};},
    querySelectorAll(){return nodes;}
  };
  const doc={
    querySelectorAll(selector){
      if(selector.includes('move')||selector.includes('ply'))throw Error('History must not be queried');
      return [board];
    }
  };
  return {reader:root.ChessCoachBoard,doc,board};
}
test('current placement comes from the visible pieces, not a move list',()=>{
  const h=harness(middle);
  const s=h.reader.snapshot(h.doc);
  assert.equal(s.placement,middle);
  assert.equal(s.moves,undefined);
  assert.equal(h.reader.readMoveHistory,undefined);
});
test('current board can be analyzed at midgame without move history',()=>{
  const h=harness(middle,{'data-turn':'white'});
  const s=h.reader.snapshot(h.doc);
  const position=h.reader.currentFen(s,'b');
  assert.equal(position.fen,middle+' w - - 0 1');
  assert.equal(position.turnVerified,true);
  assert.equal(position.rulesVerified,false);
});
test('page FEN is used only when its pieces match the current screen',()=>{
  const stale=initial+' w KQkq - 0 1';
  const h=harness(middle,{'data-fen':stale,'data-turn':'black'});
  const s=h.reader.snapshot(h.doc);
  assert.equal(s.fen,null);
  assert.equal(h.reader.currentFen(s,'w').fen,middle+' b - - 0 1');
});
test('verified FEN includes site supplied turn, castling and en passant',()=>{
  const full=middle+' b KQ - 0 10';
  const h=harness(middle,{'data-fen':full,'data-turn':'white'});
  const pos=h.reader.currentFen(h.reader.snapshot(h.doc),'w');
  assert.equal(pos.fen,full);
  assert.equal(pos.turnVerified,true);
  assert.equal(pos.rulesVerified,true);
});
test('board metadata supplies special move rights when available',()=>{
  const h=harness(middle,{'data-side-to-move':'b',
    'data-castling-rights':'kq','data-ep-square':'e3'});
  const pos=h.reader.currentFen(h.reader.snapshot(h.doc),'w');
  assert.equal(pos.fen,middle+' b kq e3 0 1');
  assert.equal(pos.rulesVerified,true);
});
test('unknown castling and en passant rights are not invented',()=>{
  const h=harness(middle,{'data-turn':'w'});
  const pos=h.reader.currentFen(h.reader.snapshot(h.doc),'w');
  assert.equal(pos.fen,middle+' w - - 0 1');
  assert.equal(pos.rulesVerified,false);
});
test('unknown turn is marked as assumed, never silently verified',()=>{
  const h=harness(middle);
  const pos=h.reader.currentFen(h.reader.snapshot(h.doc),'b');
  assert.equal(pos.fen,middle+' b - - 0 1');
  assert.equal(pos.turnVerified,false);
});
test('board orientation does not change piece squares or side to move',()=>{
  const white=harness(middle,{'data-turn':'b'});
  const black=harness(middle,{'data-turn':'b',classFlag:'flipped'});
  const ws=white.reader.snapshot(white.doc),bs=black.reader.snapshot(black.doc);
  assert.equal(ws.placement,bs.placement);
  assert.equal(ws.turn,bs.turn);
  assert.equal(black.reader.currentFen(bs,'w').fen,middle+' b - - 0 1');
});
test('missing king is detected instead of inventing a position',()=>{
  const h=harness('8/8/8/8/8/8/4P3/4K3');
  assert.throws(()=>h.reader.snapshot(h.doc),/both kings/);
});
test('initial board is not assumed to restore lost castling rights',()=>{
  const h=harness(initial,{'data-turn':'w'});
  const pos=h.reader.currentFen(h.reader.snapshot(h.doc),'w');
  assert.equal(pos.fen,initial+' w - - 0 1');
});
