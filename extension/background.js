"use strict";
// Offscreen page owns the WebAssembly Worker; the MV3 service worker only relays requests.
let connecting=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(){
  if(connecting)return connecting;
  connecting=(async()=>{
    const url=chrome.runtime.getURL("offscreen.html");
    const contexts=await chrome.runtime.getContexts({
      contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[url]
    });
    if(!contexts.length)await chrome.offscreen.createDocument({
      url:"offscreen.html",reasons:["WORKERS"],
      justification:"Run bundled Full Stockfish 19."
    });
    for(let attempt=0;attempt<30;attempt++){
      try{
        const response=await chrome.runtime.sendMessage({
          target:"standalone-engine",action:"ping"
        });
        if(response?.ok&&response.ready)return;
      }catch{}
      await sleep(150);
    }
    throw Error("Stockfish host did not start. Reload the extension.");
  })();
  try{return await connecting;}finally{connecting=null;}
}
async function analyze(fen){
  await connect();
  const request=()=>chrome.runtime.sendMessage({
    target:"standalone-engine",action:"analyze",body:{fen}
  });
  try{return await request();}
  catch{
    try{await chrome.offscreen.closeDocument();}catch{}
    await connect();
    return request();
  }
}
function chessPage(raw){
  try{
    const url=new URL(raw);
    return url.protocol==="https:"&&
      (url.hostname==="www.chess.com"||url.hostname==="chess.com");
  }catch{return false;}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.action!=="analyze"||!chessPage(sender?.url||""))return false;
  if(typeof message.fen!=="string"||message.fen.length>120){
    respond({ok:false,error:"Invalid FEN"});return false;
  }
  void analyze(message.fen).then(respond).catch(error=>
    respond({ok:false,error:String(error?.message||error)}));
  return true;
});
