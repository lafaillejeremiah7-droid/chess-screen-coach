/* Chess.com position bridge: only contacts the user's local Python service. */
"use strict";
function permitted(urlString){
  try{
    const url=new URL(urlString);
    return url.protocol==="https:" &&
      (url.hostname==="www.chess.com" || url.hostname==="chess.com");
  }catch{return false;}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
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
