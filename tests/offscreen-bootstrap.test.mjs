import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../extension/offscreen-bootstrap.js",import.meta.url),"utf8");
const offscreenHtml=readFileSync(new URL("../extension/offscreen.html",import.meta.url),"utf8");

function setup(){
  let listener;
  const events={};
  const sandbox={
    chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},
    addEventListener(name,fn){events[name]=fn;}
  };
  vm.runInNewContext(source,sandbox);
  const ping=()=>{
    let response;
    assert.equal(listener({target:"standalone-engine",action:"ping"},null,r=>{response=r;}),false);
    return response;
  };
  return {ping,events,sandbox};
}
test("bootstrap listener is registered before the full engine bundle",()=>{
  assert.match(offscreenHtml,/src="offscreen-bootstrap\.js"/);
  assert.match(offscreenHtml,/src="engine-host\.js"/);
  assert.ok(offscreenHtml.indexOf("offscreen-bootstrap.js")<offscreenHtml.indexOf("engine-host.js"));
  const h=setup(),r=h.ping();
  assert.equal(r.ok,true);
  assert.equal(r.ready,false);
  assert.match(r.error,/loading/i);
});
test("bootstrap reports a JavaScript exception instead of missing receiving end",()=>{
  const h=setup();
  h.events.error({filename:"chrome-extension://id/engine-host.js",message:"SyntaxError: parse error"});
  const r=h.ping();
  assert.equal(r.ready,false);
  assert.equal(r.fatal,true);
  assert.match(r.error,/SyntaxError/);
});
test("bootstrap returns ready only after engine host finished listener registration",()=>{
  const h=setup();
  assert.equal(h.ping().ready,false);
  h.sandbox.__chessEngineBoot.ready();
  assert.equal(h.ping().ready,true);
  assert.equal(h.ping().fatal,false);
});
test("bootstrap ignores errors unrelated to loading engine host script",()=>{
  const h=setup();
  h.events.error({filename:"https://www.chess.com/something.js",message:"Unrelated error"});
  assert.equal(h.ping().fatal,false);
});
