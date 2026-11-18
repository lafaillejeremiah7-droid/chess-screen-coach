import {INITIAL, boardToFen, loadTemplates, readBoard, isBlackCapture} from './recognition.js';

const $ = id => document.getElementById(id);
const canvas = $('screen');
const ctx = canvas.getContext('2d');
const frame = document.createElement('canvas');
const frameCtx = frame.getContext('2d', {willReadFrequently:true});
const captureProbe=document.createElement('canvas');
captureProbe.width=captureProbe.height=32;
const captureProbeCtx=captureProbe.getContext('2d',{willReadFrequently:true});
let video=null, stream=null, screenshot=null, templates=null, crop=null, drag=null;
let currentFen=null, pipWin=null, busy=false, requestNumber=0;
let previewTimer=null, captureInterrupted=false,coachHidden=false,wasFloating=false,lastControlAt=0;
let captureVersion=0;
function invalidateCapture(){captureVersion++;requestNumber++;}
const placement = fen => fen.split(' ')[0];
const startingPlacement = placement(INITIAL);
const status = message => { $('status').textContent=message; };

// Main-agent strength is a browser preference; the server validates each request.
const strengthControl=$('strengthElo'),fullStrengthControl=$('fullStrength');
const savedElo=Number(localStorage.getItem('chessCoachMainElo'));
strengthControl.value=Number.isInteger(savedElo)&&savedElo>=1320&&savedElo<=3190?savedElo:1400;
fullStrengthControl.checked=localStorage.getItem('chessCoachMainFull')!=='false';
function selectedStrength(){return fullStrengthControl.checked?'full':Number(strengthControl.value);}
function refreshStrength(){
  $('strengthValue').textContent=strengthControl.value;
  strengthControl.disabled=fullStrengthControl.checked;
  localStorage.setItem('chessCoachMainElo',strengthControl.value);
  localStorage.setItem('chessCoachMainFull',String(fullStrengthControl.checked));
  invalidateCapture();
  if(currentFen&&!coachHidden&&currentFen.split(' ')[1]===$('myColor').value)
    void recommend(currentFen);
}
strengthControl.addEventListener('input',refreshStrength);
fullStrengthControl.addEventListener('change',refreshStrength);
$('strengthValue').textContent=strengthControl.value;
strengthControl.disabled=fullStrengthControl.checked;


async function api(path, payload) {
  const response = await fetch(path, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error || 'Python server request failed');
  return body;
}

function display(instruction) {
  if(coachHidden)return;
  $('move').textContent = instruction;
  if (pipWin && !pipWin.closed) {
    const target=pipWin.document.getElementById('instruction');
    if (target) target.textContent=instruction;
  }
}

function setupSize(width,height) {
  const scale=Math.min(960/width,700/height,1);
  frame.width=canvas.width=Math.max(1,Math.round(width*scale));
  frame.height=canvas.height=Math.max(1,Math.round(height*scale));
  crop=null;
  currentFen=null;
  invalidateCapture();
}

function captureIsBlack(){
  if(!crop)return false;
  captureProbeCtx.clearRect(0,0,32,32);
  captureProbeCtx.drawImage(frame,crop.x,crop.y,crop.size,crop.size,0,0,32,32);
  return isBlackCapture(captureProbeCtx.getImageData(0,0,32,32));
}

function redraw() {
  if (video && video.readyState >= 2) frameCtx.drawImage(video,0,0,frame.width,frame.height);
  else if (screenshot) frameCtx.drawImage(screenshot,0,0,frame.width,frame.height);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(frame,0,0);
  if (crop) {
    ctx.lineWidth=3;ctx.strokeStyle='#efcb77';
    ctx.strokeRect(crop.x,crop.y,crop.size,crop.size);
  }
  if (drag) {
    ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.setLineDash([6,4]);
    ctx.strokeRect(drag.x,drag.y,drag.size,drag.size);ctx.setLineDash([]);
  }
}

function animate() {
  clearTimeout(previewTimer);
  previewTimer=null;
  if (!stream || document.hidden || coachHidden) return;
  redraw();
  // Capture is only 4 fps. Do not repaint at display refresh rate, or repaint
  // a static screenshot forever. readNow still captures when analysis needs it.
  previewTimer=setTimeout(animate,250);
}
document.addEventListener('visibilitychange',animate);

function canvasPoint(event) {
  const bounds=canvas.getBoundingClientRect();
  return {
    x:(event.clientX-bounds.left)*canvas.width/bounds.width,
    y:(event.clientY-bounds.top)*canvas.height/bounds.height,
  };
}

