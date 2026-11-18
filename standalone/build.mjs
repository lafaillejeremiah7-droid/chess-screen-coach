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
  // Full NNUE, single-threaded so it works without cross-origin isolation.
  ["stockfish-19-single.js","8071dee87312f74805a859de933e1a1ef465579ab1a51fbd597388cdce9d444d"],
  ["stockfish-19-single.wasm","991bede2f253ebb08ff01fcc48270f4b9c8e66b12d5bd5f8d6f52eb3e3b3a740"]
];
const stockfishVersion=JSON.parse(await readFile(join(stockfish,"package.json"),"utf8")).version;
if(stockfishVersion!=="19.0.1")throw Error("Unexpected Stockfish.js version: "+stockfishVersion);
await rm(destination,{recursive:true,force:true});
await mkdir(engineDir,{recursive:true});
await cp(source,destination,{recursive:true});
await build({
  entryPoints:[join(base,"engine-host.mjs")],
  outfile:join(destination,"engine-host.js"),
  bundle:true,platform:"browser",format:"iife",target:"chrome116",minify:false,
  logLevel:"info"
});
for(const [filename,expected] of assets){
  const input=join(stockfish,"bin",filename);
  const bytes=await readFile(input);
  const actual=createHash("sha256").update(bytes).digest("hex");
  console.log("FULL_STOCKFISH_DIGEST",filename,actual,bytes.length);
  if(actual!==expected)throw Error(filename+" digest mismatch; do not distribute this build");
  // A lite neural network is only ~1 MB. Never silently package Lite.
  if(filename.endsWith(".wasm")&&bytes.length<30000000)
    throw Error("Full Stockfish neural network is missing; refusing a Lite-sized WASM");
  await copyFile(input,join(engineDir,filename));
}
await copyFile(join(stockfish,"Copying.txt"),join(engineDir,"COPYING-GPL-3.0.txt"));
const manifest=JSON.parse(await readFile(join(destination,"manifest.json"),"utf8"));
if(manifest.version!=="0.7.8")throw Error("Unexpected extension version");
for(const filename of ["offscreen.html","engine-host.js","engine/stockfish-19-single.js","engine/stockfish-19-single.wasm"]){
  const info=await stat(join(destination,filename));
  if(!info.size)throw Error("Missing or empty engine asset: "+filename);
}
console.log("Full Stockfish 19 standalone extension built: "+destination);
console.log("Install this folder directly with Chrome > Extensions > Load unpacked.");
