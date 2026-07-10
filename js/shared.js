/* ============================================================
   PAWS ENGINE — shared core
   Save data & settings · audio engine · unified input
   (keyboard / gamepad / touch) · level-builder DSL · levels
   ============================================================ */

export const TILE=32, ROWS=17, VIEW_W=960, VIEW_H=540;
export const TAU=Math.PI*2;
export const clamp=(v,a,b)=>v<a?a:v>b?b:v;
export const lerp=(a,b,t)=>a+(b-a)*t;
export const isMobile=(typeof window!=='undefined')&&(matchMedia('(pointer:coarse)').matches||'ontouchstart' in window);

// ---------------- characters ----------------
/** Playable pups. Both are alive, happy, healthy, and extremely good.
    2D palette keys map to body parts; `shape` tweaks the sprite build.
    `rig` colors/dimensions drive the 3D model. Stats give each dog a feel:
    Rue is balanced; Nero is a zoomy iggy — faster, floatier, slides more. */
export const CHARS={
  rue:{
    id:'rue',name:'Rue',
    desc:'the very good girl · balanced & brave',
    stats:{walk:2.7,run:4.35,jump:9.8,accel:0.34,fric:0.85},
    pal:{body:'#f6f1e7',head:'#c98f5f',ear:'#a5714a',chest:'#f6f1e7',belly:'#f2ddd0',
         spot:'#d9a06a',nose:'#241d20',eye:'#332218',muz:'#7b675c',snout:'#f6f1e7',
         harA:'#9adcc9',harB:'#e26fa4',tongue:'#e2708a',tailBase:'#f6f1e7',tailTip:'#fdfbf5'},
    shape:{saddle:true,blaze:false,earStyle:'flop',legH:6,neck:0,spots:true},
    rig:{body:0xf6f1e7,head:0xc98f5f,ear:0xa5714a,chest:0xf6f1e7,belly:0xf2ddd0,
         muz:0x7b675c,snout:0xf6f1e7,saddle:0xc98f5f,spots:0xd9a06a,
         harA:0x9adcc9,harB:0xe26fa4,tailBase:0xc98f5f,tailBand:0x6e5138,tailTip:0xfdfbf5,
         bodyR:8.5,bodyLen:19,legLen:8.4,legR:1.9,headX:13,headY:26,headR:7.8,
         earStyle:'flop',neck:false},
  },
  nero:{
    id:'nero',name:'Nero',
    desc:'the zoomy iggy · faster, floatier, slides',
    stats:{walk:2.9,run:4.7,jump:10.3,accel:0.30,fric:0.90},
    pal:{body:'#8b8e97',head:'#84878f',ear:'#6e7178',chest:'#f4f2ec',belly:'#e8cfc4',
         spot:null,nose:'#2a2a2e',eye:'#26201c',muz:'#cfd2d6',snout:'#cfd2d6',
         harA:'#a8d54a',harB:'#4a5a2a',tongue:'#e2708a',tailBase:'#7c7f87',tailTip:'#f4f2ec'},
    shape:{saddle:false,blaze:true,earStyle:'rose',legH:7.6,neck:2,spots:false},
    rig:{body:0x8b8e97,head:0x84878f,ear:0x6e7178,chest:0xf4f2ec,belly:0xe8cfc4,
         muz:0xcfd2d6,snout:0xcfd2d6,saddle:null,spots:null,
         harA:0xa8d54a,harB:0x4a5a2a,tailBase:0x7c7f87,tailBand:0x6e7178,tailTip:0xf4f2ec,
         bodyR:7.4,bodyLen:22,legLen:10.6,legR:1.55,headX:14.5,headY:30,headR:7.0,
         earStyle:'rose',neck:true},
  },
};

// ---------------- save data & settings ----------------
const DEFAULT_SETTINGS={music:0.75,sfx:0.9,trip:1.0,quality:'auto',touch:'auto',char:'rue'};
export const Save={
  KEY:'rueOdyssey.v2',
  data:{settings:{...DEFAULT_SETTINGS},progress:{}},
  load(){
    try{
      const d=JSON.parse(localStorage.getItem(this.KEY));
      if(d) this.data=d;
    }catch(e){}
    this.data.settings=Object.assign({...DEFAULT_SETTINGS},this.data.settings||{});
    this.data.progress=this.data.progress||{};
    return this.data;
  },
  store(){ try{localStorage.setItem(this.KEY,JSON.stringify(this.data));}catch(e){} },
  get settings(){ return this.data.settings; },
  stat(id){ return this.data.progress[id]||null; },
  recordWin(id,score,bones,time){
    const p=this.data.progress[id]||(this.data.progress[id]={});
    const newBest=score>(p.best||0);
    p.done=true;
    p.best=Math.max(p.best||0,score);
    p.bones=Math.max(p.bones||0,bones);
    p.time=Math.min(p.time==null?1e9:p.time,Math.round(time));
    this.store();
    return newBest;
  },
  resetProgress(){ this.data.progress={}; this.store(); }
};

