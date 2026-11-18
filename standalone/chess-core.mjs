import {Chess} from "chess.js";

export const INITIAL_FEN=new Chess().fen();
export const placementOf=fen=>fen.split(" ")[0];

function validPlacement(placement){
  return typeof placement==="string"&&placement.length<=90&&
    /^[pnbrqkPNBRQK1-8/]+$/.test(placement)&&placement.split("/").length===8;
}
export function parseBoard(fen){
  if(typeof fen!=="string"||fen.length>120)throw Error("Invalid chess FEN");
  try{return new Chess(fen);}catch{throw Error("Invalid chess FEN");}
}
function uniqueResult(fens,changed=true){
  const unique=[...new Set(fens)];
  if(unique.length!==1)throw Error("Position tracking ambiguous; resync with a complete move history or FEN");
  return {fen:unique[0],changed};
}
export function trackPosition(previous,placement){
  if(!validPlacement(placement))throw Error("Invalid board placement");
  const chess=parseBoard(previous);
  if(placementOf(chess.fen())===placement)return {fen:chess.fen(),changed:false};
  const first=[],second=[];
  for(const move of chess.moves({verbose:true})){
    chess.move(move);
    if(placementOf(chess.fen())===placement)first.push(chess.fen());
    else{
      for(const reply of chess.moves({verbose:true})){
        chess.move(reply);
        if(placementOf(chess.fen())===placement)second.push(chess.fen());
        chess.undo();
      }
    }
    chess.undo();
  }
  if(first.length)return uniqueResult(first);
  if(second.length)return uniqueResult(second);
  throw Error("Cannot track position within two legal moves; resync required");
}
export function recoverPosition(moves,placement){
  if(!Array.isArray(moves)||moves.length<1||moves.length>400||
     moves.some(x=>typeof x!=="string"||x.length>14)||!validPlacement(placement))
    throw Error("Valid complete move history required");
  const chess=new Chess();
  for(const token of moves){
    const text=token.trim();
    if(!text)throw Error("Empty move in history");
    try{
      if(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)){
        chess.move({...{from:text.slice(0,2),to:text.slice(2,4)},...(text[4]?{promotion:text[4]}:{})});
      }else{
        chess.move(text);
      }
    }catch{throw Error("History contains an illegal or malformed move");}
  }
  if(placementOf(chess.fen())!==placement)
    throw Error("Move history does not match the observed board");
  return {fen:chess.fen(),recovered_moves:moves.length};
}
export function formatMove(fen,uci){
  const chess=parseBoard(fen);
  if(typeof uci!=="string"||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))
    throw Error("Stockfish did not return a legal move");
  let move;
  try{
    move=chess.move({...{from:uci.slice(0,2),to:uci.slice(2,4)},...(uci[4]?{promotion:uci[4]}:{})});
  }catch{throw Error("Stockfish returned an illegal move");}
  const names={p:"pawn",n:"knight",b:"bishop",r:"rook",q:"queen",k:"king"};
  let instruction=`Move ${names[move.piece]} from ${move.from} to ${move.to}`;
  if(move.promotion)instruction+=` and promote to ${names[move.promotion]}`;
  return {from:move.from,to:move.to,uci,promotion:move.promotion||null,
    instruction,reason:chess.isCheckmate()?"Checkmate.":chess.isCheck()?"Check.":null};
}
