import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stockfish=path.join(root,'node_modules','stockfish');
const dest=path.join(root,'public','engine');
const folders=['bin','src'].map(d=>path.join(stockfish,d)).filter(p=>fs.existsSync(p));
if(!folders.length){
  console.error('Stockfish package not installed or missing its engine files. Run npm install.');
  process.exit(1);
}
const score=f=>/lite-single/i.test(f)?100:/single/i.test(f)?70:/lite/i.test(f)?40:0;
let chosen=null,folder=null;
for(const directory of folders){
  const all=fs.readdirSync(directory);
  for(const file of all.filter(f=>/^stockfish.*\.js$/i.test(f)).sort((a,b)=>score(b)-score(a))){
    const stem=file.slice(0,-3);
    if(all.includes(stem+'.wasm')){chosen=file;folder=directory;break;}
  }
  if(chosen)break;
}
if(!chosen){
  console.error('No matching Stockfish JS/WASM engine pair found in',folders.join(', '));
  process.exit(1);
}
const stem=chosen.slice(0,-3);
fs.mkdirSync(dest,{recursive:true});
for(const item of fs.readdirSync(dest))fs.rmSync(path.join(dest,item),{recursive:true,force:true});
for(const file of fs.readdirSync(folder).filter(f=>f===chosen||f===stem+'.wasm'||f.startsWith(stem+'.'))){
  fs.copyFileSync(path.join(folder,file),path.join(dest,file));
}
fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({worker:chosen,version:'stockfish'}));
console.log('Packaged browser Stockfish:',chosen,'from',path.relative(root,folder));
