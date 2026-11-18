import test from "node:test";
import assert from "node:assert/strict";
import {Chess} from "chess.js";
import {formatMove,parseBoard} from "../chess-core.mjs";

const INITIAL_FEN=new Chess().fen();

test("validates legal UCI suggestions and rejects illegal engine output",()=>{
  assert.equal(formatMove(INITIAL_FEN,"e2e4").instruction,"Move pawn from e2 to e4");
  assert.throws(()=>formatMove(INITIAL_FEN,"e2e5"),/illegal/);
  assert.throws(()=>parseBoard("not a fen"),/Invalid/);
});
test("formats pawn promotion and detects checkmate",()=>{
  const fen="4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
  assert.match(formatMove(fen,"a7a8q").instruction,/promote to queen/);
  const board=new Chess();
  board.move("f3");board.move("e5");board.move("g4");
  const mate=formatMove(board.fen(),"d8h4");
  assert.equal(mate.reason,"Checkmate.");
});
