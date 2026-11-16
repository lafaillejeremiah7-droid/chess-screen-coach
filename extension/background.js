/* Only contacts the owner's Python chess server on 127.0.0.1. */
"use strict";
function permitted(urlString){
  try{
    const url=new URL(urlString);
    return url.protocol==="https:"&&
      (url.hostname==="www.chess.com"||url.hostname==="chess.com");
  }catch{return false;}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!permitted(sender.url||"")||!message||!["track","analyze","health"].includes(message.action))
    return false;
  const path=message.action==="track"?"/api/track":message.action==="health"?"/api/health":"/api/analyze";
  const body=message.action==="track"
    ?{previous:message.previous,placement:message.placement}
    :{fen:message.fen};
  // Never accept URL inputs, cookies, credentials or screenshots.
  const valid=message.action==="health"||
    (message.action==="track"?
      typeof body.previous==="string"&&body.previous.length<=120&&
      typeof body.placement==="string"&&body.placement.length<=90:
      typeof body.fen==="string"&&body.fen.length<=120);
  if(!valid){sendResponse({ok:false,error:"Invalid chess position"});return false;}
  (async()=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),7000);
    try{
      const response=await fetch("http://127.0.0.1:8765"+path,{
        method:message.action==="health"?"GET":"POST",
        headers:message.action==="health"?{}:{"Content-Type":"application/json"},
        body:message.action==="health"?undefined:JSON.stringify(body),
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
