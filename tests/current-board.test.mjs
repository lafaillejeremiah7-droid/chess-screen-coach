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
      if(selector.includes('clock-component'))return attributes.clocks||[];
      if(selector.includes('turn-indicator'))return attributes.indicators||[];
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
  const h=harness(middle,{'data-fen':full,'data-turn':'black'});
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
test('unknown turn refuses to construct an assumed active position',()=>{
  const h=harness(middle);
  assert.throws(()=>h.reader.currentFen(h.reader.snapshot(h.doc),'b'),/Turn unknown/);
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

function fakeClock(classes,attrs={}){
  const names=classes.split(/\s+/);
  return {
    className:classes,
    classList:{contains(name){return names.includes(name);}},
    getAttribute(name){return name==="class"?classes:attrs[name]??null;},
    closest(){return null;}
  };
}
test('white active clock verifies White to move',()=>{
  const h=harness(middle,{clocks:[
    fakeClock('clock-component clock-white clock-player-turn'),
    fakeClock('clock-component clock-black')
  ]});
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,'w');
  assert.equal(snapshot.turnSource,'clock');
  assert.equal(h.reader.currentFen(snapshot).fen,middle+' w - - 0 1');
});
test('black active clock verifies Black to move even if White is at the bottom',()=>{
  const h=harness(middle,{clocks:[
    fakeClock('clock-component clock-white'),
    fakeClock('clock-component clock-black clock-player-turn')
  ]});
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,'b');
  assert.equal(snapshot.turnSource,'clock');
});
test('flipped board maps active top/bottom clocks only when orientation is explicitly known',()=>{
  const h=harness(middle,{classFlag:'flipped',clocks:[
    fakeClock('clock-component clock-top clock-player-turn'),
    fakeClock('clock-component clock-bottom')
  ]});
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,'w');
  assert.equal(snapshot.turnSource,'clock');
});
test('an uncolored active top clock without confirmed orientation is not treated as turn evidence',()=>{
  const h=harness(middle,{clocks:[
    fakeClock('clock-component clock-top clock-player-turn'),
    fakeClock('clock-component clock-bottom')
  ]});
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,null);
  assert.throws(()=>h.reader.currentFen(snapshot),/Turn unknown/);
});
test('both clocks active is an explicit conflict and does not produce a suggestion FEN',()=>{
  const h=harness(middle,{clocks:[
    fakeClock('clock-component clock-white clock-player-turn'),
    fakeClock('clock-component clock-black clock-player-turn')
  ]});
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turnConflict,true);
  assert.throws(()=>h.reader.currentFen(snapshot),/Turn indicators disagree/);
});
test('conflicting clock and embedded FEN refuses an untrusted turn',()=>{
  const full=middle+' w - - 0 10';
  const h=harness(middle,{'data-fen':full,clocks:[
    fakeClock('clock-component clock-black clock-player-turn')
  ]});
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turnConflict,true);
  assert.throws(()=>h.reader.currentFen(snapshot),/Turn indicators disagree/);
});
test('active clock without a color and without a turn indicator is insufficient',()=>{
  const h=harness(middle,{clocks:[fakeClock('clock-component clock-running')]});
  assert.equal(h.reader.snapshot(h.doc).turn,null);
});
test('explicit turn-indicator text can independently verify the active side',()=>{
  const indicator={textContent:'Black to move',getAttribute(){return null;}};
  const h=harness(middle,{indicators:[indicator]});
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,'b');
  assert.equal(snapshot.turnSource,'indicator');
});
test('conflicting explicit board turn and active clock suppress analysis',()=>{
  const h=harness(middle,{'data-turn':'white',clocks:[
    fakeClock('clock-component clock-black clock-player-turn')
  ]});
  assert.equal(h.reader.snapshot(h.doc).turnConflict,true);
});
test('inactive clocks are not evidence for whose turn it is',()=>{
  const h=harness(middle,{clocks:[
    fakeClock('clock-component clock-white'),
    fakeClock('clock-component clock-black')
  ]});
  assert.throws(()=>h.reader.currentFen(h.reader.snapshot(h.doc)),/Turn unknown/);
});

test('clock search is scoped to the current board layout when possible',()=>{
  const h=harness(middle);
  const actual=[
    fakeClock('clock-component clock-white clock-player-turn'),
    fakeClock('clock-component clock-black')
  ];
  const unrelated=[fakeClock('clock-component clock-black clock-player-turn')];
  h.board.closest=selector=>selector.includes('board-layout')
    ?{querySelectorAll(){return actual;}}:null;
  h.doc.querySelectorAll=selector=>{
    if(selector.includes('clock-component'))return unrelated;
    if(selector.includes('turn-indicator'))return [];
    return [h.board];
  };
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,'w');
  assert.equal(snapshot.turnConflict,false);
});

function geometricGame(blackAtBottom=false){
  const topClock=fakeClock('clock-component clock-player-turn');
  topClock.getBoundingClientRect=()=>({top:40,bottom:80,width:130,height:40});
  const bottomClock=fakeClock('clock-component');
  bottomClock.getBoundingClientRect=()=>({top:520,bottom:560,width:130,height:40});
  const h=harness(initial,{clocks:[topClock,bottomClock]});
  h.board.getBoundingClientRect=()=>({top:100,bottom:500,width:400,height:400});
  const originalNodes=h.board.querySelectorAll();
  for(const node of originalNodes){
    const match=node.getAttribute('class').match(/square-([1-8])([1-8])/);
    const rank=Number(match[2]);
    const row=blackAtBottom?rank-1:8-rank;
    node.getBoundingClientRect=()=>({top:100+row*50,bottom:150+row*50,width:50,height:50});
  }
  return {h,topClock,bottomClock};
}
test('realistic unlabeled Chess.com active top clock uses the current observed board geometry',()=>{
  const {h}=geometricGame(false);
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,'b');
  assert.equal(snapshot.turnSource,'clock');
  assert.equal(snapshot.turnConflict,false);
});
test('same unlabeled active top clock maps to White on a visibly flipped board',()=>{
  const {h}=geometricGame(true);
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,'w');
  assert.equal(snapshot.turnSource,'clock');
});
test('an active bottom clock maps to White when White pieces are visibly at the bottom',()=>{
  const {h,topClock,bottomClock}=geometricGame(false);
  topClock.className='clock-component';
  topClock.classList.contains=name=>['clock-component'].includes(name);
  bottomClock.className='clock-component clock-player-turn';
  bottomClock.classList.contains=name=>['clock-component','clock-player-turn'].includes(name);
  assert.equal(h.reader.snapshot(h.doc).turn,'w');
});
test('conflicting explicit orientation and physical board layout cannot guess a clock color',()=>{
  const {h}=geometricGame(true);
  const original=h.board.getAttribute;
  h.board.getAttribute=name=>name==='data-orientation'?'white':original(name);
  const snapshot=h.reader.snapshot(h.doc);
  assert.equal(snapshot.turn,null);
  assert.throws(()=>h.reader.currentFen(snapshot),/Turn unknown/);
});
test('clock inside board bounds without an explicit top/bottom label is not used as turn evidence',()=>{
  const {h,topClock}=geometricGame(false);
  topClock.getBoundingClientRect=()=>({top:240,bottom:280,width:130,height:40});
  assert.equal(h.reader.snapshot(h.doc).turn,null);
});
