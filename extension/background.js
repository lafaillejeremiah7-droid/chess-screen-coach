/* Chess.com position bridge: self-contained Stockfish WASM, no Python server. */
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

// Offscreen documents can host a Web Worker; MV3 service workers cannot
// reliably own long-running WASM searches across suspension/restarts.
let creatingOffscreen=null;
async function ensureOffscreen(){
  if(creatingOffscreen)return creatingOffscreen;
  creatingOffscreen=(async()=>{
    // Chrome's hasDocument() is only available in much newer versions.
    // getContexts() works on Chrome 116+ and covers Chromebook installs.
    const url=chrome.runtime.getURL("offscreen.html");
    const contexts=await chrome.runtime.getContexts({
      contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[url]
    });
    if(contexts.length)return;
    await chrome.offscreen.createDocument({
      url:"offscreen.html",
      reasons:["WORKERS"],
      justification:"Run the bundled local Stockfish 19 WASM engine for chess analysis."
    });
  })();
  try{await creatingOffscreen;}
  finally{creatingOffscreen=null;}
}
async function engineRequest(action,body){
  await ensureOffscreen();
  // Only extension-owned offscreen.html receives this targeted message.
  const response=await chrome.runtime.sendMessage({target:"standalone-engine",action,body});
  if(!response||typeof response.ok!=="boolean")
    throw Error("Standalone engine did not respond. Install the complete built extension.");
  return response;
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.action==="repairTab"&&sender?.id===chrome.runtime.id){
    if(!Number.isInteger(message.tabId)||message.tabId<0){
      sendResponse({ok:false,error:"Invalid tab."});return false;
    }
    void ensureTab(message.tabId).then(sendResponse);
    return true;
  }
  const fromChess=permitted(sender?.url||"");
  const fromExtension=sender?.id===chrome.runtime.id &&
    typeof sender?.url==="string" &&
    sender.url.startsWith("chrome-extension://"+chrome.runtime.id+"/");
  if(!message||!["track","recover","analyze","health","control"].includes(message.action)||
     (!fromChess&&!(fromExtension&&["health","control"].includes(message.action))))
    return false;
  const action=message.action;
  let body={};
  if(action==="track")body={previous:message.previous,placement:message.placement};
  else if(action==="recover")body={moves:message.moves,placement:message.placement};
  else if(action==="analyze")body={fen:message.fen,seconds:message.seconds,elo:message.elo};
  else if(action==="control"&&typeof message.hidden==="boolean")body={hidden:message.hidden};
  // Offscreen documents have chrome.runtime messaging only, not
  // chrome.storage. Store the shared H-key pause state in this service
  // worker instead; the engine document handles search and rules only.
  if(action==="control"){
    void (async()=>{
      if(typeof message.hidden==="boolean")
        await chrome.storage.local.set({coachHidden:message.hidden});
      const saved=await chrome.storage.local.get({coachHidden:false});
      sendResponse({ok:true,hidden:saved.coachHidden===true});
    })().catch(error=>sendResponse({
      ok:false,error:"Could not update coach pause state: "+String(error?.message||error)
    }));
    return true;
  }
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
  if(!valid){sendResponse({ok:false,status:400,error:"Invalid chess position"});return false;}
  void engineRequest(action,body).then(sendResponse).catch(error=>{
    sendResponse({ok:false,error:"Standalone Stockfish unavailable: "+
      String(error?.message||error)+". Use the packaged extension ZIP from GitHub Actions."});
  });
  return true;
});
