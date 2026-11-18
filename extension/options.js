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
