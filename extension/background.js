"use strict";
const ENDPOINT = "http://127.0.0.1:8765/analyze";
const active = new Map();

function senderKey(sender) {
  return String(sender.tab?.id ?? sender.url) + ":" + String(sender.frameId ?? 0);
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let url;
  try { url = new URL(sender.url); } catch { return false; }
  if (url.protocol !== "https:" ||
      (url.hostname !== "www.chess.com" && url.hostname !== "chess.com"))
    return false;
  if (message?.type !== "analyze" && message?.type !== "cancel") return false;

  const key = senderKey(sender);
  const previous = active.get(key);
  if (previous) {
    active.delete(key);
    previous.abort();
  }
  if (message.type === "cancel") {
    reply({ok: true});
    return false;
  }
  if (typeof message.fen !== "string" || message.fen.length > 120) {
    reply({ok: false, error: "Invalid FEN"});
    return false;
  }

  const controller = new AbortController();
  active.set(key, controller);
  fetch(ENDPOINT, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({fen: message.fen}),
    signal: controller.signal
  }).then(async response => {
    const body = await response.json();
    reply(response.ok ? {ok: true, ...body} :
      {ok: false, error: body.error || "Stockfish error"});
  }).catch(error => {
    reply({ok: false, error: controller.signal.aborted ?
      "Superseded by current board" : String(error?.message || error)});
  }).finally(() => {
    if (active.get(key) === controller) active.delete(key);
  });
  return true;
});
