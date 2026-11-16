"use strict";
const defaults={playerSide:"auto",thinkSeconds:1,showDetails:false};
const allowed=[0.2,0.5,1,2];
const $=id=>document.getElementById(id);
chrome.storage.local.get(defaults,values=>{
  $("playerSide").value=["auto","w","b"].includes(values.playerSide)?values.playerSide:"auto";
  $("thinkSeconds").value=String(allowed.includes(values.thinkSeconds)?values.thinkSeconds:1);
  $("showDetails").checked=values.showDetails===true;
});
$("settings").addEventListener("submit",event=>{
  event.preventDefault();
  const seconds=Number($("thinkSeconds").value);
  if(!allowed.includes(seconds)){
    $("status").textContent="Invalid analysis time.";
    return;
  }
  chrome.storage.local.set({
    playerSide:$("playerSide").value,
    thinkSeconds:seconds,
    showDetails:$("showDetails").checked
  },()=>{
    $("status").textContent=chrome.runtime.lastError?
      "Settings could not be saved.":"Saved. Settings apply to open chess tabs.";
  });
});