// ---------------- audio ----------------
export const Sound={
  ctx:null,master:null,musicBus:null,sfxBus:null,delay:null,
  on:true,bpm:92,step:0,nextT:0,timer:null,arpIdx:3,
  unlock(){
    if(!this.ctx) this.init();
    if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume();
  },
  applyVolumes(){
    if(!this.ctx) return;
    const s=Save.settings;
    this.musicBus.gain.setTargetAtTime(this.on?0.9*s.music:0,this.ctx.currentTime,0.05);
    this.sfxBus.gain.setTargetAtTime(0.9*s.sfx,this.ctx.currentTime,0.05);
  },
  init(){
    try{
      const AC=window.AudioContext||window.webkitAudioContext;
      this.ctx=new AC();
      const c=this.ctx;
      this.master=c.createGain(); this.master.gain.value=0; this.master.connect(c.destination);
      this.musicBus=c.createGain(); this.musicBus.connect(this.master);
      this.sfxBus=c.createGain(); this.sfxBus.connect(this.master);
      this.delay=c.createDelay(1.0); this.delay.delayTime.value=(60/this.bpm)*0.75;
      const fb=c.createGain(); fb.gain.value=0.34;
      this.delay.connect(fb); fb.connect(this.delay);
      const wet=c.createGain(); wet.gain.value=0.5;
      this.delay.connect(wet); wet.connect(this.musicBus);
      this.applyVolumes();
      this.nextT=c.currentTime+0.1;
      this.timer=setInterval(()=>this.sched(),80);
      this.master.gain.linearRampToValueAtTime(0.5,c.currentTime+1.5);
    }catch(e){ console.warn('audio init failed',e); }
  },
  toggle(){
    this.unlock();
    this.on=!this.on;
    this.applyVolumes();
    return this.on;
  },
  f(m){ return 440*Math.pow(2,(m-69)/12); },
  sched(){
    if(!this.ctx||this.ctx.state!=='running') return;
    const s8=(60/this.bpm)/2;
    while(this.nextT<this.ctx.currentTime+0.3){
      this.note(this.nextT,this.step);
      this.step++; this.nextT+=s8;
    }
  },
  note(t,s){
    const c=this.ctx, spb=60/this.bpm;
    const roots=[50,48,53,45];
    const root=roots[(s>>4)%4];
    if(s%16===0){
      for(const iv of [0,7,10,14]) for(const det of [-6,6]){
        const o=c.createOscillator(), g=c.createGain(), fl=c.createBiquadFilter();
        o.type='sawtooth'; o.frequency.value=this.f(root+iv); o.detune.value=det;
        fl.type='lowpass'; fl.Q.value=2;
        fl.frequency.setValueAtTime(280,t);
        fl.frequency.linearRampToValueAtTime(950,t+spb*4);
        fl.frequency.linearRampToValueAtTime(300,t+spb*8);
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(0.042,t+0.7);
        g.gain.setValueAtTime(0.042,t+spb*8-0.9);
        g.gain.linearRampToValueAtTime(0,t+spb*8);
        o.connect(fl); fl.connect(g); g.connect(this.musicBus);
        o.start(t); o.stop(t+spb*8+0.1);
      }
    }
    if(s%4===0){
      const o=c.createOscillator(), g=c.createGain();
      o.type='sine'; o.frequency.setValueAtTime(this.f(root-12),t);
      g.gain.setValueAtTime(0.17,t); g.gain.exponentialRampToValueAtTime(0.001,t+spb*0.9);
      o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t+spb);
    }
    const scale=[0,3,5,7,10,12,15,17,19];
    this.arpIdx+=(Math.random()<0.5?1:-1)*(Math.random()<0.25?2:1);
    this.arpIdx=clamp(this.arpIdx,0,scale.length-1);
    if(Math.random()<0.85){
      const o=c.createOscillator(), g=c.createGain();
      o.type='triangle'; o.frequency.value=this.f(root+12+scale[this.arpIdx]);
      g.gain.setValueAtTime(0.05,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.22);
      o.connect(g); g.connect(this.delay); g.connect(this.musicBus);
      o.start(t); o.stop(t+0.25);
    }
    if(s%32===8){
      const o=c.createOscillator(), g=c.createGain();
      o.type='sine'; o.frequency.setValueAtTime(this.f(root+36),t);
      o.frequency.exponentialRampToValueAtTime(this.f(root+24),t+1.2);
      g.gain.setValueAtTime(0.028,t); g.gain.exponentialRampToValueAtTime(0.001,t+1.4);
      o.connect(g); g.connect(this.delay); o.start(t); o.stop(t+1.5);
    }
  },
  blip(f0,f1,dur,type,vol){
    if(!this.ctx||this.ctx.state!=='running') return;
    const c=this.ctx, t=c.currentTime;
    const o=c.createOscillator(), g=c.createGain();
    o.type=type||'square'; o.frequency.setValueAtTime(f0,t);
    if(f1) o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(vol||0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t+dur+0.05);
  },
  jump(){ this.blip(240,520,0.18,'square',0.08); },
  spinS(){ this.blip(300,720,0.22,'sawtooth',0.06); },
  stomp(){ this.blip(180,60,0.15,'square',0.14); },
  bone(){ this.blip(880,1320,0.12,'sine',0.1); setTimeout(()=>this.blip(1320,1760,0.1,'sine',0.08),60); },
  power(){ [340,430,510,640,760,900].forEach((f,i)=>setTimeout(()=>this.blip(f,f*1.1,0.12,'triangle',0.1),i*70)); },
  hurtS(){ this.blip(320,80,0.35,'sawtooth',0.12); },
  starJ(){ [660,880,990,1320,990,1320,1760].forEach((f,i)=>setTimeout(()=>this.blip(f,f,0.09,'square',0.08),i*70)); },
  bump(){ this.blip(140,90,0.08,'square',0.1); },
  brick(){ this.blip(220,80,0.2,'sawtooth',0.12); },
  heartS(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>this.blip(f,f,0.15,'sine',0.1),i*90)); },
  winS(){ [523,659,784,1047,784,1047,1319,1568].forEach((f,i)=>setTimeout(()=>this.blip(f,f,0.22,'triangle',0.12),i*140)); },
  overS(){ [392,330,262,196].forEach((f,i)=>setTimeout(()=>this.blip(f,f*0.97,0.4,'triangle',0.1),i*260)); },
  uiS(){ this.blip(520,700,0.08,'triangle',0.07); },
};

