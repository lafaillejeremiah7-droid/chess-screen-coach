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
// createDocument() does not prove that engine-host.js has registered its
// listener. Chrome can create the document before its script is ready.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let connectingEngine=null,restartingEngine=null;
const unreachable=error=>/Receiving end does not exist|Could not establish connection|message port closed|message channel closed/i
  .test(String(error?.message||error));

async function confirmEngineHost(){
  let last=null;
  for(let attempt=0;attempt<20;attempt++){
    try{
      // PING never starts the large WASM engine. It only confirms that the
      // extension-owned offscreen script loaded and registered onMessage.
      const result=await chrome.runtime.sendMessage({
        target:"standalone-engine",action:"ping"
      });
      if(result?.ok===true&&result?.ready===true)return;
      if(result?.fatal===true)
        throw Error("Engine host JavaScript failed to load: "+(result.error||"unknown error"));
      last=Error(result?.error||"Offscreen script did not acknowledge the connection");
    }catch(error){last=error;}
    if(attempt<19)await pause(200);
  }
  throw Error("The offscreen engine script did not start: "+
    String(last?.message||last||"No receiving context")+
    ". Open chrome://extensions, select this extension and check Errors.");
}
async function connectEngineHost(){
  if(connectingEngine)return connectingEngine;
  connectingEngine=(async()=>{
    await ensureOffscreen();
    try{
      await confirmEngineHost();
    }catch(initialError){
      // A Chrome crash or interrupted extension update can leave an offscreen
      // document present without a working message listener. Recreate it once.
      try{await chrome.offscreen.closeDocument();}
      catch(error){
        throw Error("Could not reset stalled offscreen engine: "+
          String(error?.message||error)+". Original failure: "+
          String(initialError?.message||initialError));
      }
      await ensureOffscreen();
      await confirmEngineHost();
    }
  })();
  try{return await connectingEngine;}finally{connectingEngine=null;}
}
async function restartEngineHost(){
  if(restartingEngine)return restartingEngine;
  restartingEngine=(async()=>{
    try{await chrome.offscreen.closeDocument();}catch{}
    await connectEngineHost();
  })();
  try{return await restartingEngine;}finally{restartingEngine=null;}
}
async function relayEngine(action,body){
  // Only extension-owned offscreen.html receives this targeted message.
  const response=await chrome.runtime.sendMessage({
    target:"standalone-engine",action,body
  });
  if(!response||typeof response.ok!=="boolean")
    throw Error("Offscreen engine returned no response. Check extension Errors.");
  return response;
}
async function engineRequest(action,body){
  await connectEngineHost();
  try{return await relayEngine(action,body);}
  catch(error){
    if(!unreachable(error))throw error;
    // The host disappeared after the ping (e.g. a tab/worker crash).
    // Recreate once and report a useful failure instead of silently looping.
    await restartEngineHost();
    return await relayEngine(action,body);
  }
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
  if(!message||!["analyze","health"].includes(message.action)||
     (!fromChess&&!(fromExtension&&message.action==="health")))
    return false;
  const action=message.action;
  const body=action==="analyze"?
    {fen:message.fen,seconds:message.seconds,elo:message.elo}:{};
  const valid=action==="health"||
    (typeof body.fen==="string"&&body.fen.length<=120&&
      (body.seconds===undefined||(typeof body.seconds==="number"&&Number.isFinite(body.seconds)&&
        body.seconds>=0.1&&body.seconds<=120))&&
      (body.elo===undefined||body.elo==="full"||
        (Number.isInteger(body.elo)&&body.elo>=1320&&body.elo<=3190)));
  if(!valid){sendResponse({ok:false,status:400,error:"Invalid chess position"});return false;}
  void engineRequest(action,body).then(sendResponse).catch(error=>{
    sendResponse({ok:false,error:"Standalone Stockfish unavailable: "+
      String(error?.message||error)+". Use the packaged extension ZIP from GitHub Actions."});
  });
  return true;
});
