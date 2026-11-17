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

  function visible(board,view){
    const r=board.getBoundingClientRect?.();
    if(!r||r.width<120||r.height<120)return 0;
    const ratio=r.width/r.height;
    if(ratio<0.7||ratio>1.4)return 0;
    // A large board outside the viewport must not outrank the actual
    // on-screen board. Test fixtures without geometry retain old behavior.
    if(view&&Number.isFinite(view.innerWidth)&&Number.isFinite(view.innerHeight)&&
       Number.isFinite(r.left)&&Number.isFinite(r.top)){
      const right=Number.isFinite(r.right)?r.right:r.left+r.width;
      const bottom=Number.isFinite(r.bottom)?r.bottom:r.top+r.height;
      const width=Math.max(0,Math.min(right,view.innerWidth)-Math.max(r.left,0));
      const height=Math.max(0,Math.min(bottom,view.innerHeight)-Math.max(r.top,0));
      return width*height;
    }
    return r.width*r.height;
  }

  function findBoard(doc){
    const boards=[...doc.querySelectorAll(SELECTOR)];
    // Prefer the largest VISIBLE board, not merely the largest DOM element.
    const view=doc.defaultView;
    return boards.filter(b=>visible(b,view)&&b.querySelectorAll?.(".piece,[data-piece]").length>=2)
      .sort((a,b)=>visible(b,view)-visible(a,view))[0]||null;
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


  function readMoveHistory(doc){
    // Prefer a complete, ordered list with explicit plies; never invent moves.
    for(const selector of ["[data-ply]",".vertical-move-list .node",".move-list .node",".move-text-component"]){
      let nodes;
      try{nodes=[...doc.querySelectorAll(selector)];}catch{continue;}
      if(!nodes.length||nodes.length>400)continue;
      if(selector==="[data-ply]"){
        const indexed=nodes.map(n=>({ply:Number(n.getAttribute?.("data-ply")),node:n}))
          .filter(x=>Number.isInteger(x.ply)&&x.ply>=1);
        if(indexed.length!==nodes.length)continue;
        indexed.sort((a,b)=>a.ply-b.ply);
        if(indexed[0].ply!==1||indexed.some((x,i)=>x.ply!==i+1))continue;
        nodes=indexed.map(x=>x.node);
      }
      const moves=[];
      for(const node of nodes){
        const raw=(node.textContent||node.innerText||"").trim();
        const value=raw.replace(/^\s*\d+\s*\.(?:\.\.)?\s*/,"").replace(/[!?]+/g,"").trim();
        if(!/^(?:[O0]-[O0](?:-[O0])?|[a-h][1-8][a-h][1-8][qrbn]?|[KQRBN]?[a-h1-8]{0,2}x?[a-h][1-8](?:=[QRBN])?)[+#]?$/.test(value)){
          moves.length=0;break;
        }
        moves.push(value.replace(/0/g,"O"));
      }
      if(moves.length>=1)return moves;
    }
    return [];
  }

  function snapshot(doc){
    const board=findBoard(doc);
    if(!board)return null;
    const nodes=[...board.querySelectorAll(".piece,[data-piece]")];
    const placement=placementFromNodes(nodes);
    const bottomColor=orientation(board);
    const candidate=board.getAttribute?.("data-fen")||board.getAttribute?.("fen")||"";
    const parts=candidate.trim().split(/\s+/);
    const fen=parts.length===6&&parts[0]===placement&&/^[wb]$/.test(parts[1])?candidate.trim():null;
    return {board,placement,bottomColor,myColor:bottomColor,playerColor:declaredPlayerColor(board),fen,moves:readMoveHistory(doc)};
  }

  root.ChessCoachBoard={placementFromClasses,placementFromNodes,findBoard,snapshot,readMoveHistory,initial};
})(globalThis);
