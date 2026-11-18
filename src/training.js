/* Adaptive human-first chess training. No hint is requested before a move or timeout. */
const $=id=>document.getElementById(id);
const glyph={K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙",k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"};
const STORE="chess-coach-adaptive-v1";
let bank=[],current=null,selected=null,sessionStarted=false,answered=0,deadline=0;
let waiting=false,feedback=false,hidden=false,controlChanged=0;
let controlPolling=false,controlRevision=0;
let sessionToken=0,timerPaused=false,timerRemaining=10000;
const isPaused=()=>hidden||document.hidden;
function syncTimerPause(){
  if(!sessionStarted||!current)return;
  if(isPaused()&&!timerPaused){
    timerRemaining=Math.max(0,deadline-Date.now());
    timerPaused=true;
  }else if(!isPaused()&&timerPaused){
    deadline=Date.now()+timerRemaining;
    timerPaused=false;
  }
}
let history={answered:0,cards:{},themes:{},lossTotal:0,lossCount:0,matched:0,attempts:0};
try{
  const saved=JSON.parse(localStorage.getItem(STORE)||"null");
  if(saved && typeof saved==="object" && saved.cards && saved.themes)history={...history,...saved};
}catch{}
const save=()=>{try{localStorage.setItem(STORE,JSON.stringify(history));}catch{}};
function notice(message){$('trainer-feedback').textContent=message;}
function showStats(){
  $('progress').textContent=answered+" / 100";
  $('avg-loss').textContent=history.lossCount?Math.round(history.lossTotal/history.lossCount)+" cp":"—";
  $('accuracy').textContent=history.attempts?
    Math.round(history.matched*100/history.attempts)+"%":"—";
}
function parseBoard(fen){
  const rows=fen.split(" ")[0].split("/");
  const squares=[];
  for(const rank of rows){
    const out=[];
    for(const c of rank)if(/[1-8]/.test(c))for(let i=0;i<Number(c);i++)out.push("");
      else out.push(c);
    if(out.length!==8)throw Error("Invalid training position");
    squares.push(...out);
  }
  if(squares.length!==64)throw Error("Invalid training position");
  return squares;
}
function renderBoard(fen){
  const board=$('trainer-board');
  board.replaceChildren();
  const pieces=parseBoard(fen),turn=fen.split(" ")[1];
  for(let row=0;row<8;row++)for(let file=0;file<8;file++){
    const piece=pieces[row*8+file];
    const square="abcdefgh"[file]+(8-row);
    const button=document.createElement("button");
    button.type="button";
    button.className=((row+file)%2===0?"light":"dark")+(selected===square?" selected":"");
    button.textContent=glyph[piece]||"";
    button.setAttribute("aria-label",square+" "+(piece||"empty"));
    button.title=square;
    button.addEventListener("click",()=>{
      if(!sessionStarted||!current||waiting||feedback||hidden)return;
      if(!selected){
        if(piece && (piece===piece.toUpperCase())===(turn==="w")){
          selected=square;renderBoard(fen);
        }
        return;
      }
      if(selected===square){selected=null;renderBoard(fen);return;}
      if(piece && (piece===piece.toUpperCase())===(turn==="w")){
        selected=square;renderBoard(fen);return;
      }
      const from=selected,fromPiece=pieces[(8-Number(from[1]))*8+"abcdefgh".indexOf(from[0])];
      const promotion=fromPiece?.toLowerCase()==="p"&&(square[1]==="1"||square[1]==="8")?"q":"";
      selected=null;
      $('candidate').value=from+square+promotion;
      renderBoard(fen);
      void submitMove();
    });
    board.appendChild(button);
  }
}
function weakness(theme){
  const stat=history.themes[theme];
  if(!stat||!stat.count)return 110;
  return (stat.lossSum/stat.count)*0.9+(stat.misses/stat.count)*280;
}
function chooseNext(){
  if(!bank.length)throw Error("Position bank is empty");
  const tick=history.answered+1;
  const recently=Object.entries(history.cards)
    .filter(([,card])=>card.last>=tick-3)
    .map(([id])=>id);
  const weighted=bank.map(position=>{
    const card=history.cards[position.id];
    const due=card && card.due<=tick;
    const unseen=!card;
    let points=weakness(position.theme)+(due?1100:0)+(unseen?300:0);
    if(recently.includes(position.id))points-=2000;
    if(card && card.due>tick)points-=1500;
    return {position,points:points+Math.random()*30};
  });
  weighted.sort((a,b)=>b.points-a.points);
  return weighted[0].position;
}
function scheduleReview(position,result){
  const tick=++history.answered;
  const card=history.cards[position.id]||{ease:2.5,interval:0,attempts:0};
  const loss=result.centipawn_loss;
  const quality=result.played===null?0:
    loss===null?2:loss<=30?5:loss<=75?4:loss<=150?3:loss<=300?2:1;
  card.ease=Math.max(1.3,card.ease+(.1-(5-quality)*(.08+(5-quality)*.02)));
  card.interval=quality<3?4:card.attempts===0?12:
    Math.max(12,Math.round(Math.max(12,card.interval)*card.ease));
  card.due=tick+card.interval;
  card.last=tick;
  card.attempts++;
  card.lastLoss=loss;
  history.cards[position.id]=card;
  const stats=history.themes[position.theme]||{count:0,lossSum:0,misses:0};
  stats.count++;
  stats.lossSum+=(loss===null?300:Math.min(1500,loss));
  stats.misses+=(quality<3?1:0);
  history.themes[position.theme]=stats;
  history.attempts++;
  if(result.matched_best)history.matched++;
  if(typeof loss==="number"){history.lossTotal+=loss;history.lossCount++;}
  save();
}
function nextPosition(){
  if(!sessionStarted)return;
  if(answered>=100){
    sessionStarted=false;current=null;deadline=0;
    $('next').hidden=true;$('submit').disabled=true;
    notice("Session complete: 100 positions assessed. Your weakness profile and review schedule are saved.");
    $('position').textContent="100-position session complete.";
    showStats();return;
  }
  current=chooseNext();selected=null;feedback=false;waiting=false;
  $('candidate').value="";
  $('next').hidden=true;$('submit').disabled=false;
  $('position').textContent="Position "+(answered+1)+" of 100 · "+current.theme.replaceAll("_"," ")+" · "+current.turn+" to move";
  renderBoard(current.fen);
  notice("Predict the best move. Click from/to squares or type a UCI move.");
  timerRemaining=10000;
  timerPaused=isPaused();
  deadline=Date.now()+10000;
  updateClock();
}
function updateClock(){
  $('clock').textContent=(!sessionStarted||!current)?"10s":
    isPaused()?"Paused":waiting||feedback?"—":
    Math.max(0,Math.ceil((deadline-Date.now())/1000))+"s";
}
async function submitMove(forced=null){
  if(!sessionStarted||!current||waiting||feedback||isPaused())return;
  const token=sessionToken;
  const position=current;
  const value=forced===null?$('candidate').value.trim().toLowerCase():forced;
  if(value && !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value)){
    notice("Enter a UCI move like e2e4, or select the piece and destination.");
    return;
  }
  waiting=true;$('submit').disabled=true;
  const timedOut=value==="" || Date.now()>=deadline;
  notice("Calculating Stockfish 19 feedback…");
  try{
    const response=await fetch('/api/training/evaluate',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({fen:position.fen,move:timedOut?null:value})});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||"Engine evaluation failed");
    // H might have hidden the coach while the server was running.
    if(token!==sessionToken)return;
    if(isPaused()){notice("Analysis paused. Submit again when visible.");return;}
    feedback=true;answered++;
    scheduleReview(position,result);
    showStats();
    notice((timedOut?"No move submitted.":'Your move: '+result.played_san+".")+
      "\nStockfish: "+result.best_san+
      "\nCentipawn loss: "+(result.centipawn_loss===null?"not measurable":result.centipawn_loss)+
      "\n"+result.explanation);
    $('next').hidden=false;
    $('next').textContent=answered>=100?"Finish session":"Next position";
  }catch(error){if(token===sessionToken)notice(error.message+" Try again when the engine is available.");}
  finally{
    if(token===sessionToken){
      waiting=false;
      $('submit').disabled=feedback||isPaused();
      updateClock();
    }
  }
}
function updateHidden(paused){
  if(hidden===paused)return;
  controlRevision++;
  hidden=paused;document.body.classList.toggle('trainer-paused',paused);
  syncTimerPause();
  if(paused){notice("Coach hidden. Press H to show it.");}
  updateClock();
}
document.addEventListener('keydown',event=>{
  if(event.key?.toLowerCase()!=="h"||event.repeat||event.isComposing||
    event.ctrlKey||event.altKey||event.metaKey)return;
  const target=event.target;
  if(["INPUT","TEXTAREA","SELECT"].includes(target?.tagName)||
    target?.isContentEditable||target?.closest?.('[contenteditable],[role="textbox"]'))return;
  event.preventDefault();
  const paused=!hidden;
  updateHidden(paused);
  controlChanged=Date.now();
  void fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({hidden:paused})}).catch(()=>{});
},true);
$('start').onclick=async()=>{
  const token=++sessionToken;
  try{
    const response=await fetch('/api/training/positions');
    if(!response.ok)throw Error("Cannot load training positions");
    const data=await response.json();
    if(!Array.isArray(data.positions)||data.positions.length<100)throw Error("Exercise bank is incomplete");
    if(token!==sessionToken)return;
    bank=data.positions;
    answered=0;sessionStarted=true;waiting=false;feedback=false;
    $('start').textContent="Restart session";
    showStats();
    nextPosition();
  }catch(error){if(token===sessionToken)notice(error.message);}
};
document.addEventListener('visibilitychange',()=>{syncTimerPause();updateClock();});
$('next').onclick=()=>nextPosition();
$('submit').onclick=()=>void submitMove();
$('candidate').addEventListener('keydown',event=>{
  if(event.key==="Enter"){event.preventDefault();void submitMove();}
});
setInterval(()=>{
  if(sessionStarted&&current&&!isPaused()&&!waiting&&!feedback&&Date.now()>=deadline)
    void submitMove("");
  updateClock();
},150);
setInterval(async()=>{
  if(controlPolling||Date.now()-controlChanged<1800)return;
  controlPolling=true;
  const revision=controlRevision;
  try{
    const response=await fetch('/api/control');
    if(response.ok){
      const data=await response.json();
      if(revision===controlRevision&&typeof data.hidden==="boolean")updateHidden(data.hidden);
    }
  }catch{}
  finally{controlPolling=false;}
},1500);
showStats();
