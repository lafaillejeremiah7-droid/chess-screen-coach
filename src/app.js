import {Chess} from 'chess.js';
import './style.css';
import {INITIAL,GLYPHS,PIECES,fenToBoard,boardToFen,loadTemplates,readBoard} from './recognition.js';
import {LocalStockfish} from './engine.js';

const $=id=>document.getElementById(id);
const source=$('source'),ctx=source.getContext('2d'),frame=document.createElement('canvas');
const frameCtx=frame.getContext('2d',{willReadFrequently:true});
let video=null,stream=null,image=null,templates=null,crop=null,drag=null,selected='.',engine=null;
let board=fenToBoard(INITIAL),orientation='white',lastFen=INITIAL,lastRecognized='',pipWin=null;
const setStatus=(id,msg)=>{$(id).textContent=msg;};
function setImageSize(w,h){
  const scale=Math.min(900/w,640/h,1);
  frame.width=source.width=Math.max(1,Math.round(w*scale));
  frame.height=source.height=Math.max(1,Math.round(h*scale));
  crop=null;
}
function paint(){
  if(video&&video.readyState>=2){frameCtx.drawImage(video,0,0,frame.width,frame.height);}
  else if(image)frameCtx.drawImage(image,0,0,frame.width,frame.height);
  ctx.clearRect(0,0,source.width,source.height);
  ctx.drawImage(frame,0,0);
  if(crop){ctx.strokeStyle='#ffd166';ctx.lineWidth=3;ctx.strokeRect(crop.x,crop.y,crop.size,crop.size);}
  if(drag){ctx.strokeStyle='#ffffff';ctx.setLineDash([6,4]);ctx.lineWidth=2;ctx.strokeRect(drag.x,drag.y,drag.size,drag.size);ctx.setLineDash([]);}
}
function tick(){if(stream||image)paint();requestAnimationFrame(tick);}
requestAnimationFrame(tick);
function coords(e){const r=source.getBoundingClientRect();return {x:(e.clientX-r.left)*source.width/r.width,y:(e.clientY-r.top)*source.height/r.height};}
source.addEventListener('pointerdown',e=>{
  if(!stream&&!image)return;
  source.setPointerCapture(e.pointerId);const p=coords(e);drag={x:p.x,y:p.y,size:0,startX:p.x,startY:p.y};
});
source.addEventListener('pointermove',e=>{
  if(!drag)return;
  const p=coords(e),dx=p.x-drag.startX,dy=p.y-drag.startY;
  const s=Math.min(Math.abs(dx),Math.abs(dy));
  drag.x=dx<0?drag.startX-s:drag.startX;
  drag.y=dy<0?drag.startY-s:drag.startY;
  drag.size=s;
});
source.addEventListener('pointerup',()=>{
  if(!drag)return;
  if(drag.size>=32)crop={x:Math.max(0,drag.x),y:Math.max(0,drag.y),size:Math.min(drag.size,source.width-drag.x,source.height-drag.y)};
  drag=null;
  setStatus('captureStatus',crop?'Board area selected. Click Read board.':'Selection too small; try again.');
});
$('share').onclick=async()=>{
  try{
    if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Screen sharing is not available in this browser. Upload a screenshot instead.');
    if(stream)stream.getTracks().forEach(t=>t.stop());
    stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:4},audio:false});
    video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;video.srcObject=stream;
    await video.play();setImageSize(video.videoWidth,video.videoHeight);image=null;
    stream.getVideoTracks()[0].addEventListener('ended',()=>{stream=null;video=null;setStatus('captureStatus','Screen sharing stopped.');});
    setStatus('captureStatus','Sharing. Drag around the board to select it.');
    $('placeholder').hidden=true;
  }catch(err){setStatus('captureStatus',err.message);}
};
$('stop').onclick=()=>{
  stream?.getTracks().forEach(t=>t.stop());stream=null;video=null;
  setStatus('captureStatus','Screen sharing stopped.');
};
$('upload').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const url=URL.createObjectURL(file);
    const loaded=new Image();loaded.src=url;await loaded.decode();
    image=loaded;stream?.getTracks().forEach(t=>t.stop());stream=null;video=null;
    setImageSize(image.naturalWidth,image.naturalHeight);paint();URL.revokeObjectURL(url);
    $('placeholder').hidden=true;
    setStatus('captureStatus','Screenshot loaded. Drag around the board to select it.');
  }catch(err){setStatus('captureStatus','Image could not be opened: '+err.message);}
};
function piecePosition(fen){return fen.split(' ')[0];}
function maybeTrack(previous,observed){
  if(piecePosition(previous)===piecePosition(observed))return previous;
  try{
    const game=new Chess(previous),matches=[];
    for(const move of game.moves({verbose:true})){
      const test=new Chess(previous);test.move(move);
      if(piecePosition(test.fen())===piecePosition(observed))matches.push(test.fen());
    }
    if(matches.length===1)return matches[0];
  }catch{}
  return null;
}
function updateControlsFromFen(fen){
  const f=fen.split(/\s+/);$('turn').value=f[1]||'w';$('castle').value=f[2]||'-';$('ep').value=f[3]||'-';
}
function currentFen(){return boardToFen(board,orientation,$('turn').value,$('castle').value.trim()||'-',$('ep').value.trim()||'-');}
function renderBoard(){
  const element=$('board');element.replaceChildren();
  board.forEach((rank,r)=>rank.forEach((piece,c)=>{
    const square=document.createElement('button');square.type='button';square.className='square '+((r+c)%2?'dark':'light');
    square.textContent=GLYPHS[piece]||'';
    square.title=`Row ${r+1}, column ${c+1}: ${piece==='.'?'empty':piece}`;
    square.setAttribute('aria-label',square.title);
    square.onclick=()=>{board[r][c]=selected;renderBoard();syncFen();};
    element.append(square);
  }));
}
function renderPalette(){
  const element=$('palette');element.replaceChildren();
  PIECES.forEach(piece=>{
    const b=document.createElement('button');b.type='button';b.className='pieceChoice'+(piece===selected?' chosen':'');
    b.textContent=piece==='.'?'×':GLYPHS[piece];b.title=piece==='.'?'Erase':piece;
    b.onclick=()=>{selected=piece;renderPalette();};element.append(b);
  });
}
function syncFen(){
  const fen=currentFen();$('fen').value=fen;lastFen=fen;
  try{new Chess(fen);setStatus('positionStatus','Position ready for analysis.');}
  catch(err){setStatus('positionStatus','Check position: '+err.message);}
}
function loadFen(fen){
  const game=new Chess(fen);
  lastFen=game.fen();board=fenToBoard(lastFen,orientation);
  updateControlsFromFen(lastFen);$('fen').value=lastFen;renderBoard();
  setStatus('positionStatus','Position loaded.');
}
$('loadFen').onclick=()=>{try{loadFen($('fen').value.trim());}catch(err){setStatus('positionStatus','Invalid FEN: '+err.message);}};
$('reset').onclick=()=>{loadFen(INITIAL);setStatus('positionStatus','Starting position restored.');};
$('orientation').onchange=()=>{
  const old=orientation;orientation=$('orientation').value;
  if(old!==orientation){board=board.slice().reverse().map(row=>row.slice().reverse());renderBoard();syncFen();}
};
for(const id of ['turn','castle','ep'])$(id).addEventListener('change',syncFen);
function uciToMove(fen,uci){
  if(!uci||uci==='(none)')return 'No legal move';
  try{
    const game=new Chess(fen),move=game.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
    return move?move.san+` (${uci.slice(0,2)} → ${uci.slice(2,4)})`:uci;
  }catch{return uci;}
}
function formatEval(line,fen){
  if(!line)return '';
  const whiteToMove=fen.split(' ')[1]==='w';
  const val=whiteToMove?line.score:-line.score;
  return line.scoreType==='mate'?`Mate ${val>0?'+':''}${val}`:`${val>=0?'+':''}${(val/100).toFixed(2)}`;
}
function updatePiP(){
  if(!pipWin||pipWin.closed)return;
  pipWin.document.getElementById('pipBest').textContent=$('best').textContent;
  pipWin.document.getElementById('pipEval').textContent=$('evaluation').textContent;
  pipWin.document.getElementById('pipAlternatives').textContent=$('alternatives').innerText;
}
$('float').onclick=async()=>{
  if(!window.documentPictureInPicture){setStatus('positionStatus','Floating panel requires desktop Chrome. Otherwise, use split windows.');return;}
  try{
    pipWin=await window.documentPictureInPicture.requestWindow({width:400,height:280});
    const style=pipWin.document.createElement('style');
    style.textContent='body{font:16px system-ui;background:#141b22;color:#e8edf2;padding:16px;margin:0}h2{font-size:15px;color:#b2f1ce}#pipBest{font-size:27px;font-weight:750;margin:12px 0}#pipEval,#pipAlternatives{font-size:14px;line-height:1.7;color:#cbd5e1;white-space:pre-line}';
    pipWin.document.head.append(style);
    pipWin.document.body.innerHTML='<h2>Chess Study Sidecar</h2><div id="pipBest"></div><div id="pipEval"></div><div id="pipAlternatives"></div>';
    updatePiP();
  }catch(err){setStatus('positionStatus','Could not open floating panel: '+err.message);}
};
function renderAnalysis(fen,uci,lines){
  if(piecePosition(fen)!==piecePosition($('fen').value.trim())||fen.split(' ')[1]!==$('fen').value.trim().split(' ')[1])return;
  $('best').textContent=uciToMove(fen,uci);
  const first=lines.find(l=>l.rank===1)||lines[0];
  $('evaluation').textContent=first?`Evaluation for White: ${formatEval(first,fen)} · depth ${first.depth}`:'Analysis complete';
  $('alternatives').replaceChildren();
  for(const line of lines){
    const p=document.createElement('p');p.textContent=`${line.rank}. ${uciToMove(fen,line.moves[0])} · ${formatEval(line,fen)} · depth ${line.depth}`;
    $('alternatives').append(p);
  }
  updatePiP();
  setStatus('positionStatus','Analysis complete. Verify that the board was read correctly.');
}
function analyze(){
  try{
    const fen=$('fen').value.trim();new Chess(fen);
    if(!engine?.ready){setStatus('positionStatus','Stockfish is loading. Try again shortly.');return;}
    $('best').textContent='Analyzing…';$('evaluation').textContent='Calculating local engine lines';
    engine.analyze(fen);
  }catch(err){setStatus('positionStatus','Cannot analyze invalid position: '+err.message);}
}
$('analyze').onclick=analyze;
async function read(automatic=false){
  try{
    if(!templates)throw Error('Piece templates not loaded yet.');
    if(!stream&&!image)throw Error('Share a screen or upload a screenshot first.');
    if(!crop)throw Error('Drag a square around the board first.');
    paint();
    const detected=await readBoard(frame,crop,templates,orientation);
    const placement=piecePosition(detected.fen);
    if(automatic&&placement===lastRecognized)return;
    lastRecognized=placement;
    const prev=$('fen').value.trim();
    let fen=maybeTrack(prev,detected.fen);
    if(!fen){
      const startPieces=piecePosition(INITIAL);
      const castle=placement===startPieces?'KQkq':'-';
      fen=boardToFen(detected.board,orientation,$('turn').value,castle,'-');
    }
    board=detected.board;renderBoard();updateControlsFromFen(fen);$('fen').value=fen;lastFen=fen;
    const kings=board.flat().filter(p=>p==='K').length===1&&board.flat().filter(p=>p==='k').length===1;
    if(!kings){setStatus('positionStatus','Recognition uncertain: missing or duplicate king. Correct the board manually.');return;}
    try{new Chess(fen);}catch(err){setStatus('positionStatus','Recognized position needs correction: '+err.message);return;}
    setStatus('captureStatus',`Read board. ${detected.lowConfidence} piece(s) have uncertain recognition.`);
    setStatus('positionStatus','Position recognized. Verify the pieces, turn, and castling rights.');
    if(automatic)analyze();
  }catch(err){setStatus('captureStatus',err.message);}
}
$('read').onclick=()=>read(false);
setInterval(()=>{if($('auto').checked&&stream&&crop)read(true);},3000);
async function init(){
  $('fen').value=INITIAL;renderBoard();renderPalette();
  try{templates=await loadTemplates();}
  catch(err){setStatus('captureStatus','Templates unavailable: '+err.message);}
  try{
    engine=new LocalStockfish(
      msg=>setStatus('positionStatus',msg),
      (fen,lines)=>{
        const first=lines[0];
        if(first&&piecePosition(fen)===piecePosition($('fen').value.trim())){
          $('best').textContent=uciToMove(fen,first.moves[0]);
          $('evaluation').textContent=`Depth ${first.depth} · evaluation ${formatEval(first,fen)}`;
          updatePiP();
        }
      },
      renderAnalysis
    );
    await engine.init();
  }catch(err){setStatus('positionStatus','Local engine unavailable: '+err.message);}
}
init();