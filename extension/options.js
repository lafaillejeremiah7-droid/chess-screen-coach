"use strict";
const defaults={playerSide:"auto",thinkSeconds:1,engineElo:1400,showDetails:false};
const allowed=[0.2,0.5,1,2];
const $=id=>document.getElementById(id);
const validElo=value=>Number.isInteger(value)&&value>=1320&&value<=3190;
const strength=()=>$("fullStrength").checked?"full":Number($("engineElo").value);
const renderStrength=()=>{
  const full=$("fullStrength").checked;
  $("engineElo").disabled=full;
  $("engineEloValue").textContent=full?"Full strength":$("engineElo").value+" UCI Elo";
};
let saveTimer=null;
function saveStrength(){
  const engineElo=strength();
  if(engineElo!=="full"&&!validElo(engineElo))return;
  chrome.storage.local.set({engineElo},()=>{
    $("status").textContent=chrome.runtime.lastError?
      "Strength setting could not be saved.":"Main agent strength updated on open chess tabs.";
  });
}
$("engineElo").addEventListener("input",()=>{
  renderStrength();
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveStrength,200);
});
$("fullStrength").addEventListener("change",()=>{
  renderStrength();
  clearTimeout(saveTimer);
  saveStrength();
});
chrome.storage.local.get(defaults,values=>{
  $("playerSide").value=["auto","w","b"].includes(values.playerSide)?values.playerSide:"auto";
  $("thinkSeconds").value=String(allowed.includes(values.thinkSeconds)?values.thinkSeconds:1);
  $("fullStrength").checked=values.engineElo==="full";
  $("engineElo").value=String(validElo(values.engineElo)?values.engineElo:1400);
  renderStrength();
  $("showDetails").checked=values.showDetails===true;
});
$("settings").addEventListener("submit",event=>{
  event.preventDefault();
  const seconds=Number($("thinkSeconds").value);
  if(!allowed.includes(seconds)){
    $("status").textContent="Invalid analysis time.";
    return;
  }
  const engineElo=strength();
  if(engineElo!=="full"&&!validElo(engineElo)){
    $("status").textContent="Invalid UCI Elo.";
    return;
  }
  clearTimeout(saveTimer);
  chrome.storage.local.set({
    engineElo,
    playerSide:$("playerSide").value,
    thinkSeconds:seconds,
    showDetails:$("showDetails").checked
  },()=>{
    $("status").textContent=chrome.runtime.lastError?
      "Settings could not be saved.":"Saved. Settings apply to open chess tabs.";
  });
});