// ---------------- input (keyboard + gamepad + touch) ----------------
export const Input={
  l:false,r:false,u:false,d:false,jump:false,spin:false,run:false,
  jumpP:false,spinP:false,startP:false,musicP:false,anyP:false,
  uP:false,dP:false,lP:false,rP:false,backP:false,
  padOn:false,pad:null,_k:{},_pPrev:[],_navPrev:{},
  touch:{l:false,r:false,jump:false,spin:false,run:false},
  key(e,down){
    this._k[e.code]=down;
    if(down&&!e.repeat){
      const c=e.code;
      if(c==='KeyZ'||c==='Space'||c==='ArrowUp'||c==='KeyW') this.jumpP=true;
      if(c==='KeyC'||c==='KeyB') this.spinP=true;
      if(c==='Enter'||c==='KeyP') this.startP=true;
      if(c==='Escape') this.backP=true;
      if(c==='KeyM') this.musicP=true;
      if(c==='ArrowUp'||c==='KeyW') this.uP=true;
      if(c==='ArrowDown'||c==='KeyS') this.dP=true;
      if(c==='ArrowLeft'||c==='KeyA') this.lP=true;
      if(c==='ArrowRight'||c==='KeyD') this.rP=true;
      this.anyP=true;
    }
  },
  press(name){ // touch edge events
    if(name==='jump') this.jumpP=true;
    if(name==='spin') this.spinP=true;
    if(name==='start') this.startP=true;
    this.anyP=true;
  },
  poll(){
    const k=this._k, T=this.touch;
    let l=k.ArrowLeft||k.KeyA||T.l, r=k.ArrowRight||k.KeyD||T.r;
    let u=k.ArrowUp||k.KeyW, d=k.ArrowDown||k.KeyS;
    let jump=k.KeyZ||k.Space||k.ArrowUp||k.KeyW||T.jump;
    let spin=k.KeyC||k.KeyB||T.spin;
    let run=k.KeyX||k.ShiftLeft||k.ShiftRight||T.run;
    let gp=null;
    const pads=navigator.getGamepads?navigator.getGamepads():[];
    for(const p of pads){ if(p&&p.connected){ gp=p; break; } }
    if(gp){
      this.padOn=true; this.pad=gp;
      const b=gp.buttons, ax=gp.axes, dz=0.28;
      const bp=i=>!!(b[i]&&b[i].pressed);
      if(ax[0]<-dz||bp(14)) l=true;
      if(ax[0]> dz||bp(15)) r=true;
      if(ax[1]<-dz||bp(12)) u=true;
      if(ax[1]> dz||bp(13)) d=true;
      if(bp(0)) jump=true;
      if(bp(1)) spin=true;
      if(bp(2)||bp(5)||bp(7)) run=true;
      const prev=this._pPrev, edge=i=>bp(i)&&!prev[i];
      if(edge(0)) this.jumpP=true;
      if(edge(1)){ this.spinP=true; this.backP=true; }
      if(edge(9)) this.startP=true;
      if(edge(3)) this.musicP=true;
      if(edge(0)||edge(9)) this.anyP=true;
      this._pPrev=[]; for(let i=0;i<b.length;i++) this._pPrev[i]=b[i].pressed;
    } else { this.pad=null; }
    // menu-navigation edges from held directions (covers stick + touch)
    const np=this._navPrev;
    if(u&&!np.u) this.uP=true;
    if(d&&!np.d) this.dP=true;
    if(l&&!np.l) this.lP=true;
    if(r&&!np.r) this.rP=true;
    np.u=u; np.d=d; np.l=l; np.r=r;
    this.l=!!l; this.r=!!r; this.u=!!u; this.d=!!d;
    this.jump=!!jump; this.spin=!!spin; this.run=!!run;
  },
  clear(){ this.jumpP=this.spinP=this.startP=this.musicP=this.anyP=this.uP=this.dP=this.lP=this.rP=this.backP=false; }
};