canvas.addEventListener('pointerdown', event => {
  if (!stream && !screenshot) return;
  canvas.setPointerCapture(event.pointerId);
  const p=canvasPoint(event);
  drag={x:p.x,y:p.y,size:0,startX:p.x,startY:p.y};
  redraw();
});
canvas.addEventListener('pointermove', event => {
  if (!drag) return;
  const p=canvasPoint(event), dx=p.x-drag.startX, dy=p.y-drag.startY;
  const size=Math.min(Math.abs(dx),Math.abs(dy));
  drag.x=dx<0?drag.startX-size:drag.startX;
  drag.y=dy<0?drag.startY-size:drag.startY;
  drag.size=size;
  redraw();
});
canvas.addEventListener('pointerup', async () => {
  if (!drag) return;
  const area=drag;
  drag=null;
  redraw();
  const x=Math.max(0,area.x),y=Math.max(0,area.y);
  const size=Math.min(area.size,canvas.width-x,canvas.height-y);
  if (size<64) {status('Select the entire chessboard, not just one square.');return;}
  crop={x,y,size};
  currentFen=null;
  invalidateCapture();
  display('Move — to —');
  status('Board selected. Reading position...');
  await readNow(true);
});

$('share').onclick = async () => {
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) throw Error('Desktop Chrome screen sharing required.');
    stream?.getTracks().forEach(t=>t.stop());
    const acquired=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:4},audio:false});
    stream=acquired;
    video=document.createElement('video');
    video.muted=true; video.autoplay=true; video.playsInline=true;
    video.srcObject=stream;
    await video.play();
    setupSize(video.videoWidth,video.videoHeight);
    screenshot=null;
    animate();
    $('placeholder').hidden=true;
    status('Drag over the chessboard in the preview.');
    acquired.getVideoTracks()[0].addEventListener('ended',()=>{
      if(stream!==acquired)return;
      invalidateCapture();
      stream=null;video=null;currentFen=null;
      display('Move — to —');
      status('Screen sharing ended.');
    });
  } catch(error){status(error.message);}
};
$('stop').onclick=()=>{
  invalidateCapture();
  stream?.getTracks().forEach(t=>t.stop());stream=null;video=null;
  currentFen=null;
  display('Move — to —');
  status('Screen sharing stopped.');
};
$('upload').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=url;await img.decode();
    stream?.getTracks().forEach(t=>t.stop());stream=null;video=null;
    screenshot=img;
    setupSize(img.naturalWidth,img.naturalHeight);
    $('placeholder').hidden=true;
    redraw();
    status('Screenshot ready. Drag around the chessboard.');
  }catch(error){status('Cannot open screenshot: '+error.message);}
  finally{URL.revokeObjectURL(url);}
};

function castlingFor(placementValue) {
  const selected=$('castle').value;
  if (selected!=='auto') return selected;
  return placementValue===startingPlacement?'KQkq':'-';
}

async function recommend(fen) {
  if(coachHidden)return;
  const sequence=++requestNumber;
  display('Analyzing…');
  try {
    const result=await api('/api/analyze',{fen,elo:selectedStrength()});
    if (coachHidden || sequence!==requestNumber || currentFen!==fen) return;
    display(result.instruction);
    status('Ready. Watching the board for the next move.');
  }catch(error){
    if(sequence!==requestNumber)return;
    display('Move — to —');
    status(error.message);
  }
}

async function readNow(resync=false) {
  if(busy||!crop||coachHidden)return;
  const epoch=captureVersion;
  busy=true;
  try {
    if (!templates) throw Error('Board recognition templates are not ready.');
    if (!stream && !screenshot) throw Error('Share a screen or upload a screenshot.');
    redraw();
    if(stream && (!video || video.readyState<2 || stream.getVideoTracks().some(t=>t.muted||t.readyState!=='live'))){
      ++requestNumber;
      captureInterrupted=true;
      display('Capture unavailable');
      status('Screen capture is paused or ended. Check Chrome screen sharing, then resume.');
      return;
    }
    if(captureIsBlack()){
      ++requestNumber;
      captureInterrupted=true;
      display('Board temporarily unavailable');
      status('Captured chessboard is black. Waiting for a visible frame; no position update made.');
      return;
    }
    const recovered=captureInterrupted;
    captureInterrupted=false;
    const orientation=$('orientation').value;
    const result=await readBoard(frame,crop,templates,orientation);
    if(epoch!==captureVersion||coachHidden)return;
    if (result.lowConfidence>6)
      throw Error('Board recognition is uncertain. Select a clearer board or paste a FEN.');
    const observed=placement(result.fen);
    if (resync || !currentFen) {
      const fen=boardToFen(result.board,orientation,$('turn').value,castlingFor(observed),'-');
      currentFen=fen;
      $('fen').value=fen;
    } else if (placement(currentFen)!==observed) {
      const tracked=await api('/api/track',{previous:currentFen,placement:observed});
      if(epoch!==captureVersion||coachHidden)return;
      currentFen=tracked.fen;
      $('fen').value=currentFen;
    } else if (!recovered) return;

    if (currentFen.split(' ')[1]!==$('myColor').value) {
      ++requestNumber;
      display('Waiting for your turn');
      status('Position tracked. Waiting for your side to move.');
    } else await recommend(currentFen);
  }catch(error){
    if(epoch!==captureVersion||coachHidden)return;
    captureInterrupted=true;
    ++requestNumber;
    display('Move — to —');
    status(error.message+' Use Read / resync board if moves were missed.');
  }finally{
    busy=false;
    if(epoch!==captureVersion&&crop&&(stream||screenshot)&&!coachHidden)
      void readNow(true);
  }
}

