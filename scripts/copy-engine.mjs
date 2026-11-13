import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bin=path.join(root,'node_modules','stockfish','bin');
const dest=path.join(root,'public','engine');
if(!fs.existsSync(bin)){
  console.error('Stockfish not installed. Run npm install first.');process.exit(1);
}
const files=fs.readdirSync(bin);
const js=files.filter(f=>/\.js$/.test(f)&&/stockfish/i.test(f)).sort((a,b)=>{
  const score=f=>(/lite-single/i.test(f)?100:/single/i.test(f)?75:/lite/i.test(f)?50:0)+(/\.js$/.test(f)?1:0);
  return score(b)-score(a);
});
let chosen=null;
for(const file of js){
  const stem=file.replace(/\.js$/,'');
  if(files.some(f=>f===stem+'.wasm')){chosen=file;break;}
}
if(!chosen){
  console.error('Could not locate a browser-compatible Stockfish JS + WASM pair in',bin,'\nAvailable:',files);
  process.exit(1);
}
const stem=chosen.slice(0,-3);
fs.mkdirSync(dest,{recursive:true});
for(const f of fs.readdirSync(dest))fs.rmSync(path.join(dest,f),{recursive:true,force:true});
for(const f of files.filter(f=>f===chosen||f.startsWith(stem+'.'))){
  fs.copyFileSync(path.join(bin,f),path.join(dest,f));
}
fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({worker:chosen,version:'stockfish'}));
console.log('Copied Stockfish engine:',chosen);