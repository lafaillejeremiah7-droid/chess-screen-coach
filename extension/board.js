/* Chess.com position reader; text-only DOM parsing, no screenshots. */
(function (root) {
  "use strict";
  const initial="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const kinds={wp:"P",wn:"N",wb:"B",wr:"R",wq:"Q",wk:"K",bp:"p",bn:"n",bb:"b",br:"r",bq:"q",bk:"k"};
  function placementFromClasses(classNames){
    const cells=new Map();
    for(const raw of classNames){
      if(typeof raw!=="string")continue;
      const tokens=raw.trim().split(/\s+/);
      const kind=tokens.find(t=>Object.hasOwn(kinds,t));
      const square=tokens.find(t=>/^square-[1-8][1-8]$/.test(t));
      if(!kind || !square)continue; 
      const file=Number(square[7]),rank=Number(square[8]);
      const key=file+":"+rank;
      if(cells.has(key))throw Error("Overlapping pieces; wait for animation to finish.");
      cells.set(key,kinds[kind]);
    }
    if([...cells.values()].filter(p=>p==="K").length!==1||
       [...cells.values()].filter(p=>p==="k").length!==1)
      throw Error("Could not identify both kings.");
    if(cells.size>32)throw Error("Too many pieces on board.");
    const ranks=[];
    for(let rank=8;rank>=1;rank--){
      let encoded="",empty=0;
      for(let file=1;file<=8;file++){
        const piece=cells.get(file+":"+rank);
        if(!piece){empty++;continue;}
        if(empty){encoded+=empty;empty=0;}
        encoded+=piece;
      }
      if(empty)encoded+=empty;
      ranks.push(encoded);
    }
    return ranks.join("/");
  }
  function findBoard(doc){
    const boards=[...doc.querySelectorAll("wc-chess-board, chess-board")];
    return boards.find(b=>{
      const rect=b.getBoundingClientRect();
      return rect.width>120&&rect.height>120&&b.querySelectorAll(".piece").length>=2;
    }) || null;
  }
  function snapshot(doc){
    const board=findBoard(doc);
    if(!board)return null;
    const classes=[...board.querySelectorAll(".piece")].map(e=>e.getAttribute("class")||"");
    return {board,placement:placementFromClasses(classes),myColor:board.classList.contains("flipped")?"b":"w"};
  }
  root.ChessCoachBoard={placementFromClasses,findBoard,snapshot,initial};
})(globalThis);
