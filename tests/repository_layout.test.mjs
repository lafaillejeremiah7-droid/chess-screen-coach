import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const source=path=>readFileSync(new URL(path,root),'utf8');
const exists=path=>existsSync(new URL(path,root));

test('all local HTML scripts and stylesheets exist',()=>{
  for(const page of ['index.html','training.html','sparring.html']){
    const html=source(page);
    const assets=[...html.matchAll(/(?:src|href)="(\/src\/[^"]+)"/g)]
      .map(match=>match[1].slice(1));
    assert.ok(assets.length>=2,page+' has active script and stylesheet');
    for(const asset of assets)assert.ok(exists(asset),page+' references missing '+asset);
    assert.match(source('server.py'),new RegExp('/'+page.replace('.','\\.')));
  }
});

test('the extension manifest only references present assets',()=>{
  const manifest=JSON.parse(source('extension/manifest.json'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.host_permissions,['http://127.0.0.1/*']);
  for(const script of [manifest.background.service_worker,
                        manifest.options_page,
                        ...manifest.content_scripts.flatMap(item=>[...item.js,...item.css])])
    assert.ok(exists('extension/'+script),'Missing extension asset '+script);
});

test('Node is used only as a built-in test runner',()=>{
  const manifest=JSON.parse(source('package.json'));
  assert.equal(manifest.type,'module');
  assert.deepEqual(Object.keys(manifest.dependencies||{}),[]);
  assert.deepEqual(Object.keys(manifest.devDependencies||{}),[]);
  assert.deepEqual(Object.keys(manifest.scripts),['test']);
  assert.match(manifest.scripts.test,/node --test/);
});

test('core backend, position templates, training and experiment tools are retained',()=>{
  for(const path of ['server.py','sparring.py','training.py','public/templates/pieces.json',
                     'scripts/install_stockfish19.py','scripts/check_stockfish19_ready.py',
                     'scripts/compare_engines.py','scripts/audit_main_1400.py',
                     '.github/workflows/selfplay-million.yml']){
    assert.ok(exists(path),'Missing active or deliberately retained '+path);
  }
});
