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
    reply({ok: false, status: 400, error: "Invalid FEN"});
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
    let body;
    try { body = await response.json(); } catch {
      reply({ok: false, error: "Unexpected reply from local server on port 8765"});
      return;
    }
    reply(response.ok ? {ok: true, ...body} :
      {ok: false, status: response.status, error: body.error || "Stockfish error"});
  }).catch(() => {
    reply(controller.signal.aborted ? {ok: false, status: 409} :
      {ok: false, error: "Cannot reach the local engine. Run bash start.sh in the project terminal."});
  }).finally(() => {
    if (active.get(key) === controller) active.delete(key);
  });
  return true;
});
