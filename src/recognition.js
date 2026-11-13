// The template matcher operates entirely on a Canvas image. It is tuned for the
// standard green Chess.com board and the user's supplied piece theme.
export const GLYPHS={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟','.':''};
export const INITIAL='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const PIECES=['.','K','Q','R','B','N','P','k','q','r','b','n','p'];
const N=48;
const median=values=>{values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)]||0;};
export function tileFeature(data){
  if(data.width!==N||data.height!==N)throw Error('Expected a 48×48 tile.');
  const pixels=data.data,corner=[[],[],[]];
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    if((x<4||x>=N-4)&&(y<4||y>=N-4)){
      const i=(y*N+x)*4;for(let c=0;c<3;c++)corner[c].push(pixels[i+c]);
    }
  }
  const bg=corner.map(median),mask=new Uint8Array(N*N),brights=[];
  let area=0;
  for(let y=5;y<N-5;y++)for(let x=5;x<N-5;x++){
    const i=(y*N+x)*4;
    const d=Math.hypot(pixels[i]-bg[0],pixels[i+1]-bg[1],pixels[i+2]-bg[2]);
    if(d>28){mask[y*N+x]=1;area++;brights.push((pixels[i]+pixels[i+1]+pixels[i+2])/3);}
  }
  return {mask,bright:median(brights),area};
}
export function recognizeTile(feature,templates){
  if(feature.area<50)return {piece:'.',confidence:1};
  let first={score:Infinity,piece:'.'},second={score:Infinity,piece:'.'};
  for(const [piece,template] of Object.entries(templates)){
    let mismatches=0;
    for(let i=0;i<feature.mask.length;i++)if(feature.mask[i]!==template.mask[i])mismatches++;
    const score=mismatches/(N*N)+0.0006*Math.abs(feature.area-template.area)+0.002*Math.abs(feature.bright-template.bright);
    if(score<first.score){second=first;first={piece,score};}
    else if(score<second.score)second={piece,score};
  }
  return {piece:first.piece,confidence:Math.max(0,Math.min(1,(second.score-first.score)*5)),score:first.score};
}
export function boardToFen(board,orientation='white',turn='w',castling='-',ep='-'){
  if(board.length!==8||board.some(row=>row.length!==8))throw Error('Board must be 8×8.');
  const standard=orientation==='white'?board:board.slice().reverse().map(row=>row.slice().reverse());
  const ranks=standard.map(row=>{
    let out='',empty=0;
    for(const piece of row){
      if(piece==='.')empty++;
      else {if(empty)out+=empty;empty=0;out+=piece;}
    }
    if(empty)out+=empty;
    return out;
  });
  return ranks.join('/')+` ${turn} ${castling||'-'} ${ep||'-'} 0 1`;
}
export function fenToBoard(fen,orientation='white'){
  const ranks=fen.split(' ')[0].split('/');
  if(ranks.length!==8)throw Error('Invalid FEN ranks.');
  const board=ranks.map(rank=>{
    const row=[];
    for(const c of rank){
      if(/[1-8]/.test(c))for(let i=0;i<Number(c);i++)row.push('.');
      else if(PIECES.includes(c)&&c!=='.')row.push(c);
      else throw Error('Invalid FEN piece.');
    }
    if(row.length!==8)throw Error('Invalid FEN rank width.');
    return row;
  });
  return orientation==='white'?board:board.reverse().map(row=>row.reverse());
}
export async function readBoard(source,crop,templates,orientation){
  if(!crop||crop.size<32)throw Error('Drag a square around the entire board first.');
  const scratch=document.createElement('canvas');scratch.width=N;scratch.height=N;
  const ctx=scratch.getContext('2d',{willReadFrequently:true});
  const board=[];let low=0;
  for(let row=0;row<8;row++){
    const pieces=[];
    for(let col=0;col<8;col++){
      ctx.clearRect(0,0,N,N);
      const step=crop.size/8;
      ctx.drawImage(source,crop.x+col*step,crop.y+row*step,step,step,0,0,N,N);
      const result=recognizeTile(tileFeature(ctx.getImageData(0,0,N,N)),templates);
      pieces.push(result.piece);if(result.confidence<0.12&&result.piece!=='.')low++;
    }
    board.push(pieces);
  }
  return {board,lowConfidence:low,fen:boardToFen(board,orientation)};
}
export async function loadTemplates(){
  const res=await fetch(new URL('templates/pieces.json',document.baseURI));
  if(!res.ok)throw Error('Piece templates could not be loaded.');
  const raw=await res.json();
  return Object.fromEntries(Object.entries(raw.pieces).map(([piece,t])=>[piece,{mask:Uint8Array.from(t.mask,c=>Number(c)),bright:t.bright,area:t.area}]));
}