$('resync').onclick=()=>readNow(true);
$('orientation').onchange=()=>{
  invalidateCapture();currentFen=null;
  status('Board orientation changed. Select Read / resync board.');
};
$('turn').onchange=()=>{invalidateCapture();currentFen=null;status('Turn changed. Select Read / resync board.');};
$('myColor').onchange=()=>{
  if(currentFen && currentFen.split(' ')[1]===$('myColor').value) recommend(currentFen);
  else display('Waiting for your turn');
};
$('analyzeFen').onclick=async()=>{
  try {
    const fen=$('fen').value.trim();
    if(!fen) throw Error('Enter a FEN.');
    currentFen=fen;
    await recommend(fen);
  }catch(error){status(error.message);}
};

async function openFloating(){
  if(!window.documentPictureInPicture){
    status('Floating move panel requires a recent desktop Chrome version.');
    return;
  }
  try {
    pipWin=await documentPictureInPicture.requestWindow({width:300,height:86});
    wasFloating=true;
    const style=pipWin.document.createElement('style');
    style.textContent='html,body{margin:0;width:100%;height:100%;background:#102030;color:#fff;font-family:system-ui,sans-serif;}body{display:flex;align-items:center;justify-content:center;padding:6px;box-sizing:border-box;}#instruction{font-size:14px;text-align:center;font-weight:700;line-height:1.2;}';
    pipWin.document.head.append(style);
    const text=pipWin.document.createElement('div');
    text.id='instruction';
    text.textContent=$('move').textContent;
    pipWin.document.body.replaceChildren(text);
    pipWin.document.addEventListener('keydown',handleCoachKey,true);
  }catch(error){status('Cannot open floating panel: '+error.message);}
}
$('float').onclick=()=>{if(!coachHidden)void openFloating();};


function updatePaused(hidden){
  if(coachHidden===hidden)return;
  coachHidden=hidden;
  invalidateCapture(); // Pending recognition and move responses are stale.
  document.body.classList.toggle('coach-paused',hidden);
  if(hidden){
    if(pipWin && !pipWin.closed){
      wasFloating=true;
      pipWin.close();
    }
    pipWin=null;
    clearTimeout(previewTimer);previewTimer=null;
    $('move').textContent='';
    status('Coach hidden. Press H to resume.');
  }else{
    status('Coach visible. Resume analysis when ready.');
    animate();
  }
}

function handleCoachKey(event){
  if(event.key?.toLowerCase()!=='h'||event.repeat||event.isComposing||
     event.altKey||event.ctrlKey||event.metaKey)return;
  const target=event.target;
  if(['INPUT','TEXTAREA','SELECT'].includes(target?.tagName?.toUpperCase?.())||
     target?.isContentEditable||target?.closest?.('[contenteditable],[role="textbox"]'))return;
  event.preventDefault();event.stopPropagation();
  const next=!coachHidden;
  updatePaused(next);
  lastControlAt=Date.now();
  // A direct keypress allows opening the PiP again on supporting browsers.
  if(!next && wasFloating){wasFloating=false;void openFloating();}
  void api('/api/control',{hidden:next}).catch(e=>status('Visibility sync unavailable: '+e.message));
}
document.addEventListener('keydown',handleCoachKey,true);

// When H is pressed in a Chess.com tab, the extension updates the same server.
setInterval(async()=>{
  if(Date.now()-lastControlAt<1900)return;
  try{
    const response=await fetch('/api/control');
    if(!response.ok)return;
    const state=await response.json();
    if(typeof state.hidden==='boolean')updatePaused(state.hidden);
  }catch{/* Local Python server not available. */}
},1400);

setInterval(()=>{
  if(!coachHidden && $('auto').checked && stream && crop)readNow(false);
},2000);

(async()=>{
  try {
    const res=await fetch('/api/health');
    if(!res.ok)throw Error('Python server unavailable');
    const health=await res.json();
    if(!health.stockfish)status('Install Stockfish with sudo apt install stockfish, then restart python server.py');
    else status('Python + Stockfish ready. Share your board.');
    templates=await loadTemplates();
  } catch(error){status('Setup error: '+error.message);}
})();
