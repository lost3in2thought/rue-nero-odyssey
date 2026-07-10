/* ============================================================
   PAWS ENGINE — online co-op (WebRTC via PeerJS room codes)
   Host owns enemies/items/world; each side simulates its own
   dog and streams state at 20 Hz. Events sync pickups, blocks,
   stomps, and wins. Two very good dogs, any distance apart.
   ============================================================ */
import {Save,Sound} from './shared.js';
import {G,toast,packState,netState,packWorld,netWorld,netBone,netBall,netBlock,netBrick,netStomp,netItemTake,netCredit,netWin} from './logic.js';

const PROTO=2;

function loadPeerJS(){
  if(window.Peer) return Promise.resolve();
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='lib/peerjs.min.js';
    s.onload=res; s.onerror=()=>rej(new Error('peerjs load failed'));
    document.head.append(s);
  });
}
function makeCode(){
  const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c='';
  for(let i=0;i<4;i++) c+=A[Math.floor(Math.random()*A.length)];
  return c;
}

export const Net={
  peer:null, conn:null, role:null, code:null,
  remoteChar:'nero', frame:0, status:'idle',
  onStatus:null, onPeerJoined:null, onStart:null, onDisconnect:null,

  _setStatus(s){ this.status=s; if(this.onStatus) this.onStatus(s); },

  async host(){
    await loadPeerJS();
    this.close();
    this.role='host';
    this.code=makeCode();
    this._setStatus('opening room…');
    this.peer=new Peer('rno-'+this.code,{debug:0});
    this.peer.on('open',()=>this._setStatus('waiting for a friend…'));
    this.peer.on('error',e=>{
      if(String(e.type)==='unavailable-id'){ this.host(); return; }  // code collision → reroll
      this._setStatus('connection trouble: '+e.type);
    });
    this.peer.on('connection',conn=>{
      if(this.conn){ conn.close(); return; }
      this.conn=conn;
      this._wire(conn);
      conn.on('open',()=>{
        conn.send({t:'hello',proto:PROTO,char:Save.settings.char});
        this._setStatus('friend connected!');
        if(this.onPeerJoined) this.onPeerJoined();
      });
    });
    return this.code;
  },

  async join(code){
    await loadPeerJS();
    this.close();
    this.role='guest';
    this.code=code.toUpperCase().trim();
    this._setStatus('sniffing out the room…');
    this.peer=new Peer({debug:0});
    this.peer.on('error',e=>this._setStatus(e.type==='peer-unavailable'?'room not found — check the code':'connection trouble: '+e.type));
    this.peer.on('open',()=>{
      const conn=this.peer.connect('rno-'+this.code,{reliable:true});
      this.conn=conn;
      this._wire(conn);
      conn.on('open',()=>{
        conn.send({t:'hello',proto:PROTO,char:Save.settings.char});
        this._setStatus('connected! waiting for the host to pick a dream…');
      });
    });
  },

  _wire(conn){
    conn.on('data',m=>this._onMsg(m));
    conn.on('close',()=>{
      if(this.role){ toast('your friend left the dream'); if(this.onDisconnect) this.onDisconnect(); }
      this.conn=null;
    });
    conn.on('error',()=>this._setStatus('connection trouble'));
  },

  _onMsg(m){
    switch(m.t){
      case 'hello':
        this.remoteChar=m.char||'nero';
        if(m.proto!==PROTO) toast('⚠ versions differ — ask your friend to refresh');
        break;
      case 'init':   // host picked a dream
        if(m.char) this.remoteChar=m.char;
        if(this.onStart) this.onStart(m.mode,m.idx,m.char);
        break;
      case 'p': netState(m.a); break;
      case 'w': netWorld(m); break;
      case 'ev':
        if(m.k==='bone') netBone(m.i);
        else if(m.k==='ball') netBall(m.i);
        else if(m.k==='block') netBlock(m.key);
        else if(m.k==='brick') netBrick(m.key);
        else if(m.k==='stomp') netStomp(m.i);
        else if(m.k==='itemTake') netItemTake(m.id);
        else if(m.k==='itemGone') netItemTake(m.id);
        else if(m.k==='credit') netCredit(m);
        else if(m.k==='win') netWin();
        break;
    }
  },

  get connected(){ return !!(this.conn&&this.conn.open); },

  /** Host announces the chosen dream; both sides then load it. */
  sendInit(mode,idx){
    if(this.connected) this.conn.send({t:'init',mode,idx,char:Save.settings.char});
  },
  sendEvent(kind,data){
    if(this.connected) this.conn.send({t:'ev',k:kind,...data});
  },

  /** Called every logic frame while a net session is live. */
  tick(){
    if(!this.connected||!G.level) return;
    this.frame++;
    if(this.frame%3===0) this.conn.send({t:'p',a:packState()});
    if(this.role==='host'&&this.frame%6===0) this.conn.send({t:'w',...packWorld()});
  },

  close(){
    const hadRole=this.role;
    this.role=null;
    if(this.conn){ try{this.conn.close();}catch(e){} this.conn=null; }
    if(this.peer){ try{this.peer.destroy();}catch(e){} this.peer=null; }
    this._setStatus('idle');
    return hadRole;
  },
};

// forward gameplay events to the wire
G.on('net',(kind,data)=>Net.sendEvent(kind,data));
