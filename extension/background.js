/* Chess.com position bridge: only contacts the user's local Python service. */
"use strict";
function permitted(urlString){
  try{
    const url=new URL(urlString);
    return url.protocol==="https:" &&
      (url.hostname==="www.chess.com" || url.hostname==="chess.com");
  }catch{return false;}
}
// Check the page script independently of the local Stockfish health endpoint.
// In MV3 a service worker can restart, so keep no essential in-memory state.
async function probeTab(tabId){
  try{
    const response=await chrome.tabs.sendMessage(tabId,{action:"coachStatus"});
    return response?.injected?response:null;
  }catch{return null;}
}

async function ensureTab(tabId){
  try{
    const tab=await chrome.tabs.get(tabId);
    if(!permitted(tab?.url||""))
      return {ok:false,error:"Open a normal HTTPS Chess.com tab first."};
    const existing=await probeTab(tabId);
    if(existing)return {ok:true,method:"already_loaded",...existing};
    // Recover from missed manifest injection after reload/extension upgrade.
    // Host permission must still be granted by the user in Chrome.
    await chrome.scripting.executeScript({
      target:{tabId},files:["board.js","content.js"],world:"ISOLATED"
    });
    const repaired=await probeTab(tabId);
    if(!repaired)return {ok:false,error:"Scripts were injected but the page did not respond. Reload this Chess.com tab."};
    return {ok:true,method:"repaired",...repaired};
  }catch(error){
    return {ok:false,error:"Chrome blocked page injection: "+String(error?.message||error)+
      ". Check extension Site access for Chess.com."};
  }
}

const repairs=new Set();
async function recoverTab(tabId){
  if(repairs.has(tabId))return;
  repairs.add(tabId);
  try{await ensureTab(tabId);}
  finally{repairs.delete(tabId);}
}
chrome.tabs?.onUpdated?.addListener?.((tabId,changeInfo,tab)=>{
  if(changeInfo.status==="complete"&&permitted(tab?.url||""))
    void recoverTab(tabId);
});
chrome.tabs?.onActivated?.addListener?.(({tabId})=>{void recoverTab(tabId);});
chrome.runtime.onInstalled?.addListener?.(()=>{
  void chrome.tabs.query({url:["https://www.chess.com/*","https://chess.com/*"]})
    .then(tabs=>Promise.all(tabs.map(tab=>recoverTab(tab.id)))).catch(()=>{});
});

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.action==="repairTab"&&sender?.id===chrome.runtime.id){
    if(!Number.isInteger(message.tabId)||message.tabId<0){
      sendResponse({ok:false,error:"Invalid tab."});return false;
    }
    void ensureTab(message.tabId).then(sendResponse);
    return true;
  }
  if(!permitted(sender.url||"") || !message ||
     !["track","recover","analyze","health","control"].includes(message.action))
    return false;
  const action=message.action;
  const paths={track:"/api/track",recover:"/api/recover",analyze:"/api/analyze",
               health:"/api/health",control:"/api/control"};
  let body;
  if(action==="track") body={previous:message.previous,placement:message.placement};
  else if(action==="recover") body={moves:message.moves,placement:message.placement};
  else if(action==="analyze") body={fen:message.fen,seconds:message.seconds,elo:message.elo};
  else if(action==="control" && typeof message.hidden==="boolean")body={hidden:message.hidden};
  const valid=action==="health"||action==="control"||
    (action==="track"?typeof body.previous==="string"&&body.previous.length<=120&&
       typeof body.placement==="string"&&body.placement.length<=90:
     action==="recover"?Array.isArray(body.moves)&&body.moves.length<=400&&
       body.moves.every(x=>typeof x==="string"&&x.length<=14)&&
       typeof body.placement==="string"&&body.placement.length<=90:
     typeof body.fen==="string"&&body.fen.length<=120&&
       (body.seconds===undefined||[0.2,0.5,1,2].includes(body.seconds))&&
       (body.elo===undefined||body.elo==="full"||
        (Number.isInteger(body.elo)&&body.elo>=1320&&body.elo<=3190)));
  if(!valid){sendResponse({ok:false,error:"Invalid chess position"});return false;}
  (async()=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch("http://127.0.0.1:8765"+paths[action],{
        method:body===undefined?"GET":"POST",
        headers:body===undefined?{}:{"Content-Type":"application/json"},
        body:body===undefined?undefined:JSON.stringify(body),
        signal:controller.signal
      });
      const data=await response.json();
      sendResponse(response.ok?{ok:true,...data}:{ok:false,status:response.status,error:data.error||"Python error"});
    }catch(error){
      sendResponse({ok:false,error:"Python server unavailable. Start python3 server.py in Linux Terminal."});
    }finally{clearTimeout(timeout);}
  })();
  return true;
});
