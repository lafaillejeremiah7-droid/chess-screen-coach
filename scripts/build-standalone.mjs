/* Produce a self-contained unpacked Chrome extension.
   Binary Stockfish assets are copied at build time, never loaded remotely. */
import {build} from "esbuild";
import {cpSync,copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
const root=resolve(".");
const output=join(root,"dist","chess-screen-coach-standalone");
const source=join(root,"extension");
const standalone=join(root,"standalone");
const version="0.7.0";
rmSync(output,{recursive:true,force:true});
mkdirSync(output,{recursive:true});
cpSync(source,output,{recursive:true});
const copy=(from,to)=>copyFileSync(join(standalone,from),join(output,to));
copy("background.js","background.js");
copy("offscreen.html","offscreen.html");

const manifest=JSON.parse(readFileSync(join(output,"manifest.json"),"utf8"));
manifest.name="Chess Screen Coach — Standalone Stockfish 19";
manifest.description="Offline, Chrome-only chess coach with bundled Stockfish 19 Lite WASM. No Python or Terminal.";
manifest.version=version;
manifest.minimum_chrome_version="116";
manifest.permissions=[...new Set([...manifest.permissions,"offscreen"])];
manifest.host_permissions=manifest.host_permissions.filter(x=>!x.startsWith("http://127.0.0.1")&&!x.startsWith("http://localhost"));
manifest.content_security_policy={
  extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
};
writeFileSync(join(output,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");

await build({
  entryPoints:[join(standalone,"offscreen-engine.js")],
  outfile:join(output,"offscreen-engine.js"),
  bundle:true,format:"iife",platform:"browser",target:["chrome116"],
  logLevel:"warning"
});
const stockfish=join(root,"node_modules","stockfish");
const engine=join(output,"engine");
mkdirSync(engine,{recursive:true});
for(const filename of ["stockfish-19-lite-single.js","stockfish-19-lite-single.wasm"]){
  const src=join(stockfish,"bin",filename);
  if(!existsSync(src))throw Error("Missing pinned Stockfish 19 engine asset: "+src);
  copyFileSync(src,join(engine,filename));
  if(statSync(join(engine,filename)).size<1000)
    throw Error("Engine asset unexpectedly small: "+filename);
}
let licenseFile=null;
for(const filename of ["Copying.txt","COPYING.txt","LICENSE","LICENSE.txt","Copying","COPYING"]){
  if(existsSync(join(stockfish,filename))){licenseFile=join(stockfish,filename);break;}
}
if(!licenseFile)throw Error("Stockfish GPL license text missing from installed npm package");
copyFileSync(licenseFile,join(engine,"STOCKFISH-LICENSE.txt"));
writeFileSync(join(engine,"SOURCE.txt"),
  "Stockfish.js version 19.0.1, GPL-3.0. Unmodified lite single-threaded WASM.\n"+
  "Source code: https://github.com/nmrugg/stockfish.js/tree/v19.0.1\n"+
  "Stockfish upstream: https://github.com/official-stockfish/Stockfish\n");
const options=join(output,"options.js");
let settings=readFileSync(options,"utf8");
const apiStart=settings.indexOf("async function localApi(path,body){");
const apiEnd=settings.indexOf('$("checkEngine").addEventListener',apiStart);
if(apiStart<0||apiEnd<0)throw Error("Options local API section not found");
settings=settings.slice(0,apiStart)+`async function localApi(path,body){
  const action=path==="/api/health"?"health":path==="/api/control"?"control":null;
  if(!action)throw Error("Unknown offline engine API");
  const result=await chrome.runtime.sendMessage({action:"standaloneApi",engineAction:action,body});
  if(!result?.ok)throw Error(result?.error||"Offline engine unavailable");
  return result;
}

`+settings.slice(apiEnd);
settings=settings.replace("Checking local engine…","Loading bundled Stockfish 19…")
  .replace("Python is running, but Stockfish is unavailable. Restart the server after installing Stockfish 19.","Bundled Stockfish 19 failed to initialize. Reinstall the complete standalone extension ZIP.")
  .replace("Python and Stockfish are ready. Open a fresh Chess.com bot game and make sure it is your turn.","Standalone Stockfish 19 is ready. No Terminal or Python required. Open a Chess.com bot game.")
  .replace("Python server is unreachable. In the Linux Terminal, start it with .venv/bin/python server.py.","Bundled Stockfish failed. Reinstall the compiled standalone extension ZIP.")
  .replace("Extension unhidden, but Python is unreachable. Start .venv/bin/python server.py in Linux Terminal.","Extension unhidden, but bundled Stockfish initialization failed.");
writeFileSync(options,settings);
const optionsHtml=join(output,"options.html");
let optionsDoc=readFileSync(optionsHtml,"utf8");
optionsDoc=optionsDoc.replace("Check connection","Check built-in engine")
  .replace("check the local server and resume the overlay","check the built-in Stockfish engine and resume the overlay")
  .replace("If no instruction appears, check the local server","If no instruction appears, check the bundled engine");
writeFileSync(optionsHtml,optionsDoc);
const popup=join(output,"popup.js");
let popupSource=readFileSync(popup,"utf8");
const from=`    const response=await fetch("http://127.0.0.1:8765/api/control",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hidden:false})
    });`;
const to=`    const response=await chrome.runtime.sendMessage({
      action:"standaloneApi",engineAction:"control",body:{hidden:false}
    });`;
if(!popupSource.includes(from))throw Error("Popup Python control call not found");
popupSource=popupSource.replace(from,to)
  .replace('if(!response.ok)throw Error("Local Python server did not accept the resume request.");',
           'if(!response?.ok)throw Error(response?.error||"Bundled engine did not accept resume.");');
writeFileSync(popup,popupSource);
const popupHtml=join(output,"popup.html");
writeFileSync(popupHtml,readFileSync(popupHtml,"utf8")
  .replace("v0.6.10","v"+version));
const contentFile=join(output,"content.js");
writeFileSync(contentFile,readFileSync(contentFile,"utf8")
  .replaceAll("Python server unavailable","Bundled Stockfish unavailable")
  .replaceAll("Install Stockfish; restart the Python server.","Bundled engine failed. Reinstall the standalone extension ZIP.")
  .replaceAll("No response from local Python server","No response from bundled engine"));
console.log("STANDALONE BUILD COMPLETE",output);
console.log("Version",version,"Engine assets",
  ["stockfish-19-lite-single.js","stockfish-19-lite-single.wasm"].map(x=>statSync(join(engine,x)).size));
