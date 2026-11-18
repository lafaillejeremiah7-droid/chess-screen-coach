import test from "node:test";
import assert from "node:assert/strict";
import {Chess} from "chess.js";
import {INITIAL_FEN,trackPosition,recoverPosition,formatMove,parseBoard} from "../chess-core.mjs";

test("tracks legal one-move transitions and preserves turn and castling rights",()=>{
  const board=new Chess();board.move("e4");
  const result=trackPosition(INITIAL_FEN,board.fen().split(" ")[0]);
  assert.equal(result.fen,board.fen());
  assert.equal(result.changed,true);
});
test("tracks two half-moves and rejects impossible positions",()=>{
  const board=new Chess();board.move("e4");board.move("e5");
  assert.equal(trackPosition(INITIAL_FEN,board.fen().split(" ")[0]).fen,board.fen());
  assert.throws(()=>trackPosition(INITIAL_FEN,"8/8/8/8/8/8/8/8"),/resync/);
});
test("replays SAN and UCI histories only when pieces match",()=>{
  const board=new Chess();
  const san=["e4","e5","Nf3","Nc6","Bb5","a6"];
  for(const move of san)board.move(move);
  assert.equal(recoverPosition(san,board.fen().split(" ")[0]).fen,board.fen());
  const uciBoard=new Chess();uciBoard.move("e4");uciBoard.move("e5");
  assert.equal(recoverPosition(["e2e4","e7e5"],uciBoard.fen().split(" ")[0]).fen,uciBoard.fen());
  assert.throws(()=>recoverPosition(["e4","e5"],board.fen().split(" ")[0]),/does not match/);
  assert.throws(()=>recoverPosition(["e5"],board.fen().split(" ")[0]),/illegal/);
});
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
