import {Chess} from "chess.js";

export function parseBoard(fen){
  if(typeof fen!=="string"||fen.length>120)throw Error("Invalid chess FEN");
  try{return new Chess(fen);}catch{throw Error("Invalid chess FEN");}
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
