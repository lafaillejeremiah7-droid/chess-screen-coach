import test from "node:test";
import assert from "node:assert/strict";
import "../extension/board.js";

const {placementFromClasses,initial}=globalThis.ChessCoachBoard;
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
