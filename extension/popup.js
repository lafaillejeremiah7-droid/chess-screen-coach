"use strict";
const $=id=>document.getElementById(id);
let tabId=null;
const allowed=url=>{
  try{
    const u=new URL(url);
    return u.protocol==="https:"&&(u.hostname==="www.chess.com"||u.hostname==="chess.com");
  }catch{return false;}
};
function report(main,detail){
  $("suggestion").textContent=main;
  $("detail").textContent=detail;
}
async function tab(){
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
  const item=tabs[0];
  if(!item||!allowed(item.url||""))throw Error("Open a Chess.com game in this Chrome window.");
  tabId=item.id;
  return item;
}
async function status(){
  try{
    const t=await tab();
    const response=await chrome.tabs.sendMessage(t.id,{action:"coachStatus"});
    if(!response?.injected)throw Error("Page script is not running.");
    if(response.hidden){
      report("Coach is paused","Click Resume to show it.");
    }else if(response.boardError){
      report("Board detection error",response.boardError);
    }else if(!response.boardFound){
      report("Extension loaded, but no board found","Open a Chess.com board or analysis page; the overlay will report status.");
    }else{
      report(response.status||"Extension loaded — waiting for analysis",
        "Page script and chessboard detected.");
    }
  }catch(error){
    report("Move suggestion unavailable",String(error?.message||error)+
      " Click Repair display or check Chess.com site access.");
  }
}
$("repair").addEventListener("click",async()=>{
  $("repair").disabled=true;
  try{
    await tab();
    report("Repairing page script…","Checking injection permissions.");
    const result=await chrome.runtime.sendMessage({action:"repairTab",tabId});
    if(!result?.ok)throw Error(result?.error||"Chrome did not confirm injection.");
    await status();
  }catch(error){report("Repair blocked",String(error?.message||error));}
  finally{$("repair").disabled=false;}
});
$("resync").addEventListener("click",async()=>{
  $("resync").disabled=true;
  try{
    const currentTab=await tab();
    const response=await chrome.tabs.sendMessage(currentTab.id,{action:"coachResync"});
    if(!response?.ok)throw Error(response?.error||"Page did not confirm resync.");
    report("Resyncing board…","Previous position cleared; reading the current board.");
  }catch(error){
    report("Resync failed",String(error?.message||error)+
      " Use Repair display if the page script is missing.");
  }finally{$("resync").disabled=false;}
});
$("resume").addEventListener("click",async()=>{
  try{
    await chrome.storage.local.set({coachHidden:false});
    await status();
  }catch(error){report("Resume failed",String(error?.message||error));}
});
$("refresh").addEventListener("click",()=>{void status();});
void status();
