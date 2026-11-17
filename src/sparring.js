/* Standalone offline practice opponent. Engine decisions come only after your White move. */
const $=id=>document.getElementById(id);
const pieces={K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙",k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"\u265F\uFE0E"};
const files="abcdefgh";
let state=null,selected="",pending=false,records=[],gameMoves=[];

function squaresFromFen(fen){
  const ranks=fen.split(" ")[0].split("/");
  if(ranks.length!==8)throw Error("Invalid FEN");
  return ranks.flatMap(rank=>{
    const squares=[];
    for(const symbol of rank){
      if(/[1-8]/.test(symbol))squares.push(...Array(Number(symbol)).fill(""));
      else squares.push(symbol);
    }
    if(squares.length!==8)throw Error("Invalid FEN rank");
    return squares;
  });
}
const squareAt=(rank,file)=>files[file]+(8-rank);
const white=piece=>piece!==""&&piece===piece.toUpperCase();
function feedback(message){$('feedback').textContent=message;}
function render(){
  if(!state)return;
  const board=$('board'),parts=squaresFromFen(state.fen);
  board.replaceChildren();
  for(let rank=0;rank<8;rank++)for(let file=0;file<8;file++){
    const piece=parts[rank*8+file],square=squareAt(rank,file);
    const button=document.createElement("button");
    button.type="button";
    button.className=((rank+file)%2===0?"light":"dark")+
      (square===selected?" selected":"")+
      (selected&&state.legal_moves.some(move=>move.startsWith(selected+square))?" possible":"");
    button.textContent=pieces[piece]||"";
    button.setAttribute("aria-label",square+" "+(piece||"empty"));
    button.addEventListener("click",()=>{
      if(pending||state.finished)return;
      if(selected){
        if(square===selected){selected="";render();return;}
        if(white(piece)){selected=square;render();return;}
        const legal=state.legal_moves.filter(move=>move.startsWith(selected+square));
        if(!legal.length){feedback("Illegal destination.");return;}
        // Auto-queen on board clicks; underpromote with UCI input instead.
        const uci=legal.find(move=>move.endsWith("q"))||legal[0];
        selected="";render();
        void submit(uci);
      }else if(white(piece)){
        selected=square;render();
      }
    });
    board.appendChild(button);
  }
}
async function fetchJson(url,body){
  const response=await fetch(url,body===undefined?{}:{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"Local chess server unavailable");
  return data;
}
async function restart(){
  if(pending)return;
  pending=true;
  try{
    state=await fetchJson("/api/sparring/start");
    selected="";records=[];gameMoves=[];$('uci').value="";
    $('moves').replaceChildren();
    feedback("White to move. Choose a piece and then its destination.");
    render();
  }catch(error){feedback(error.message);}
  finally{pending=false;}
}
async function submit(uci){
  if(pending||!state||state.finished)return;
  const move=(uci??$('uci').value).trim().toLowerCase();
  if(!state.legal_moves.includes(move)){
    feedback("Illegal move. Choose highlighted squares, or type a legal UCI move.");
    return;
  }
  pending=true;$('submit').disabled=true;$('elo').disabled=true;
  feedback("Stockfish is calculating its reply…");
  try{
    const result=await fetchJson("/api/sparring/turn",{
      fen:state.fen,move,elo:Number($('elo').value),moves:gameMoves
    });
    const step=records.length+1;
    const label=step+". "+result.human_san+(result.engine_san?" "+result.engine_san:"");
    records.push(label);
    gameMoves.push(result.human_uci);
    if(result.engine_uci)gameMoves.push(result.engine_uci);
    const item=document.createElement("div");item.textContent=label;
    $('moves').appendChild(item);
    state=result;
    selected="";$('uci').value="";
    render();
    feedback(result.status+(result.engine_san?" Stockfish played "+result.engine_san+".":""));
  }catch(error){feedback(error.message);}
  finally{pending=false;$('submit').disabled=false;$('elo').disabled=false;}
}
$('restart').addEventListener("click",()=>void restart());
$('submit').addEventListener("click",()=>void submit());
$('uci').addEventListener("keydown",event=>{
  if(event.key==="Enter"){event.preventDefault();void submit();}
});
void restart();
