import {build} from "esbuild";
import {cp,copyFile,mkdir,readFile,rm,stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const base=dirname(fileURLToPath(import.meta.url));
const root=resolve(base,"..");
const source=join(root,"extension");
const destination=join(root,"dist","extension");
const engineDir=join(destination,"engine");
const stockfish=join(base,"node_modules","stockfish");
const assets=[
  ["stockfish-19-lite-single.js","ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a"],
  ["stockfish-19-lite-single.wasm","ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de"]
];
await rm(destination,{recursive:true,force:true});
await mkdir(engineDir,{recursive:true});
await cp(source,destination,{recursive:true});
await build({
  entryPoints:[join(base,"engine-host.mjs")],
  outfile:join(destination,"engine-host.js"),
  bundle:true,platform:"browser",format:"iife",target:"chrome120",minify:false,
  logLevel:"info"
});
for(const [filename,expected] of assets){
  const input=join(stockfish,"bin",filename);
  const bytes=await readFile(input);
  const actual=createHash("sha256").update(bytes).digest("hex");
  if(actual!==expected)throw Error(filename+" digest mismatch; do not distribute this build");
  await copyFile(input,join(engineDir,filename));
}
await copyFile(join(stockfish,"Copying.txt"),join(engineDir,"COPYING-GPL-3.0.txt"));
const manifest=JSON.parse(await readFile(join(destination,"manifest.json"),"utf8"));
if(manifest.version!=="0.7.0")throw Error("Unexpected extension version");
for(const filename of ["offscreen.html","engine-host.js","engine/stockfish-19-lite-single.js","engine/stockfish-19-lite-single.wasm"]){
  const info=await stat(join(destination,filename));
  if(!info.size)throw Error("Missing or empty engine asset: "+filename);
}
console.log("Standalone extension built: "+destination);
console.log("Install this folder directly with Chrome > Extensions > Load unpacked.");
