/* Chess.com extension bridge: entirely local WASM engine, no Python server. */
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

const ENGINE_URL="offscreen.html";
let creating=null;
async function ensureHost(){
  if(await chrome.offscreen.hasDocument())return;
  if(!creating){
    creating=chrome.offscreen.createDocument({
      url:ENGINE_URL,
      reasons:["WORKERS"],
      justification:"Run bundled Stockfish 19 Lite WASM in a Web Worker without a terminal or server"
    }).finally(()=>{creating=null;});
  }
  await creating;
}
async function callEngine(action,body){
  await ensureHost();
  const response=await chrome.runtime.sendMessage({
    target:"standalone-engine",action,body:body||{}
  });
  if(!response||typeof response.ok!=="boolean")
    throw Error("Offline engine host did not return a valid response");
  return response;
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.target==="standalone-engine")return false;
  if(message?.action==="standaloneApi"&&sender?.id===chrome.runtime.id){
    if(!["health","control"].includes(message.engineAction)){
      sendResponse({ok:false,error:"Unsupported internal operation"});return false;
    }
    void callEngine(message.engineAction,message.body).then(sendResponse)
      .catch(error=>sendResponse({ok:false,error:String(error?.message||error)}));
    return true;
  }
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
    try{
      const result=await callEngine(action,body);
      sendResponse(result);
    }catch(error){
      sendResponse({ok:false,error:"Bundled Stockfish unavailable: "+
        String(error?.message||error)+
        ". Install the built standalone extension ZIP, not the source repository ZIP."});
    }
  })();
  return true;
});
