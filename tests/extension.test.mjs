import test from "node:test";
import assert from "node:assert/strict";
import "../extension/board.js";

const {placementFromClasses,placementFromNodes,findBoard,snapshot,initial}=globalThis.ChessCoachBoard;
const initialFen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

function classesFromFen(fen){
  const ranks=fen.split("/");
  const out=[];
  for(let row=0;row<8;row++){
    let file=1;
    for(const piece of ranks[row]){
      if(/[1-8]/.test(piece)){file+=Number(piece);continue;}
      const side=piece===piece.toUpperCase()?"w":"b";
      out.push("piece "+side+piece.toLowerCase()+" square-"+file+(8-row));
      file++;
    }
  }
  return out;
}
test("recognizes 32 Chess.com pieces without screen capture",()=>{
  const classes=classesFromFen(initialFen);
  assert.equal(classes.length,32);
  assert.equal(placementFromClasses(classes),initial);
});
test("recognizes Black at bottom using absolute square classes",()=>{
  const sparse="4k3/8/2n5/8/3Q4/8/4K3/8";
  const classes=classesFromFen(sparse).reverse();
  assert.equal(placementFromClasses(classes),sparse);
});
test("rejects duplicate square placement",()=>{
  const classes=classesFromFen(initialFen);
  classes.push("piece wn square-11");
  assert.throws(()=>placementFromClasses(classes),/Overlapping/);
});
test("rejects incomplete board",()=>{
  assert.throws(()=>placementFromClasses(["piece wk square-51"]),/both kings/);
});

function fakePiece(classes, attrs={}){
  return {
    getAttribute(name){return name==="class"?classes:attrs[name]??null;},
    closest(){return null;}
  };
}
function fakeBoard(width,nodes,extra={}){
  return {
    getBoundingClientRect(){return {width,height:width};},
    querySelectorAll(){return nodes;},
    classList:{contains(name){return (extra.classes||[]).includes(name);}},
    getAttribute(name){return extra[name]??null;}
  };
}
test("reads alternate data-piece/data-square markup",()=>{
  const nodes=[
    fakePiece("piece",{"data-piece":"wK","data-square":"e1"}),
    fakePiece("piece",{"data-piece":"black-king","data-square":"e8"}),
    fakePiece("piece",{"data-piece":"white-pawn","data-square":"d4"})
  ];
  assert.equal(placementFromNodes(nodes),"4k3/8/8/8/3P4/8/8/4K3");
});
test("recognizes algebraic square-classes",()=>{
  const nodes=[
    fakePiece("piece wk square-e1"),
    fakePiece("piece bk square-e8"),
    fakePiece("piece wn square-c3")
  ];
  assert.equal(placementFromNodes(nodes),"4k3/8/8/8/8/2N5/8/4K3");
});
test("prefers the largest visible board and preserves embedded FEN",()=>{
  const nodes=classesFromFen(initialFen).map(cls=>fakePiece(cls));
  const small=fakeBoard(180,nodes);
  const large=fakeBoard(560,nodes,{
    classes:["flipped"],
    "data-fen": initialFen+" w KQkq - 0 1"
  });
  const doc={querySelectorAll(){return [small,large];}};
  assert.equal(findBoard(doc),large);
  const result=snapshot(doc);
  assert.equal(result.placement,initialFen);
  assert.equal(result.bottomColor,"b");
  assert.equal(result.fen,initialFen+" w KQkq - 0 1");
});
test("rejects stale or mismatched embedded FEN",()=>{
  const nodes=[
    fakePiece("piece wk square-51"),
    fakePiece("piece bk square-58")
  ];
  const board=fakeBoard(500,nodes,{"data-fen":initialFen+" w KQkq - 0 1"});
  assert.equal(snapshot({querySelectorAll(){return [board];}}).fen,null);
});

test("declared player color is separate from board orientation",()=>{
  const pieces=classesFromFen(initialFen).map(cls=>({
    getAttribute(name){return name==="class"?cls:null;},
    closest(){return null;}
  }));
  const board={
    getBoundingClientRect(){return {width:480,height:480};},
    querySelectorAll(){return pieces;},
    classList:{contains(name){return name==="flipped";}},
    getAttribute(name){return name==="data-player-color"?"white":null;}
  };
  const result=globalThis.ChessCoachBoard.snapshot({querySelectorAll(){return [board];}});
  assert.equal(result.bottomColor,"b");
  assert.equal(result.playerColor,"w");
});
test("unspecified player color stays unknown rather than equaling orientation",()=>{
  const pieces=classesFromFen(initialFen).map(cls=>({
    getAttribute(name){return name==="class"?cls:null;},
    closest(){return null;}
  }));
  const board={
    getBoundingClientRect(){return {width:480,height:480};},
    querySelectorAll(){return pieces;},
    classList:{contains(name){return name==="flipped";}},
    getAttribute(){return null;}
  };
  const result=globalThis.ChessCoachBoard.snapshot({querySelectorAll(){return [board];}});
  assert.equal(result.playerColor,null);
  assert.equal(result.bottomColor,"b");
});

test('extracts complete SAN history for recovery after several unseen moves',()=>{
  const history=['e4','e5','Nf3','Nc6','Bb5','a6'];
  const nodes=history.map((move,i)=>({
    textContent:move,
    getAttribute(name){return name==='data-ply'?String(i+1):null;}
  }));
  const doc={querySelectorAll(selector){return selector==='[data-ply]'?nodes:[];}};
  assert.deepEqual(globalThis.ChessCoachBoard.readMoveHistory(doc),history);
});

test('a matching FEN with extra whitespace keeps a usable turn field',()=>{
  const nodes=classesFromFen(initial).map(cls=>fakePiece(cls));
  const board=fakeBoard(480,nodes,{'data-fen':initial+'   b\tKQkq - 0 1'});
  assert.equal(snapshot({querySelectorAll(){return [board];}}).fen,initial+' b KQkq - 0 1');
});
