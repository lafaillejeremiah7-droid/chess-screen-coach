/* Minimal current-board observer. Never show analysis for a stale position. */
(() => {
  "use strict";
  if (globalThis.__stockfishTerminalRunning) return;
  globalThis.__stockfishTerminalRunning = true;
  const reader = globalThis.ChessCoachBoard;
  if (!reader) return;

  const overlay = document.createElement("div");
  overlay.id = "stockfish-terminal-move";
  Object.assign(overlay.style, {
    position: "fixed", top: "12px", right: "12px", zIndex: "2147483647",
    background: "#182633", color: "#fff", font: "500 11px system-ui",
    padding: "5px 8px", borderRadius: "6px", maxWidth: "260px",
    pointerEvents: "none", whiteSpace: "normal"
  });
  (document.body || document.documentElement).appendChild(overlay);

  let current = null, inFlight = null, settled = false, retryAfter = 0;
  let sequence = 0, message = "", observedBoard = null, observedLayout = null;
  let boardObserver = null, layoutObserver = null, scanTimer = null;

  const same = (a, b) => !!a && !!b &&
    a.board === b.board && a.fen === b.fen;

  function show(value) {
    if (message !== value) {
      message = value;
      overlay.textContent = value;
    }
  }
  function cancel() {
    if (!inFlight) return;
    inFlight = null;
    try {
      chrome.runtime.sendMessage({type: "cancel"}, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
  }
  function invalidate(reason) {
    if (current || inFlight || settled) {
      sequence++;
      cancel();
      current = null;
      settled = false;
      retryAfter = 0;
    }
    show(reason);
  }
  function schedule() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 75);
  }
  function watch(board) {
    const layout = board.closest?.(
      "#board-layout-main,.board-layout-main,.board-layout-component,[data-cy='board-layout']"
    ) || board.parentElement || null;
    if (observedBoard === board && observedLayout === layout) return;
    boardObserver?.disconnect();
    layoutObserver?.disconnect();
    observedBoard = board;
    observedLayout = layout;
    boardObserver = new MutationObserver(schedule);
    boardObserver.observe(board, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["class", "style", "data-piece", "data-square",
        "data-fen", "fen", "data-turn", "data-side-to-move",
        "data-active-color", "data-color-to-move", "data-to-move",
        "data-castling-rights", "data-en-passant", "data-ep-square"]
    });
    // Clock/turn indicators can change without changing a piece on the board.
    if (layout && layout !== board) {
      layoutObserver = new MutationObserver(schedule);
      layoutObserver.observe(layout, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ["class", "style", "data-active", "data-running",
          "data-is-active", "data-state", "data-turn", "data-color", "aria-label"]
      });
    }
  }
  function read() {
    const snapshot = reader.snapshot(document);
    if (!snapshot) throw Error("Waiting for chessboard");
    const fen = reader.currentFen(snapshot).fen;
    return {board: snapshot.board, fen};
  }
  function analyze(position) {
    const token = ++sequence;
    inFlight = {token, position};
    show("Analyzing current board…");
    try {
      chrome.runtime.sendMessage({type: "analyze", fen: position.fen}, response => {
        if (!inFlight || inFlight.token !== token || !same(current, position))
          return;
        const error = chrome.runtime.lastError;
        // The board can change between two polls while Stockfish is working.
        // Read it again immediately before rendering any move.
        if (document.hidden) {
          invalidate("Tab hidden — waiting");
          return;
        }
        let latest;
        try { latest = read(); }
        catch (problem) {
          invalidate(String(problem?.message || problem));
          return;
        }
        if (!same(latest, position)) {
          invalidate("Board changed — resynchronizing");
          scan();
          return;
        }
        inFlight = null;
        if (error || !response?.ok) {
          retryAfter = Date.now() + 2000;
          show("Stockfish unavailable — retrying");
          return;
        }
        settled = true;
        show(response.instruction || "No legal move");
      });
    } catch {
      inFlight = null;
      retryAfter = Date.now() + 2000;
      show("Reload the extension and Chess.com tab");
    }
  }
  function scan() {
    if (document.hidden) {
      invalidate("Tab hidden — waiting");
      return;
    }
    let position;
    try { position = read(); }
    catch (problem) {
      invalidate(String(problem?.message || problem));
      return;
    }
    watch(position.board);
    if (!same(current, position)) {
      sequence++;
      cancel();
      current = position;
      settled = false;
      retryAfter = 0;
      show("Board changed — resynchronizing");
    }
    if (!settled && !inFlight && Date.now() >= retryAfter)
      analyze(position);
  }
  // DOM events react quickly; the low-frequency scan recovers missed changes.
  scan();
  setInterval(scan, 300);
  document.addEventListener("visibilitychange", scan);
})();
