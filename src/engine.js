// Stockfish runs as a local Web Worker. No position is sent to a cloud service.
export class LocalStockfish {
  constructor(onStatus,onInfo,onBest){
    this.onStatus=onStatus;this.onInfo=onInfo;this.onBest=onBest;
    this.worker=null;this.ready=false;this.active=null;this.next=null;
    this.variations=new Map();
  }
  async init(){
    const response=await fetch(new URL('engine/manifest.json',document.baseURI));
    if(!response.ok)throw Error('Engine files missing. Run npm install and npm run dev.');
    const manifest=await response.json();
    const url=new URL('engine/'+manifest.worker,document.baseURI);
    this.worker=new Worker(url,{name:'Stockfish'});
    this.worker.onmessage=e=>this.handle(String(e.data));
    this.worker.onerror=e=>this.onStatus('Engine error: '+(e.message||'worker failed'));
    this.onStatus('Starting local Stockfish…');
    this.worker.postMessage('uci');
    this.timeout=setTimeout(()=>{if(!this.ready)this.onStatus('Stockfish initialization timed out.');},20000);
  }
  handle(raw){
    for(const msg of raw.split(/\r?\n/)){
      if(msg==='uciok'){
        this.worker.postMessage('setoption name MultiPV value 3');
        this.worker.postMessage('isready');
      }else if(msg==='readyok'){
        this.ready=true;clearTimeout(this.timeout);this.onStatus('Stockfish ready.');
      }else if(msg.startsWith('info ')&&this.active&&!this.next){
        const depth=Number(msg.match(/\bdepth (\d+)/)?.[1]||0);
        const pvIndex=Number(msg.match(/\bmultipv (\d+)/)?.[1]||1);
        const score=msg.match(/\bscore (cp|mate) (-?\d+)/);
        const pv=msg.match(/\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/);
        if(score&&pv&&depth){
          this.variations.set(pvIndex,{depth,scoreType:score[1],score:Number(score[2]),moves:pv[1].trim().split(/\s+/)});
          this.onInfo(this.active.fen,[...this.variations.values()].sort((a,b)=>b.depth-a.depth));
        }
      }else if(msg.startsWith('bestmove ')&&this.active){
        const finished=this.active;
        const uci=msg.split(/\s+/)[1];
        const lines=[...this.variations.entries()].sort((a,b)=>a[0]-b[0]).map(([rank,v])=>({rank,...v}));
        this.active=null;
        if(this.next){
          const next=this.next;this.next=null;this.start(next);
        }else this.onBest(finished.fen,uci,lines);
      }
    }
  }
  start(fen){
    this.active={fen};this.variations.clear();
    this.worker.postMessage('position fen '+fen);
    this.worker.postMessage('go depth 16');
    this.onStatus('Analyzing…');
  }
  analyze(fen){
    if(!this.ready){this.onStatus('Engine is still loading.');return;}
    if(this.active){this.next=fen;this.worker.postMessage('stop');}
    else this.start(fen);
  }
  stop(){this.worker?.postMessage('stop');}
  destroy(){this.worker?.terminate();}
}