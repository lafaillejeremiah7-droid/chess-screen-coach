/* Lightweight Chess.com DOM position reader; no pixels or screen capture.
   Multiple board layouts are supported, but uncertain positions are never guessed. */
(function(root){
  "use strict";
  const initial="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const kinds={wp:"P",wn:"N",wb:"B",wr:"R",wq:"Q",wk:"K",
    bp:"p",bn:"n",bb:"b",br:"r",bq:"q",bk:"k"};
  const names={pawn:"p",knight:"n",bishop:"b",rook:"r",queen:"q",king:"k"};
  const SELECTOR="wc-chess-board, chess-board, [data-cy='board'], [data-testid='chessboard'], .chessboard";

  function pieceFrom(raw){
    if(typeof raw!=="string")return null;
    const tokens=raw.trim().split(/\s+/);
    for(const token of tokens){
      const t=token.toLowerCase();
      if(Object.hasOwn(kinds,t))return kinds[t];
      const full=t.match(/^(white|black)[-_]?(pawn|knight|bishop|rook|queen|king)$/);
      if(full)return full[1]==="white"?names[full[2]].toUpperCase():names[full[2]];
    }
    return null;
  }

  function squareFrom(raw){
    if(typeof raw!=="string")return null;
    for(const token of raw.trim().split(/\s+/)){
      const m=token.match(/^square-([1-8])([1-8])$/);
      if(m)return m[1]+":"+m[2];
      const algebraic=token.match(/^square-([a-h])([1-8])$/);
      if(algebraic)return (algebraic[1].charCodeAt(0)-96)+":"+algebraic[2];
    }
    const algebraic=raw.trim().match(/^([a-h])([1-8])$/);
    if(algebraic)return (algebraic[1].charCodeAt(0)-96)+":"+algebraic[2];
    const digits=raw.trim().match(/^([1-8])([1-8])$/);
    if(digits)return digits[1]+":"+digits[2];
    return null;
  }

  function encode(cells){
    if([...cells.values()].filter(p=>p==="K").length!==1||
       [...cells.values()].filter(p=>p==="k").length!==1)
      throw Error("Could not identify both kings.");
    if(cells.size>32)throw Error("Too many pieces on board.");
    const ranks=[];
    for(let rank=8;rank>=1;rank--){
      let text="",empty=0;
      for(let file=1;file<=8;file++){
        const piece=cells.get(file+":"+rank);
        if(!piece){empty++;continue;}
        if(empty){text+=empty;empty=0;}
        text+=piece;
      }
      if(empty)text+=empty;
      ranks.push(text);
    }
    return ranks.join("/");
  }

  function put(cells,piece,square){
    if(!piece||!square)return;
    if(cells.has(square))throw Error("Overlapping pieces; wait for animation to finish.");
    cells.set(square,piece);
  }

  function placementFromClasses(classNames){
    const cells=new Map();
    for(const raw of classNames){
      put(cells,pieceFrom(raw),squareFrom(raw));
    }
    return encode(cells);
  }

  function placementFromNodes(nodes){
    const cells=new Map();
    for(const node of nodes){
      const cls=node.getAttribute?.("class")||"";
      const piece=pieceFrom(node.getAttribute?.("data-piece")||"")||pieceFrom(cls);
      let square=squareFrom(node.getAttribute?.("data-square")||"")||squareFrom(cls);
      if(!square){
        const parent=node.closest?.("[data-square]");
        square=squareFrom(parent?.getAttribute?.("data-square")||"");
      }
      put(cells,piece,square);
    }
    return encode(cells);
  }

  function visible(board){
    const r=board.getBoundingClientRect?.();
    if(!r||r.width<120||r.height<120)return 0;
    const ratio=r.width/r.height;
    if(ratio<0.7||ratio>1.4)return 0;
    return r.width*r.height;
  }

  function findBoard(doc){
    const boards=[...doc.querySelectorAll(SELECTOR)];
    // Largest visible board wins; avoid selecting smaller preview boards.
    return boards.filter(b=>visible(b)&&b.querySelectorAll?.(".piece,[data-piece]").length>=2)
      .sort((a,b)=>visible(b)-visible(a))[0]||null;
  }

  function orientation(board){
    const classes=board.classList;
    const tag=(board.getAttribute?.("data-orientation")||"").toLowerCase();
    return tag==="black"||classes?.contains?.("flipped")||
      classes?.contains?.("orientation-black")||classes?.contains?.("board-flipped")?"b":"w";
  }

  function declaredPlayerColor(board){
    for(const name of ["data-player-color","data-player-side","data-user-color"]){
      const declared=(board.getAttribute?.(name)||"").toLowerCase();
      if(declared==="white"||declared==="w")return "w";
      if(declared==="black"||declared==="b")return "b";
    }
    return null;
  }


  // The visible board is authoritative. Do not consult move lists, past
  // suggestions or cached piece positions when preparing a current FEN.
  const color=value=>{
    const text=String(value||"").trim().toLowerCase();
    return text==="w"||text==="white"?"w":text==="b"||text==="black"?"b":null;
  };
  function currentTurn(board){
    for(const attr of ["data-side-to-move","data-color-to-move","data-active-color",
      "data-turn","data-to-move","turn"]){
      const turn=color(board.getAttribute?.(attr));
      if(turn)return turn;
    }
    return null;
  }

  // Chess.com has used different clock layouts. Only an explicitly active
  // clock with a verifiable color is evidence of whose turn it is.
  function clockClasses(node){
    const text=typeof node?.className==="string"?node.className:
      String(node?.getAttribute?.("class")||"");
    return " "+text.toLowerCase()+" ";
  }
  const hasClass=(node,name)=>
    !!node?.classList?.contains?.(name)||
    clockClasses(node).split(/\s+/).includes(name);
  function explicitClockColor(node){
    for(const attr of ["data-color","data-player-color","data-side","data-clock-color"]){
      const c=color(node?.getAttribute?.(attr));
      if(c)return c;
    }
    for(const cls of ["clock-white","white-clock","clock-black","black-clock"]){
      if(hasClass(node,cls))return cls.includes("white")?"w":"b";
    }
    return null;
  }
  function declaredBottomColor(board){
    const explicit=color(board?.getAttribute?.("data-orientation")||
      board?.getAttribute?.("orientation"));
    if(explicit)return explicit;
    if(board?.classList?.contains?.("flipped")||
       board?.classList?.contains?.("orientation-black")||
       board?.classList?.contains?.("board-flipped"))return "b";
    // No declaration: orientation() displays a default but may be wrong.
    return null;
  }
  function clockColor(clock,board){
    const direct=explicitClockColor(clock);
    if(direct)return direct;
    const parent=clock?.closest?.(".clock-white,.clock-black");
    const parentColor=explicitClockColor(parent);
    if(parentColor)return parentColor;
    const bottom=declaredBottomColor(board);
    if(!bottom)return null;
    if(hasClass(clock,"clock-bottom"))return bottom;
    if(hasClass(clock,"clock-top"))return bottom==="w"?"b":"w";
    const layout=clock?.closest?.(".clock-top,.clock-bottom");
    if(hasClass(layout,"clock-bottom"))return bottom;
    if(hasClass(layout,"clock-top"))return bottom==="w"?"b":"w";
    return null;
  }
  function activeClock(clock){
    for(const name of ["clock-player-turn","player-turn","clock-running",
      "clock-active","active-clock"]){
      if(hasClass(clock,name))return true;
    }
    for(const attr of ["data-active","data-running","data-is-active"]){
      if(clock?.getAttribute?.(attr)==="true")return true;
    }
    return clock?.getAttribute?.("data-state")==="running";
  }
  function readClockTurn(doc,board){
    let nodes=[];
    try{
      // Prefer the current board's layout over any other clock/widgets.
      const layout=board?.closest?.(
        "#board-layout-main,.board-layout-main,.board-layout-component,[data-cy='board-layout']")||doc;
      nodes=[...layout.querySelectorAll(
        ".clock-component,[data-cy='clock-component'],.clock-bottom,.clock-top")];
    }catch{return {turn:null,conflict:false};}
    const active=new Set();
    let ambiguous=false;
    const seen=new Set();
    for(const raw of nodes){
      const clock=raw?.closest?.(".clock-component")||raw;
      // Some page versions put the active marker on a clock child.
      if(!activeClock(clock)&&!activeClock(raw))continue;
      if(seen.has(clock))continue;
      seen.add(clock);
      const rect=clock?.getBoundingClientRect?.();
      if(rect&&(rect.width<2||rect.height<2))continue;
      const c=clockColor(clock,board)||clockColor(raw,board);
      if(c)active.add(c);
      else ambiguous=true;
    }
    if(active.size>1)return {turn:null,conflict:true};
    if(active.size===1&&!ambiguous)return {turn:[...active][0],conflict:false};
    return {turn:null,conflict:false};
  }
  function indicatorTurn(doc){
    let nodes=[];
    try{nodes=[...doc.querySelectorAll(
      "[data-cy='turn-indicator'],[data-testid='turn-indicator']")];}
    catch{return {turn:null,conflict:false};}
    const detected=new Set();
    for(const node of nodes){
      const declared=color(node?.getAttribute?.("data-color")||
        node?.getAttribute?.("data-turn"));
      const label=String(node?.getAttribute?.("aria-label")||
        node?.textContent||"").trim().toLowerCase();
      const matched=label.match(/^(white|black)\s+(?:to move|to play|turn)\b/);
      const c=declared||(matched?.[1]==="white"?"w":
        matched?.[1]==="black"?"b":null);
      if(c)detected.add(c);
    }
    return {turn:detected.size===1?[...detected][0]:null,
      conflict:detected.size>1};
  }
  function ruleMetadata(board){
    const raw=board.getAttribute?.("data-castling-rights");
    const castling=typeof raw==="string"&&/^(?:-|K?Q?k?q?)$/.test(raw)&&raw.length>0
      ?raw:null;
    const ep=board.getAttribute?.("data-en-passant")||board.getAttribute?.("data-ep-square");
    const enPassant=typeof ep==="string"&&/^(?:-|[a-h][36])$/.test(ep)?ep:null;
    return {castling,enPassant};
  }
  function snapshot(doc){
    const board=findBoard(doc);
    if(!board)return null;
    const nodes=[...board.querySelectorAll(".piece,[data-piece]")];
    const placement=placementFromNodes(nodes);
    const bottomColor=orientation(board);
    const candidate=board.getAttribute?.("data-fen")||board.getAttribute?.("fen")||"";
    const parts=candidate.trim().split(/\s+/);
    // A FEN is useful only if its pieces agree with what is on screen NOW.
    const fen=parts.length===6&&parts[0]===placement&&/^[wb]$/.test(parts[1])?
      parts.join(" "):null;
    const rules=ruleMetadata(board);
    const clues=[
      {turn:fen?parts[1]:null,source:"fen"},
      {turn:currentTurn(board),source:"board"},
      {...readClockTurn(doc,board),source:"clock"},
      {...indicatorTurn(doc),source:"indicator"}
    ];
    const verified=new Set(clues.filter(c=>c.turn).map(c=>c.turn));
    const turnConflict=verified.size>1||clues.some(c=>c.conflict);
    const primary=clues.find(c=>c.turn);
    return {board,placement,bottomColor,myColor:bottomColor,
      playerColor:declaredPlayerColor(board),fen,
      turn:turnConflict?null:primary?.turn||null,
      turnSource:turnConflict?"conflict":primary?.source||"none",
      turnConflict,
      castling:rules.castling,enPassant:rules.enPassant};
  }
  function currentFen(snapshot){
    if(snapshot.turnConflict)throw Error("Turn indicators disagree; waiting for synchronization.");
    if(!snapshot.turn)throw Error("Turn unknown — waiting for active clock or turn indicator.");
    if(snapshot.fen)return {fen:snapshot.fen,turnVerified:true,rulesVerified:true};
    const castling=snapshot.castling||"-";
    const enPassant=snapshot.enPassant||"-";
    // Unknown special-move rights must not be invented from piece locations.
    return {fen:snapshot.placement+" "+snapshot.turn+" "+castling+" "+enPassant+" 0 1",
      turnVerified:true,turnSource:snapshot.turnSource||"unknown",
      rulesVerified:snapshot.castling!==null&&snapshot.enPassant!==null};
  }

  root.ChessCoachBoard={placementFromClasses,placementFromNodes,findBoard,snapshot,
    currentFen,initial};
})(globalThis);