export function rumble(strong,weak,ms){
  try{
    const p=Input.pad;
    if(p&&p.vibrationActuator) p.vibrationActuator.playEffect('dual-rumble',{duration:ms,strongMagnitude:strong,weakMagnitude:weak});
  }catch(e){}
}

/** Wire the DOM touch overlay. Elements: #padMove (slide left/right), and
    [data-tbtn] buttons: jump/spin/run. Edge presses feed Input.press(). */
export function bindTouch(){
  const pad=document.getElementById('padMove');
  if(pad){
    const setDir=(e)=>{
      const r=pad.getBoundingClientRect();
      const x=e.clientX-r.left;
      Input.touch.l=x<r.width/2;
      Input.touch.r=x>=r.width/2;
      pad.classList.toggle('lActive',Input.touch.l);
      pad.classList.toggle('rActive',Input.touch.r);
    };
    const clearDir=()=>{
      Input.touch.l=Input.touch.r=false;
      pad.classList.remove('lActive','rActive');
    };
    pad.addEventListener('pointerdown',e=>{ pad.setPointerCapture(e.pointerId); setDir(e); e.preventDefault(); });
    pad.addEventListener('pointermove',e=>{ if(e.buttons||e.pressure>0) setDir(e); });
    pad.addEventListener('pointerup',clearDir);
    pad.addEventListener('pointercancel',clearDir);
  }
  for(const el of document.querySelectorAll('[data-tbtn]')){
    const name=el.dataset.tbtn;
    const on=e=>{ Input.touch[name]=true; Input.press(name); el.classList.add('down'); e.preventDefault(); };
    const off=()=>{ Input.touch[name]=false; el.classList.remove('down'); };
    el.addEventListener('pointerdown',on);
    el.addEventListener('pointerup',off);
    el.addEventListener('pointercancel',off);
    el.addEventListener('pointerleave',off);
  }
}

/* ============================================================
   LEVEL LIBRARY
   tiles: 0 air · 1 ground · 2 brick · 3 ?-block · 4 used ·
          5 pipe · 7 lotus pad (one-way)
   ============================================================ */
