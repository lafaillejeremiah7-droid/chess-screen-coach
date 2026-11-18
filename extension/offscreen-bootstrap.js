/* Lightweight startup probe. This must load before engine-host.js so a
   script parse/load error is distinguishable from missing extension messaging. */
"use strict";
(()=>{
  const state={ready:false,fatal:false,error:"Engine host script is still loading."};
  function diagnose(error){
    state.fatal=true;
    state.error=String(error?.message||error||"Unknown engine host startup failure").slice(0,360);
  }
  globalThis.__chessEngineBoot={
    ready(){state.ready=true;state.fatal=false;state.error="";}
  };
  globalThis.addEventListener("error",event=>{
    const src=String(event?.filename||event?.target?.src||"");
    // Capture engine-host.js load errors and exceptions without confusing
    // a later WebAssembly Worker failure with host registration failure.
    if(src.includes("engine-host.js"))diagnose(event?.message||"Cannot load "+src);
  },true);
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message?.target!=="standalone-engine"||message.action!=="ping")return false;
    respond({ok:true,ready:state.ready,fatal:state.fatal,error:state.error,
      host:"offscreen-bootstrap"});
    return false;
  });
})();
