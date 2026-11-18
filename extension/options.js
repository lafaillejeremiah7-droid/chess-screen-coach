"use strict";
const defaults={playerSide:"auto",thinkSeconds:1,strengthElo:1400,fullStrength:true,showDetails:false};
const allowed=[0.2,0.5,1,2];
const $=id=>document.getElementById(id);
chrome.storage.local.get(defaults,values=>{
  $("playerSide").value=["auto","w","b"].includes(values.playerSide)?values.playerSide:"auto";
  $("thinkSeconds").value=String(allowed.includes(values.thinkSeconds)?values.thinkSeconds:1);
  $("showDetails").checked=values.showDetails===true;
  $("strengthElo").value=Number.isInteger(values.strengthElo)&&values.strengthElo>=1320&&values.strengthElo<=3190?String(values.strengthElo):"1400";
  $("fullStrength").checked=values.fullStrength!==false;
  updateStrengthDisplay();
});
function updateStrengthDisplay(){
  $("strengthValue").textContent=$("strengthElo").value;
  $("strengthElo").disabled=$("fullStrength").checked;
}
$("strengthElo").addEventListener("input",updateStrengthDisplay);
$("fullStrength").addEventListener("change",updateStrengthDisplay);
$("settings").addEventListener("submit",event=>{
  event.preventDefault();
  const seconds=Number($("thinkSeconds").value);
  if(!allowed.includes(seconds)){
    $("status").textContent="Invalid analysis time.";
    return;
  }
  const strengthElo=Number($("strengthElo").value);
  if(!Number.isInteger(strengthElo)||strengthElo<1320||strengthElo>3190){
    $("status").textContent="Invalid main-agent strength.";
    return;
  }
  chrome.storage.local.set({
    strengthElo,
    fullStrength:$("fullStrength").checked,
    playerSide:$("playerSide").value,
    thinkSeconds:seconds,
    showDetails:$("showDetails").checked
  },()=>{
    $("status").textContent=chrome.runtime.lastError?
      "Settings could not be saved.":"Saved. Settings apply to open chess tabs.";
  });
});

// Run diagnostics from the extension page, without relying on Chess.com injection.
async function localApi(path,body){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),6000);
  try{
    const response=await fetch("http://127.0.0.1:8765"+path,{
      method:body===undefined?"GET":"POST",
      headers:body===undefined?{}:{"Content-Type":"application/json"},
      body:body===undefined?undefined:JSON.stringify(body),
      signal:controller.signal
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.error||"Server error "+response.status);
    return data;
  }finally{clearTimeout(timeout);}
}

$("checkEngine").addEventListener("click",async()=>{
  const status=$("connectionStatus");
  status.textContent="Checking local engine…";
  try{
    const [health,control]=await Promise.all([
      localApi("/api/health"),localApi("/api/control")
    ]);
    if(!health.stockfish)status.textContent="Python is running, but Stockfish is unavailable. Restart the server after installing Stockfish 19.";
    else if(control.hidden)status.textContent="Stockfish is ready, but suggestions are paused. Click Resume suggestions.";
    else status.textContent="Python and Stockfish are ready. Open a fresh Chess.com bot game and make sure it is your turn.";
  }catch{
    status.textContent="Python server is unreachable. In the Linux Terminal, start it with .venv/bin/python server.py.";
  }
});

$("resumeSuggestions").addEventListener("click",()=>{
  const status=$("connectionStatus");
  status.textContent="Resuming…";
  chrome.storage.local.set({coachHidden:false},async()=>{
    if(chrome.runtime.lastError){
      status.textContent="Could not save the visible state: "+chrome.runtime.lastError.message;
      return;
    }
    try{
      await localApi("/api/control",{hidden:false});
      status.textContent="Suggestions resumed. Return to Chess.com and reload the tab if no text appears.";
    }catch{
      status.textContent="Extension unhidden, but Python is unreachable. Start .venv/bin/python server.py in Linux Terminal.";
    }
  });
});