class LevelBuilder{
  constructor(lw){
    this.LW=lw;
    this.grid=new Uint8Array(lw*ROWS);
    this.blockItems={};
    this.bones=[]; this.enemies=[]; this.tips=[];
  }
  set(c,r,v){ if(c>=0&&c<this.LW&&r>=0&&r<ROWS) this.grid[r*this.LW+c]=v; }
  get(c,r){ if(c<0||c>=this.LW) return 1; if(r<0||r>=ROWS) return 0; return this.grid[r*this.LW+c]; }
  solid(v){ return v===1||v===2||v===3||v===4||v===5; }
  groundCol(c,top,bot=ROWS-1){ for(let r=top;r<=bot;r++) this.set(c,r,1); }
  ground(c0,c1,top,bot=ROWS-1){ for(let c=c0;c<=c1;c++) this.groundCol(c,top,bot); }
  ceiling(c0,c1,bot){ for(let c=c0;c<=c1;c++) for(let r=0;r<=bot;r++) this.set(c,r,1); }
  pipe(c,top,gtop){ for(let r=top;r<gtop;r++){ this.set(c,r,5); this.set(c+1,r,5); } }
  q(c,r,item){ this.set(c,r,3); this.blockItems[c+','+r]=item; }
  bricks(c0,c1,r){ for(let c=c0;c<=c1;c++) this.set(c,r,2); }
  lotus(c0,c1,r){ for(let c=c0;c<=c1;c++) this.set(c,r,7); }
  bone(c,r){ this.bones.push({x:c*TILE+16,y:r*TILE+16,taken:false,t:(c*0.7+r*1.3)%6}); }
  bonesRow(c0,c1,r){ for(let c=c0;c<=c1;c++) this.bone(c,r); }
  shroomie(c){ this.enemies.push({type:'shroom',c,x:c*TILE+4,y:0,w:24,h:22,vx:-0.8,vy:0,alive:true,active:false,dying:false,squash:1,hueOff:(c*37)%360}); }
  jelly(c,r){ this.enemies.push({type:'jelly',x:c*TILE+3,y:r*TILE+3,w:26,h:26,baseY:r*TILE+3,ph:(c*1.7)%TAU,alive:true,active:true,dying:false,squash:1,hueOff:(c*61)%360}); }
  tip(c,r,text){ this.tips.push({x:c*TILE,y:r*TILE,text}); }
  groundTopAt(c){ for(let r=0;r<ROWS;r++) if(this.solid(this.get(c,r))) return r*TILE; return ROWS*TILE; }
  finish(meta){
    for(const e of this.enemies) if(e.type==='shroom') e.y=this.groundTopAt(e.c)-e.h;
    let blockBones=0;
    for(const k in this.blockItems){
      if(this.blockItems[k]==='bone') blockBones+=1;
      if(this.blockItems[k]==='bones5') blockBones+=5;
    }
    const cpC=meta.checkpointCol, gC=meta.gateCol, sC=meta.startCol??3;
    return {
      ...meta,
      LW:this.LW, grid:this.grid, blockItems:this.blockItems,
      bones:this.bones, enemies:this.enemies, tips:this.tips,
      totalBones:this.bones.length+blockBones,
      checkpointX:cpC*TILE, cpY:this.groundTopAt(cpC),
      gateX:gC*TILE, gateY:this.groundTopAt(gC),
      startX:sC*TILE, startY:this.groundTopAt(sC)-27,
    };
  }
}

// ---------- Level: Awakening Meadow (classic & remix base) ----------
function buildMeadow(){
  const b=new LevelBuilder(196);
  b.ground(0,17,14);
  b.tip(4,10,'MOVE · JUMP Ⓐ/Z · hold Ⓧ/SHIFT to RUN');
  b.bonesRow(8,10,13);
  b.q(12,10,'bone'); b.q(14,10,'shroom');
  b.ground(20,36,14);
  b.bone(18,12); b.bone(19,12);
  b.shroomie(24); b.shroomie(29);
  b.tip(24,8,'bounce on the shroomies!');
  b.bricks(26,29,10); b.q(27,10,'bones5');
  b.pipe(33,12,14);
  b.lotus(37,39,11);
  b.bonesRow(37,39,10);
  b.ground(40,45,13); b.ground(46,52,12); b.ground(53,58,13);
  b.q(49,8,'star');
  b.shroomie(47);
  b.jelly(55,10);
  b.tip(44,7,'SPIKY EYES are too prickly to stomp — SPIN-JUMP Ⓑ/C bounces them!');
  b.bonesRow(46,52,11);
  b.lotus(60,61,13);
  b.ground(63,93,14);
  b.bricks(66,74,10);
  b.q(68,10,'bone'); b.q(71,10,'shroom'); b.q(73,10,'bone');
  b.bricks(69,71,7);
  b.bonesRow(69,71,6);
  b.bonesRow(66,74,13);
  b.shroomie(65); b.shroomie(77);
  b.jelly(80,10);
  b.pipe(82,12,14); b.pipe(87,11,14);
  b.jelly(85,8);
  b.bone(85,10); b.bone(86,10);
  b.tip(90,10,'checkpoint ahead ✧');
  b.ground(96,97,12); b.ground(100,101,10); b.ground(104,105,12); b.ground(108,109,10); b.ground(112,113,11);
  b.lotus(98,99,14); b.lotus(106,107,14);
  b.tip(95,8,'trust the lotus pads');
  b.bonesRow(96,97,11); b.bonesRow(100,101,9); b.bonesRow(104,105,11); b.bonesRow(108,109,9); b.bonesRow(112,113,10);
  b.jelly(102,8);
  b.ground(115,131,14);
  b.shroomie(118); b.shroomie(121); b.shroomie(127);
  b.jelly(120,10); b.jelly(126,10);
  b.bricks(122,124,10); b.q(123,10,'star');
  b.shroomie(124);
  b.bonesRow(116,130,13);
  b.groundCol(132,13); b.groundCol(133,12); b.groundCol(134,11); b.groundCol(135,10); b.groundCol(136,9); b.groundCol(137,9);
  b.ground(138,141,9);
  b.bonesRow(138,141,8);
  b.ground(142,150,14);
  b.bone(142,11); b.bone(143,13);
  b.bonesRow(151,154,11);
  b.ground(155,172,14);
  b.shroomie(158); b.shroomie(164);
  b.bonesRow(157,166,13);
  b.pipe(166,11,14);
  b.jelly(169,8); b.jelly(171,7);
  b.groundCol(173,13); b.groundCol(174,12); b.groundCol(175,11); b.groundCol(176,10); b.groundCol(177,9); b.groundCol(178,9);
  b.ground(179,195,14);
  b.bonesRow(181,184,13);
  return b.finish({checkpointCol:92,gateCol:186});
}

