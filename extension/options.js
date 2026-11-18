"use strict";
const defaults={playerSide:"auto",thinkSeconds:1,strengthElo:1400,fullStrength:true,showDetails:false};
const validTime=seconds=>Number.isFinite(seconds)&&seconds>=0.1&&seconds<=120;
const $=id=>document.getElementById(id);
chrome.storage.local.get(defaults,values=>{
  $("playerSide").value=["auto","w","b"].includes(values.playerSide)?values.playerSide:"auto";
  $("thinkSeconds").value=String(validTime(values.thinkSeconds)?values.thinkSeconds:1);
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
  if(!validTime(seconds)){
    $("status").textContent="Enter an analysis time between 0.1 and 120 seconds.";
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

// Standalone Stockfish runs in an extension-owned offscreen document.
async function localEngine(action,body={}){
  const response=await chrome.runtime.sendMessage({action,...body});
  if(!response?.ok)throw Error(response?.error||"Bundled Stockfish engine unavailable");
  return response;
}
$("checkEngine").addEventListener("click",async()=>{
  const status=$("connectionStatus");
  status.textContent="Starting bundled Stockfish WASM…";
  try{
    const [health,control]=await Promise.all([
      localEngine("health"),localEngine("control")
    ]);
    if(!health.stockfish)status.textContent="Bundled Stockfish is not available. Install the standalone build ZIP.";
    else if(control.hidden)status.textContent="Stockfish is ready, but suggestions are paused. Click Resume suggestions.";
    else status.textContent="Standalone Stockfish is ready. No Python or terminal needed. Open a Chess.com bot game.";
  }catch(error){
    status.textContent="Standalone engine unavailable: "+String(error?.message||error)+
      ". Install the complete built extension ZIP from GitHub Actions.";
  }
});
$("resumeSuggestions").addEventListener("click",()=>{
  const status=$("connectionStatus");
  status.textContent="Resuming…";
  chrome.storage.local.set({coachHidden:false},async()=>{
    if(chrome.runtime.lastError){
      status.textContent="Could not save visible state: "+chrome.runtime.lastError.message;
      return;
    }
    try{
      await localEngine("control",{hidden:false});
      status.textContent="Suggestions resumed. Return to Chess.com.";
    }catch(error){
      status.textContent="Could not resume bundled engine: "+String(error?.message||error);
    }
  });
});

const chessTabPatterns=["https://www.chess.com/*","https://chess.com/*"];
function findChessTab(callback){
  chrome.tabs.query({url:chessTabPatterns},tabs=>{
    const error=chrome.runtime.lastError;
    if(error){
      $("pageStatus").textContent="Chrome could not inspect Chess.com tabs: "+error.message;
      return;
    }
    const ordered=(tabs||[]).slice().sort((a,b)=>
      Number(b.active)-Number(a.active)||(b.lastAccessed||0)-(a.lastAccessed||0));
    if(!ordered.length){
      $("pageStatus").textContent="No accessible Chess.com tab. Open Chess.com and allow Chess Study Coach site access in chrome://extensions → Details.";
      return;
    }
    callback(ordered[0]);
  });
}

$("checkChessPage").addEventListener("click",()=>{
  $("pageStatus").textContent="Checking whether the extension loaded in Chess.com…";
  findChessTab(tab=>{
    chrome.tabs.sendMessage(tab.id,{action:"coachStatus"},response=>{
      if(chrome.runtime.lastError||!response?.injected){
        $("pageStatus").textContent="Chrome did not inject the coach into this Chess.com tab. Allow its site access, then click Reload Chess.com tab.";
        return;
      }
      if(response.hidden||!response.visible){
        $("pageStatus").textContent="The page script is loaded but paused. Click Resume suggestions.";
      }else if(response.boardError){
        $("pageStatus").textContent="The page script is loaded, but board detection failed: "+response.boardError;
      }else if(!response.boardFound){
        $("pageStatus").textContent="The page script is loaded, but no supported chessboard is detected. Open a game and check again.";
      }else{
        $("pageStatus").textContent="Extension loaded; board found. On-page status: "+(response.status||"No text currently shown");
      }
    });
  });
});

$("resyncChessPage").addEventListener("click",()=>{
  $("pageStatus").textContent="Requesting a fresh board read…";
  findChessTab(tab=>{
    chrome.tabs.sendMessage(tab.id,{action:"coachResync"},response=>{
      if(chrome.runtime.lastError){
        $("pageStatus").textContent="Resync failed: "+chrome.runtime.lastError.message+
          ". Try Repair page script first.";
      }else if(!response?.ok){
        $("pageStatus").textContent="Resync unavailable: "+
          (response?.error||"No response from the Chess.com page.");
      }else{
        $("pageStatus").textContent=response.queued
          ?"Board resync queued. Return to Chess.com to finish."
          :"Resync started. Return to the Chess.com tab to see the updated position.";
      }
    });
  });
});

$("reloadChessPage").addEventListener("click",()=>{
  $("pageStatus").textContent="Reloading a Chess.com tab…";
  findChessTab(tab=>{
    chrome.tabs.reload(tab.id,()=>{
      $("pageStatus").textContent=chrome.runtime.lastError?
        "Chrome could not reload that tab: "+chrome.runtime.lastError.message:
        "Chess.com tab reloaded. Return to it, then click Check Chess.com page.";
    });
  });
});

$("repairChessPage").addEventListener("click",()=>{
  $("pageStatus").textContent="Checking Chrome's permission to repair the Chess.com tab…";
  findChessTab(tab=>{
    chrome.runtime.sendMessage({action:"repairTab",tabId:tab.id},response=>{
      if(chrome.runtime.lastError||!response?.ok){
        $("pageStatus").textContent="Repair failed: "+
          (response?.error||chrome.runtime.lastError?.message||"No response")+
          ". Check Chrome's Site access and reload the tab.";
        return;
      }
      $("pageStatus").textContent="Page script running. "+
        (response.boardFound?"Board detected. ":"No chessboard detected. ")+
        (response.status||"Return to Chess.com to see the status banner.");
    });
  });
});
