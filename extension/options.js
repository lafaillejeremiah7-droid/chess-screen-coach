"use strict";
const defaults={playerSide:"auto",thinkSeconds:1,strengthElo:1650,showDetails:false};
const allowed=[0.2,0.5,1,2];
const $=id=>document.getElementById(id);
chrome.storage.local.get(defaults,values=>{
  $("playerSide").value=["auto","w","b"].includes(values.playerSide)?values.playerSide:"auto";
  $("thinkSeconds").value=String(allowed.includes(values.thinkSeconds)?values.thinkSeconds:1);
  $("showDetails").checked=values.showDetails===true;
  $("fullStrength").checked=values.strengthElo==="full";
  $("strengthElo").value=String(Number.isInteger(values.strengthElo)&&values.strengthElo>=1320&&values.strengthElo<=3190?values.strengthElo:1650);
  $("strengthElo").disabled=$("fullStrength").checked;
  $("strengthValue").textContent=$("fullStrength").checked?"Full strength":$("strengthElo").value+" UCI Elo";
});
$("settings").addEventListener("submit",event=>{
  event.preventDefault();
  const seconds=Number($("thinkSeconds").value);
  if(!allowed.includes(seconds)){
    $("status").textContent="Invalid analysis time.";
    return;
  }
  const elo=$("fullStrength").checked?"full":Number($("strengthElo").value);
  if(elo!=="full"&&(!Number.isInteger(elo)||elo<1320||elo>3190)){
    $("status").textContent="Invalid practice Elo.";
    return;
  }
  chrome.storage.local.set({
    strengthElo:elo,
    playerSide:$("playerSide").value,
    thinkSeconds:seconds,
    showDetails:$("showDetails").checked
  },()=>{
    $("status").textContent=chrome.runtime.lastError?
      "Settings could not be saved.":"Saved. Settings apply to open chess tabs.";
  });
});

$("strengthElo").addEventListener("input",()=>{
  $("strengthValue").textContent=$("strengthElo").value+" UCI Elo";
});
$("fullStrength").addEventListener("change",()=>{
  $("strengthElo").disabled=$("fullStrength").checked;
  $("strengthValue").textContent=$("fullStrength").checked?
    "Full strength":$("strengthElo").value+" UCI Elo";
});