// ---------- Level: Neon Depths (classic L2 — cavern) ----------
function buildDepths(){
  const b=new LevelBuilder(204);
  // cavern ceiling with hanging stalactites
  b.ceiling(0,203,1);
  for(const [c,d] of [[14,3],[30,4],[47,3],[68,5],[90,3],[118,4],[141,3],[160,5],[181,3]])
    for(let r=2;r<=d;r++){ b.set(c,r,1); }
  b.ground(0,15,14);
  b.tip(4,10,'the depths breathe · watch the ceiling teeth');
  b.bonesRow(6,9,13);
  // pipe slalom
  b.ground(18,44,14);
  b.pipe(20,12,14); b.pipe(25,10,14); b.pipe(31,12,14); b.pipe(37,10,14);
  b.jelly(23,8); b.jelly(35,8);
  b.bone(22,11); b.bone(23,11); b.bone(28,9); b.bone(29,9); b.bone(34,11); b.bone(40,9);
  b.q(29,7,'shroom');
  b.shroomie(42);
  // brick maze
  b.ground(47,72,14);
  b.bricks(50,56,10); b.q(53,10,'bone');
  b.bricks(54,62,7);  b.q(58,7,'bones5');
  b.bricks(60,66,10); b.q(63,10,'bone');
  b.bonesRow(55,61,6);
  b.bonesRow(50,66,13);
  b.shroomie(52); b.shroomie(58); b.shroomie(64);
  b.jelly(68,10);
  b.tip(50,12,'a maze of bricks — big Rue can smash through');
  // long lotus chain over the void
  b.bonesRow(74,76,10);
  b.lotus(74,76,11); b.lotus(79,80,9); b.lotus(83,85,12); b.lotus(88,89,10); b.lotus(92,94,12);
  b.bone(79,8); b.bone(80,8); b.bone(88,9); b.bone(89,9);
  b.jelly(81,6); b.jelly(91,8);
  b.tip(78,7,'lotus chain — no floor below');
  // checkpoint island
  b.ground(97,112,14);
  b.tip(99,10,'checkpoint ✧');
  b.shroomie(104); b.shroomie(108);
  b.bonesRow(100,110,13);
  b.q(106,10,'star');
  // shroomie den under low ceiling
  b.ground(115,136,14);
  b.ceiling(118,133,6);
  b.shroomie(118); b.shroomie(122); b.shroomie(126); b.shroomie(130); b.shroomie(133);
  b.bonesRow(117,134,13);
  b.tip(117,9,'the den — a starseed rampage helps');
  // vertical climb to plateau near ceiling
  b.groundCol(139,13); b.groundCol(140,12); b.groundCol(141,11);
  b.ground(142,146,10);
  b.groundCol(147,9); b.groundCol(148,8);
  b.ground(149,157,7);
  b.jelly(152,5); b.jelly(155,4);
  b.bonesRow(149,157,6);
  // drop and double gap
  b.ground(158,166,14);
  b.bone(159,10); b.bone(160,12);
  b.lotus(168,169,12);
  b.ground(171,177,14);
  b.jelly(173,9);
  b.lotus(179,180,11);
  b.bonesRow(179,180,10);
  // final approach
  b.ground(182,203,14);
  b.shroomie(185); b.shroomie(188);
  b.bonesRow(184,190,13);
  b.groundCol(191,13); b.groundCol(192,12); b.groundCol(193,11);
  return b.finish({checkpointCol:100,gateCol:198});
}

