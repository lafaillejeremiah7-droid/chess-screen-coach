/* Current board only. No move-history tracking, settings, or bundled engine. */
(() => {
  "use strict";
  if (globalThis.__stockfishTerminalRunning) return;
  globalThis.__stockfishTerminalRunning = true;
  const board = globalThis.ChessCoachBoard;
  const overlay = document.createElement("div");
  overlay.id = "stockfish-terminal-move";
  Object.assign(overlay.style, {
    position: "fixed", top: "12px", right: "12px", zIndex: "2147483647",
    background: "#182633", color: "#fff", font: "500 11px system-ui",
    padding: "5px 8px", borderRadius: "6px", maxWidth: "260px",
    pointerEvents: "none", whiteSpace: "normal"
  });
  (document.body || document.documentElement).appendChild(overlay);
  let current = "", attempt = 0, epoch = 0, message = "";
  function show(value) {
    if (message !== value) {
      message = value;
      overlay.textContent = value;
    }
  }
  function scan() {
    if (document.hidden) return;
    let fen;
    try {
      const snapshot = board.snapshot(document);
      if (!snapshot) throw Error("Waiting for chessboard");
      fen = board.currentFen(snapshot).fen;
    } catch (error) {
      current = "";
      attempt = 0;
      epoch++;
      show(String(error?.message || error));
      return;
    }
    if (fen !== current) {
      current = fen;
      attempt = 0;
      epoch++;
      show("Analyzing current board…");
    }
    if (Date.now() - attempt < 3000 || attempt === Infinity) return;
    attempt = Date.now();
    const requested = current;
    const token = epoch;
    try {
      chrome.runtime.sendMessage({type: "analyze", fen: requested}, response => {
        if (token !== epoch || current !== requested) return;
        const problem = chrome.runtime.lastError;
        if (problem || !response?.ok) {
          show("Start terminal: bash start.sh");
          return;
        }
        attempt = Infinity;
        show(response.instruction || "No legal move");
      });
    } catch {
      show("Reload the extension and Chess.com tab");
    }
  }
  scan();
  setInterval(scan, 500);
  document.addEventListener("visibilitychange", scan);
})();
