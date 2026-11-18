"use strict";
const ENDPOINT = "http://127.0.0.1:8765/analyze";
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let host;
  try { host = new URL(sender.url).hostname; } catch { return false; }
  if ((host !== "www.chess.com" && host !== "chess.com") ||
      message?.type !== "analyze" || typeof message.fen !== "string") return false;
  fetch(ENDPOINT, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({fen: message.fen})
  }).then(async response => {
    const body = await response.json();
    reply(response.ok ? {ok: true, ...body} :
      {ok: false, error: body.error || "Stockfish error"});
  }).catch(error => reply({ok: false, error: String(error?.message || error)}));
  return true;
});