// ---------- Level: Astral Fields (odyssey L1 — meadow remix) ----------
function buildAstral(){
  const b=new LevelBuilder(198);
  b.ground(0,17,14);
  b.tip(4,10,'MOVE · JUMP Ⓐ/Z · hold Ⓧ/SHIFT to RUN');
  b.bonesRow(8,10,13);
  b.q(12,10,'bone'); b.q(14,10,'shroom');
  b.ground(20,34,14);
  b.bone(18,12); b.bone(19,12);
  b.shroomie(24); b.shroomie(28);
  b.tip(24,8,'bounce on the shroomies!');
  b.bricks(26,29,10); b.q(27,10,'bones5');
  // rolling hills with pipes between
  b.ground(35,40,13); b.ground(41,46,12); b.ground(47,52,13); b.ground(53,58,14);
  b.pipe(44,10,12);
  b.bonesRow(41,46,11);
  b.shroomie(49);
  b.jelly(51,10);
  b.tip(42,7,'SPIKY EYES — SPIN-JUMP Ⓑ/C bounces them safely!');
  b.q(56,10,'star');
  // floating garden — lotus arcs with jellies
  b.lotus(61,62,12); b.lotus(65,66,10); b.lotus(69,70,12);
  b.bonesRow(65,66,9); b.bone(62,11); b.bone(69,11);
  b.jelly(67,7);
  b.tip(63,7,'the floating garden');
  b.ground(72,94,14);
  // twin brick decks
  b.bricks(75,83,10); b.q(78,10,'bone'); b.q(81,10,'shroom');
  b.bricks(77,81,7);  b.bonesRow(77,81,6);
  b.bonesRow(75,83,13);
  b.shroomie(74); b.shroomie(86);
  b.jelly(89,10);
  b.pipe(91,11,14);
  b.tip(94,10,'checkpoint ahead ✧');
  // pillar rhythm over the void
  b.ground(97,98,12); b.ground(101,102,10); b.ground(105,106,12); b.ground(109,110,9); b.ground(113,114,11);
  b.lotus(99,100,14); b.lotus(107,108,14);
  b.bonesRow(97,98,11); b.bonesRow(101,102,9); b.bonesRow(105,106,11); b.bonesRow(109,110,8); b.bonesRow(113,114,10);
  b.jelly(103,7); b.jelly(111,6);
  b.tip(97,7,'trust the lotus pads');
  // gauntlet plain
  b.ground(116,134,14);
  b.shroomie(119); b.shroomie(123); b.shroomie(127); b.shroomie(131);
  b.jelly(121,10); b.jelly(129,10);
  b.bricks(124,126,10); b.q(125,10,'star');
  b.bonesRow(117,133,13);
  // grand stairs and sky run
  b.groundCol(135,13); b.groundCol(136,12); b.groundCol(137,11); b.groundCol(138,10); b.groundCol(139,9); b.groundCol(140,8);
  b.ground(141,147,8);
  b.bonesRow(141,147,7);
  b.jelly(144,5);
  b.ground(148,158,14);
  b.bone(148,10); b.bone(149,12);
  b.bonesRow(152,156,13);
  b.shroomie(154);
  // lotus bridge finale
  b.lotus(160,161,12); b.lotus(164,165,10); b.lotus(168,169,12);
  b.bonesRow(164,165,9);
  b.jelly(166,7);
  b.ground(171,197,14);
  b.groundCol(174,13); b.groundCol(175,12); b.groundCol(176,11); b.groundCol(177,10); b.groundCol(178,9);
  b.bonesRow(182,186,13);
  return b.finish({checkpointCol:95,gateCol:189});
}

// ---------- Level: Temple of the Third Eye (odyssey L2) ----------
function buildTemple(){
  const b=new LevelBuilder(206);
  b.ground(0,13,14);
  b.tip(4,10,'the temple stirs · tread with intention');
  b.bonesRow(6,9,13);
  // grand entrance stairs
  b.groundCol(14,13); b.groundCol(15,12); b.groundCol(16,11); b.groundCol(17,10); b.groundCol(18,9);
  b.ground(19,40,9);
  // colonnade on the plateau (pipes as pillars to weave through)
  b.pipe(22,6,9); b.pipe(28,5,9); b.pipe(34,6,9);
  b.jelly(25,3); b.jelly(31,3);
  b.bonesRow(20,38,8);
  b.q(26,5,'shroom'); b.q(37,5,'bone');
  b.tip(21,4,'weave the colonnade');
  // descent
  b.groundCol(41,10); b.groundCol(42,11); b.groundCol(43,12);
  b.ground(44,58,14);
  b.shroomie(47); b.shroomie(52); b.shroomie(56);
  b.bonesRow(46,56,13);
  b.bricks(49,54,10); b.q(51,10,'bones5');
  // pillar rhythm I
  b.ground(61,62,12); b.ground(65,66,10); b.ground(69,70,12); b.ground(73,74,9);
  b.lotus(63,64,14); b.lotus(71,72,14);
  b.bonesRow(61,62,11); b.bonesRow(65,66,9); b.bonesRow(69,70,11); b.bonesRow(73,74,8);
  b.jelly(67,7); b.jelly(75,6);
  b.tip(61,7,'the rhythm of pillars');
  // double-decker temple interior
  b.ground(77,104,14);
  b.bricks(80,101,9);   // upper floor
  b.q(84,9,'bone'); b.q(92,9,'star'); b.q(98,9,'bone');
  b.shroomie(82); b.shroomie(88); b.shroomie(95);   // lower floor dwellers
  b.bonesRow(80,100,13);
  b.bricks(80,82,5); b.bricks(99,101,5);
  b.bonesRow(84,97,4);  // treasures atop the upper floor
  b.jelly(90,2);
  b.tip(79,12,'two floors — big Rue opens the way up');
  b.tip(101,10,'checkpoint ✧');
  // pillar rhythm II (tighter)
  b.ground(107,108,12); b.ground(111,112,9); b.ground(115,116,12); b.ground(119,120,8); b.ground(123,124,11);
  b.lotus(109,110,14); b.lotus(117,118,14); b.lotus(121,122,14);
  b.bonesRow(107,108,11); b.bonesRow(111,112,8); b.bonesRow(115,116,11); b.bonesRow(119,120,7); b.bonesRow(123,124,10);
  b.jelly(113,6); b.jelly(121,5);
  // inner sanctum gauntlet
  b.ground(126,148,14);
  b.shroomie(129); b.shroomie(133); b.shroomie(137); b.shroomie(141); b.shroomie(145);
  b.jelly(131,10); b.jelly(139,10); b.jelly(143,9);
  b.bonesRow(127,147,13);
  b.pipe(135,11,14);
  // ziggurat climb
  b.groundCol(149,13); b.groundCol(150,12);
  b.ground(151,154,11);
  b.groundCol(155,10); b.groundCol(156,9);
  b.ground(157,162,8);
  b.jelly(159,5);
  b.bonesRow(157,162,7);
  b.groundCol(163,9); b.groundCol(164,10);
  b.ground(165,170,11);
  b.bonesRow(166,169,10);
  // lotus bridge to the sanctum
  b.lotus(172,173,12); b.lotus(176,177,10); b.lotus(180,181,12);
  b.jelly(178,7);
  b.bonesRow(176,177,9);
  b.ground(183,205,14);
  b.groundCol(186,13); b.groundCol(187,12); b.groundCol(188,11);
  b.bonesRow(190,194,13);
  b.pipe(203,11,14);
  return b.finish({checkpointCol:103,gateCol:197});
}

/** Level registry: each mode has its own campaign. */
export const LEVELS={
  classic:[
    {id:'c1',name:'Awakening Meadow',sub:'where the veil first thins',theme:{hue:0,dark:0},build:buildMeadow},
    {id:'c2',name:'Neon Depths',sub:'a cavern that dreams in color',theme:{hue:150,dark:0.35},build:buildDepths},
  ],
  odyssey:[
    {id:'o1',name:'Astral Fields',sub:'the open sky of the mind',theme:{hue:0,dark:0},build:buildAstral},
    {id:'o2',name:'Temple of the Third Eye',sub:'the geometry remembers you',theme:{hue:265,dark:0.3},build:buildTemple},
  ],
};
export function levelUnlocked(mode,idx){
  if(idx===0) return true;
  const prev=LEVELS[mode][idx-1];
  const st=Save.stat(prev.id);
  return !!(st&&st.done);
}
