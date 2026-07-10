'use strict';
/* ============================================================
   RUE'S PSYCHEDELIC ODYSSEY
   A Super Mario World-style platformer starring Rue the dog,
   set inside an Alex Grey fever dream.
   Xbox controller supported (Gamepad API + rumble).
   ============================================================ */

// ---------------- canvas setup ----------------
const W = 960, H = 540, TILE = 32, ROWS = 17;
const view = document.getElementById('view');
const game = document.createElement('canvas');
game.width = W; game.height = H;
const ctx = game.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ---------------- utils ----------------
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
const lerp = (a,b,t)=>a+(b-a)*t;
const TAU = Math.PI*2;
function rr(g,x,y,w,h,rad){ g.beginPath(); if(g.roundRect) g.roundRect(x,y,w,h,rad); else g.rect(x,y,w,h); g.fill(); }

// ---------------- toasts ----------------
const toasts=[];
function toast(txt){ toasts.push({txt,t:3.2}); if(toasts.length>3) toasts.shift(); }

// ---------------- audio ----------------
const Sound = {
  ctx:null, master:null, musicBus:null, sfxBus:null, delay:null,
  on:true, bpm:92, step:0, nextT:0, timer:null, arpIdx:3,
  unlock(){
    if(!this.ctx) this.init();
    if(this.ctx && this.ctx.state==='suspended') this.ctx.resume();
  },
  init(){
    try{
      const AC = window.AudioContext||window.webkitAudioContext;
      this.ctx = new AC();
      const c = this.ctx;
      this.master=c.createGain(); this.master.gain.value=0; this.master.connect(c.destination);
      this.musicBus=c.createGain(); this.musicBus.gain.value=0.9; this.musicBus.connect(this.master);
      this.sfxBus=c.createGain(); this.sfxBus.gain.value=0.9; this.sfxBus.connect(this.master);
      this.delay=c.createDelay(1.0); this.delay.delayTime.value=(60/this.bpm)*0.75;
      const fb=c.createGain(); fb.gain.value=0.34;
      this.delay.connect(fb); fb.connect(this.delay);
      const wet=c.createGain(); wet.gain.value=0.5;
      this.delay.connect(wet); wet.connect(this.musicBus);
      this.nextT=c.currentTime+0.1;
      this.timer=setInterval(()=>this.sched(),80);
      this.master.gain.linearRampToValueAtTime(0.5, c.currentTime+1.5);
    }catch(e){ console.warn('audio init failed', e); }
  },
  toggle(){
    this.unlock();
    this.on=!this.on;
    if(this.ctx) this.musicBus.gain.setTargetAtTime(this.on?0.9:0.0,this.ctx.currentTime,0.05);
    toast(this.on?'♪ music on':'♪ music off');
  },
  f(m){ return 440*Math.pow(2,(m-69)/12); },
  sched(){
    if(!this.ctx || this.ctx.state!=='running') return;
    const s8=(60/this.bpm)/2;
    while(this.nextT < this.ctx.currentTime + 0.3){
      this.note(this.nextT, this.step);
      this.step++; this.nextT+=s8;
    }
  },
  note(t,s){
    const c=this.ctx, spb=60/this.bpm;
    const roots=[50,48,53,45];
    const root=roots[(s>>4)%4];
    if(s%16===0){ // slow pad, 2 bars
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
    if(s%4===0){ // heartbeat bass
      const o=c.createOscillator(), g=c.createGain();
      o.type='sine'; o.frequency.setValueAtTime(this.f(root-12),t);
      g.gain.setValueAtTime(0.17,t); g.gain.exponentialRampToValueAtTime(0.001,t+spb*0.9);
      o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t+spb);
    }
    // wandering pentatonic arp through the delay
    const scale=[0,3,5,7,10,12,15,17,19];
    this.arpIdx += (Math.random()<0.5?1:-1)*(Math.random()<0.25?2:1);
    this.arpIdx = clamp(this.arpIdx,0,scale.length-1);
    if(Math.random()<0.85){
      const o=c.createOscillator(), g=c.createGain();
      o.type='triangle'; o.frequency.value=this.f(root+12+scale[this.arpIdx]);
      g.gain.setValueAtTime(0.05,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.22);
      o.connect(g); g.connect(this.delay); g.connect(this.musicBus);
      o.start(t); o.stop(t+0.25);
    }
    if(s%32===8){ // falling shimmer
      const o=c.createOscillator(), g=c.createGain();
      o.type='sine'; o.frequency.setValueAtTime(this.f(root+36),t);
      o.frequency.exponentialRampToValueAtTime(this.f(root+24),t+1.2);
      g.gain.setValueAtTime(0.028,t); g.gain.exponentialRampToValueAtTime(0.001,t+1.4);
      o.connect(g); g.connect(this.delay); o.start(t); o.stop(t+1.5);
    }
  },
  blip(f0,f1,dur,type,vol){
    if(!this.ctx || this.ctx.state!=='running') return;
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
};

// ---------------- input ----------------
const Input = {
  l:false,r:false,u:false,d:false,jump:false,spin:false,run:false,
  jumpP:false,spinP:false,startP:false,musicP:false,anyP:false,
  padOn:false,padName:'',pad:null,_k:{},_pPrev:[],
  key(e,down){
    this._k[e.code]=down;
    if(down && !e.repeat){
      const c=e.code;
      if(c==='KeyZ'||c==='Space'||c==='ArrowUp'||c==='KeyW') this.jumpP=true;
      if(c==='KeyC'||c==='KeyB') this.spinP=true;
      if(c==='Enter'||c==='KeyP'||c==='Escape') this.startP=true;
      if(c==='KeyM') this.musicP=true;
      this.anyP=true;
    }
  },
  poll(){
    const k=this._k;
    let l=k.ArrowLeft||k.KeyA, r=k.ArrowRight||k.KeyD, u=k.ArrowUp||k.KeyW, d=k.ArrowDown||k.KeyS;
    let jump=k.KeyZ||k.Space||k.ArrowUp||k.KeyW;
    let spin=k.KeyC||k.KeyB;
    let run=k.KeyX||k.ShiftLeft||k.ShiftRight;
    let gp=null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for(const p of pads){ if(p && p.connected){ gp=p; break; } }
    if(gp){
      this.padOn=true; this.padName=gp.id; this.pad=gp;
      const b=gp.buttons, ax=gp.axes, dz=0.28;
      const bp=i=>!!(b[i]&&b[i].pressed);
      if(ax[0]<-dz||bp(14)) l=true;
      if(ax[0]> dz||bp(15)) r=true;
      if(ax[1]<-dz||bp(12)) u=true;
      if(ax[1]> dz||bp(13)) d=true;
      if(bp(0)) jump=true;                 // A
      if(bp(1)) spin=true;                 // B
      if(bp(2)||bp(5)||bp(7)) run=true;    // X / RB / RT
      const prev=this._pPrev, edge=i=>bp(i)&&!prev[i];
      if(edge(0)) this.jumpP=true;
      if(edge(1)) this.spinP=true;
      if(edge(9)) this.startP=true;        // Menu
      if(edge(3)) this.musicP=true;        // Y
      if(edge(0)||edge(9)) this.anyP=true;
      this._pPrev=[]; for(let i=0;i<b.length;i++) this._pPrev[i]=b[i].pressed;
    } else { this.pad=null; }
    this.l=!!l; this.r=!!r; this.u=!!u; this.d=!!d;
    this.jump=!!jump; this.spin=!!spin; this.run=!!run;
  },
  clear(){ this.jumpP=this.spinP=this.startP=this.musicP=this.anyP=false; }
};
window.addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if(e.code==='KeyF' && !e.repeat){ if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(()=>{}); }
  Input.key(e,true); Sound.unlock();
});
window.addEventListener('keyup',e=>Input.key(e,false));
window.addEventListener('mousedown',()=>Sound.unlock());
window.addEventListener('gamepadconnected',e=>{ Input.padOn=true; toast('🎮 controller connected'); });
window.addEventListener('gamepaddisconnected',()=>{ Input.padOn=false; toast('🎮 controller disconnected'); });
window.addEventListener('blur',()=>{ if(state==='play') state='pause'; });

function rumble(strong,weak,ms){
  try{
    const p=Input.pad;
    if(p && p.vibrationActuator) p.vibrationActuator.playEffect('dual-rumble',{duration:ms,strongMagnitude:strong,weakMagnitude:weak});
  }catch(e){}
}

// ---------------- level ----------------
// tiles: 0 air, 1 ground, 2 brick, 3 ?-block, 4 used, 5 pipe, 7 lotus pad (one-way)
const LW = 196;
let grid, blockItems, bonesArr, enemies, tipsArr, bounceAnim;
let checkpointX=92*TILE, checkpointHit=false, gateX=186*TILE, totalBones=0;

function tset(c,r,v){ if(c>=0&&c<LW&&r>=0&&r<ROWS) grid[r*LW+c]=v; }
function tget(c,r){ if(c<0||c>=LW) return 1; if(r<0||r>=ROWS) return 0; return grid[r*LW+c]; }
function isSolid(v){ return v===1||v===2||v===3||v===4||v===5; }
function groundCol(c,top){ for(let r=top;r<ROWS;r++) tset(c,r,1); }
function ground(c0,c1,top){ for(let c=c0;c<=c1;c++) groundCol(c,top); }
function pipe(c,top,gtop){ for(let r=top;r<gtop;r++){ tset(c,r,5); tset(c+1,r,5); } }
function qblock(c,r,item){ tset(c,r,3); blockItems[c+','+r]=item; }
function bricks(c0,c1,r){ for(let c=c0;c<=c1;c++) tset(c,r,2); }
function lotus(c0,c1,r){ for(let c=c0;c<=c1;c++) tset(c,r,7); }
function bone(c,r){ bonesArr.push({x:c*TILE+16,y:r*TILE+16,taken:false,t:Math.random()*6}); }
function bonesRow(c0,c1,r){ for(let c=c0;c<=c1;c++) bone(c,r); }
function shroomie(c){ enemies.push({type:'shroom',sx:c,x:c*TILE+4,y:0,w:24,h:22,vx:-0.8,vy:0,alive:true,active:false,dying:false,squash:1,hueOff:(c*37)%360}); }
function jelly(c,r){ enemies.push({type:'jelly',x:c*TILE+3,y:r*TILE+3,w:26,h:26,baseY:r*TILE+3,ph:(c*1.7)%TAU,alive:true,active:true,dying:false,squash:1,hueOff:(c*61)%360}); }
function tip(c,r,text){ tipsArr.push({x:c*TILE,y:r*TILE,text}); }
function groundTopAt(c){ for(let r=0;r<ROWS;r++) if(isSolid(tget(c,r))) return r*TILE; return ROWS*TILE; }

function buildLevel(){
  grid=new Uint8Array(LW*ROWS); blockItems={}; bonesArr=[]; enemies=[]; tipsArr=[]; bounceAnim={};
  // 1 — meadow of awakening
  ground(0,17,14);
  tip(4,10,'MOVE: stick / ←→ · JUMP: Ⓐ / Z · hold Ⓧ / SHIFT to RUN');
  bonesRow(8,10,13);
  qblock(12,10,'bone'); qblock(14,10,'shroom');
  // 2 — first void gap
  ground(20,36,14);
  bone(18,12); bone(19,12);
  shroomie(24); shroomie(29);
  tip(24,8,'bounce on the shroomies!');
  bricks(26,29,10); qblock(27,10,'bones5');
  pipe(33,12,14);
  // 3 — lotus crossing
  lotus(37,39,11);
  bonesRow(37,39,10);
  // 4 — breathing hills
  ground(40,45,13); ground(46,52,12); ground(53,58,13);
  qblock(49,8,'star');
  shroomie(47);
  jelly(55,10);
  tip(44,7,'SPIKY EYES hurt to stomp — SPIN-JUMP Ⓑ / C bounces them!');
  bonesRow(46,52,11);
  // 5 — run gap with rescue pad
  lotus(60,61,13);
  ground(63,93,14);
  // 6 — brick playground
  bricks(66,74,10);
  qblock(68,10,'bone'); qblock(71,10,'shroom'); qblock(73,10,'bone');
  bricks(69,71,7);
  bonesRow(69,71,6);
  bonesRow(66,74,13);
  shroomie(65); shroomie(77);
  jelly(80,10);
  // 7 — twin pipes
  pipe(82,12,14); pipe(87,11,14);
  jelly(85,8);
  bone(85,10); bone(86,10);
  // 8 — checkpoint then pillar void
  tip(90,10,'checkpoint ahead ✧');
  ground(96,97,12); ground(100,101,10); ground(104,105,12); ground(108,109,10); ground(112,113,11);
  lotus(98,99,14); lotus(106,107,14);
  tip(95,8,'trust the lotus pads');
  bonesRow(96,97,11); bonesRow(100,101,9); bonesRow(104,105,11); bonesRow(108,109,9); bonesRow(112,113,10);
  jelly(102,8);
  // 9 — gauntlet
  ground(115,131,14);
  shroomie(118); shroomie(121); shroomie(127);
  jelly(120,10); jelly(126,10);
  bricks(122,124,10); qblock(123,10,'star');
  shroomie(124); // roof walker
  bonesRow(116,130,13);
  // 10 — stairs to plateau, drop, gap
  groundCol(132,13); groundCol(133,12); groundCol(134,11); groundCol(135,10); groundCol(136,9); groundCol(137,9);
  ground(138,141,9);
  bonesRow(138,141,8);
  ground(142,150,14);
  bone(142,11); bone(143,13);
  bonesRow(151,154,11);
  // 11 — final hills
  ground(155,172,14);
  shroomie(158); shroomie(164);
  bonesRow(157,166,13);
  pipe(166,11,14);
  jelly(169,8); jelly(171,7);
  // 12 — ascension stairs and the gate
  groundCol(173,13); groundCol(174,12); groundCol(175,11); groundCol(176,10); groundCol(177,9); groundCol(178,9);
  ground(179,195,14);
  bonesRow(181,184,13);
  // settle walkers onto whatever they spawn above
  for(const e of enemies) if(e.type==='shroom'){
    const c=Math.floor((e.x+e.w/2)/TILE);
    e.y=groundTopAt(c)-e.h;
  }
  totalBones = bonesArr.length + 7; // + block bones (1+5+1... counted: bone,bones5,bone,bone = 8)
  totalBones = bonesArr.length + 8;
}

// ---------------- entities ----------------
const P = {
  x:3*TILE, y:0, w:34, h:26, vx:0, vy:0, dir:1,
  grounded:false, coyote:0, jbuf:0, jbufSpin:false, spinning:false, spinA:0,
  big:false, star:0, inv:0, hearts:3, bones:0, score:0, combo:0,
  runPhase:0, idleT:0, prevY:0,
};
let items=[], parts=[], floats=[], orbs=[];
let camX=0, gt=0, playT=0, winT=0, overT=0, titleT=0;
let trip=0.35, tripPulse=0;
let state='title';
let hiScore = +(localStorage.getItem('rueHigh')||0);

function setBig(b){
  const feet=P.y+P.h;
  P.big=b; P.h=b?32:26; P.w=b?36:34;
  P.y=feet-P.h;
}
function resetGame(){
  buildLevel();
  P.x=3*TILE; P.y=groundTopAt(3)-26; P.w=34; P.h=26; P.vx=0; P.vy=0; P.dir=1;
  P.big=false; P.star=0; P.inv=0; P.hearts=3; P.bones=0; P.score=0; P.combo=0;
  P.grounded=false; P.spinning=false; P.idleT=0;
  items=[]; parts=[]; floats=[];
  camX=0; playT=0; winT=0; overT=0;
  checkpointHit=false; tripPulse=0;
  orbs=[];
  for(let i=0;i<26;i++) orbs.push({x:Math.random()*LW*TILE, y:40+Math.random()*(H-160), r:2+Math.random()*5, p:0.25+Math.random()*0.4, hue:Math.random()*360, ph:Math.random()*TAU});
}

// ---------------- physics ----------------
const GRAV=0.42, MAXFALL=10, JV=9.8, SPINV=8.6;

function moveEntity(e, opts){
  opts=opts||{};
  const col={l:false,r:false,u:false,d:false,bumped:null};
  // horizontal
  e.x+=e.vx;
  let r0=Math.floor(e.y/TILE), r1=Math.floor((e.y+e.h-1)/TILE);
  if(e.vx>0){
    const c=Math.floor((e.x+e.w)/TILE);
    for(let r=r0;r<=r1;r++) if(isSolid(tget(c,r))){ e.x=c*TILE-e.w; e.vx=0; col.r=true; break; }
  } else if(e.vx<0){
    const c=Math.floor(e.x/TILE);
    for(let r=r0;r<=r1;r++) if(isSolid(tget(c,r))){ e.x=(c+1)*TILE; e.vx=0; col.l=true; break; }
  }
  // vertical
  const prevBottom=e.y+e.h;
  e.y+=e.vy;
  const c0=Math.floor(e.x/TILE), c1=Math.floor((e.x+e.w-1)/TILE);
  if(e.vy>0){
    const r=Math.floor((e.y+e.h)/TILE);
    for(let c=c0;c<=c1;c++){
      const t=tget(c,r);
      if(isSolid(t) || (t===7 && opts.oneway && prevBottom<=r*TILE+6)){
        e.y=r*TILE-e.h; e.vy=0; col.d=true; break;
      }
    }
  } else if(e.vy<0){
    const r=Math.floor(e.y/TILE);
    let best=null, bestOv=0;
    for(let c=c0;c<=c1;c++){
      const t=tget(c,r);
      if(isSolid(t)){
        const ov=Math.min(e.x+e.w,(c+1)*TILE)-Math.max(e.x,c*TILE);
        if(ov>bestOv){ bestOv=ov; best=[c,r,t]; }
      }
    }
    if(best){ e.y=(best[1]+1)*TILE; e.vy=0; col.u=true; col.bumped=best; }
  }
  return col;
}

function updatePlayer(){
  P.prevY=P.y;
  const maxSpd = Input.run?4.35:2.7;
  const accel = P.grounded?0.34:0.26;
  const before=Math.abs(P.vx);
  if(Input.l){ P.vx-=accel*(P.vx>0?1.7:1); P.dir=-1; }
  else if(Input.r){ P.vx+=accel*(P.vx<0?1.7:1); P.dir=1; }
  else if(P.grounded){ P.vx*=0.85; if(Math.abs(P.vx)<0.05)P.vx=0; }
  const spd=Math.abs(P.vx);
  // hard cap: accel can never push past max; carried speed decays smoothly
  if(spd>maxSpd) P.vx=Math.sign(P.vx)*(before>maxSpd?Math.max(maxSpd,before-0.12):maxSpd);
  // jump buffer + coyote
  if(Input.jumpP){ P.jbuf=7; P.jbufSpin=false; }
  if(Input.spinP){ P.jbuf=7; P.jbufSpin=true; }
  if(P.jbuf>0) P.jbuf--;
  if(P.grounded) P.coyote=6; else if(P.coyote>0) P.coyote--;
  if(P.jbuf>0 && P.coyote>0){
    P.jbuf=0; P.coyote=0; P.grounded=false;
    P.spinning=P.jbufSpin; P.spinA=0;
    P.vy=-(P.jbufSpin?SPINV:JV)-Math.abs(P.vx)*0.14;
    if(P.jbufSpin) Sound.spinS(); else Sound.jump();
    for(let i=0;i<6;i++) part(P.x+P.w/2,P.y+P.h,(Math.random()-0.5)*3,-Math.random()*1.5,0.5,`hsla(${(gt*80)%360},90%,75%,1)`,3,0.05);
  }
  if(!Input.jump && !Input.spin && P.vy<-3.6) P.vy=-3.6; // variable jump
  P.vy+=GRAV; if(P.vy>MAXFALL)P.vy=MAXFALL;
  const col=moveEntity(P,{oneway:true});
  P.grounded=col.d;
  if(col.u && col.bumped) hitBlock(col.bumped[0],col.bumped[1],col.bumped[2]);
  if(P.grounded){ P.spinning=false; P.combo=0; }
  if(P.spinning) P.spinA+=0.5;
  if(P.grounded && spd>0.2) P.runPhase+=spd*0.05;
  if(P.grounded && spd<0.1 && !Input.l && !Input.r) P.idleT+=1/60; else P.idleT=0;
  if(P.inv>0)P.inv--;
  if(P.star>0){ P.star--; if(P.star===0) toast('the glow fades…');
    if(P.star%3===0) part(P.x+P.w/2+(Math.random()-0.5)*20, P.y+P.h-4, (Math.random()-0.5)*1, -Math.random()*1, 0.7, `hsla(${(gt*300+Math.random()*90)%360},100%,70%,1)`, 4, -0.02);
  }
  // checkpoint
  if(!checkpointHit && P.x+P.w>checkpointX-6 && P.x<checkpointX+30){
    checkpointHit=true; Sound.heartS(); toast('checkpoint attuned ✧'); addTrip(0.35);
    for(let i=0;i<20;i++) part(checkpointX+12,groundTopAt(92)-24,(Math.random()-0.5)*4,-Math.random()*4,0.9,`hsla(${Math.random()*360},90%,70%,1)`,3,0.08);
  }
  // gate
  if(P.x+P.w/2>=gateX && state==='play'){
    state='win'; winT=0; P.vx=0; Sound.winS(); rumble(0.6,0.9,500);
    P.score+=Math.max(0,Math.round((300-playT))*10);
    if(P.score>hiScore){ hiScore=P.score; localStorage.setItem('rueHigh',hiScore); }
    mandalaBurst(gateX+16, groundTopAt(186)-120);
  }
  // pit
  if(P.y>H+60) pitDeath();
}

function hitBlock(c,r,t){
  const key=c+','+r;
  if(t===3){
    tset(c,r,4); bounceAnim[key]=10;
    const item=blockItems[key];
    const bx=c*TILE+16, by=r*TILE-10;
    if(item==='bone'){ collectBone(bx,by,1); }
    else if(item==='bones5'){ collectBone(bx,by,5); }
    else if(item==='shroom'){ items.push({type:'shroom',x:c*TILE+4,y:r*TILE,w:24,h:24,vx:1.3,vy:0,rise:28,hue:0}); Sound.power(); }
    else if(item==='star'){ items.push({type:'star',x:c*TILE+4,y:r*TILE,w:24,h:24,vx:1.6,vy:0,rise:28,hue:0}); Sound.power(); }
    rumble(0.2,0.5,90);
  } else if(t===2){
    if(P.big){
      tset(c,r,0); Sound.brick(); P.score+=50; rumble(0.5,0.8,140);
      for(let i=0;i<8;i++) part(c*TILE+16,r*TILE+16,(Math.random()-0.5)*6,-Math.random()*5-1,0.8,`hsla(${(gt*60+40)%360},70%,60%,1)`,5,0.3);
    } else { bounceAnim[key]=8; Sound.bump(); }
  }
}

function collectBone(x,y,n){
  P.bones+=n; P.score+=100*n;
  Sound.bone(); addTrip(0.12);
  floats.push({x,y,txt:n>1?`+${n} ✦`:'+100',t:1});
  for(let i=0;i<6*n;i++) part(x,y,(Math.random()-0.5)*4,-Math.random()*3-1,0.7,`hsla(${45+Math.random()*40},100%,70%,1)`,3,0.12);
  if(P.bones>=50 && (P.bones-n)<50 && P.hearts<5){ P.hearts++; Sound.heartS(); toast('❤ 50 bones — extra heart!'); }
  if(P.bones>=100 && (P.bones-n)<100 && P.hearts<5){ P.hearts++; Sound.heartS(); toast('❤ 100 bones — extra heart!'); }
}

function hurt(){
  if(P.inv>0||P.star>0) return;
  if(P.big){ setBig(false); P.inv=130; Sound.hurtS(); rumble(0.8,0.4,220); toast('ouch — the vision dims'); }
  else {
    P.hearts--; P.inv=140; Sound.hurtS(); rumble(1,0.6,320);
    P.vy=-5; P.vx=-P.dir*3;
    if(P.hearts<=0){ gameOver(); return; }
  }
  addTrip(0.5);
}
function pitDeath(){
  P.hearts--; Sound.hurtS(); rumble(1,1,420);
  if(P.hearts<=0){ gameOver(); return; }
  respawn();
}
function respawn(){
  const rx=checkpointHit?checkpointX:3*TILE;
  const rc=Math.floor(rx/TILE);
  P.x=rx; P.y=groundTopAt(rc)-P.h-2; P.vx=0; P.vy=0; P.inv=160;
  camX=clamp(P.x-W*0.38,0,LW*TILE-W);
  toast('the world reassembles itself…');
}
function gameOver(){
  state='over'; overT=0; Sound.overS();
  if(P.score>hiScore){ hiScore=P.score; localStorage.setItem('rueHigh',hiScore); }
}

function killEnemy(e){
  e.dying=true; e.alive=false;
  P.combo=Math.min(P.combo+1,8);
  const pts=200*P.combo;
  P.score+=pts;
  floats.push({x:e.x+e.w/2,y:e.y,txt:'+'+pts,t:1});
  Sound.stomp(); rumble(0.4,0.7,120); addTrip(0.2);
  for(let i=0;i<10;i++) part(e.x+e.w/2,e.y+e.h/2,(Math.random()-0.5)*5,-Math.random()*4,0.8,`hsla(${(e.hueOff+gt*120)%360},90%,65%,1)`,4,0.2);
}

function updateEnemies(){
  for(const e of enemies){
    if(e.dying){ e.squash-=0.05; continue; }
    if(!e.alive) continue;
    if(!e.active){ if(e.x<camX+W+96 && e.x>camX-320) e.active=true; else continue; }
    if(e.type==='shroom'){
      e.vy+=GRAV; if(e.vy>MAXFALL)e.vy=MAXFALL;
      const preVX = e.vx===0 ? (Math.random()<0.5?-0.8:0.8) : e.vx;
      e.vx=preVX;
      const col=moveEntity(e,{});
      if(col.l) e.vx=0.8; if(col.r) e.vx=-0.8;
      if(col.d){
        const fx=e.vx>0?e.x+e.w+3:e.x-3;
        const fc=Math.floor(fx/TILE), fr=Math.floor((e.y+e.h+6)/TILE);
        const below=tget(fc,fr);
        if(!isSolid(below)&&below!==7) e.vx=-e.vx;
      }
      if(e.y>H+80){ e.alive=false; continue; }
    } else { // jelly
      e.y=e.baseY+Math.sin(gt*2+e.ph)*22;
    }
    // vs player
    if(state!=='play') continue;
    if(P.x<e.x+e.w && P.x+P.w>e.x && P.y<e.y+e.h && P.y+P.h>e.y){
      if(P.star>0){ killEnemy(e); continue; }
      const stomp = P.vy>0.5 && (P.prevY+P.h)<=e.y+10;
      if(stomp){
        if(e.type==='jelly' && !P.spinning){ hurt(); P.vy=-6; }
        else{
          killEnemy(e);
          P.vy = P.spinning ? -8 : (Input.jump?-10.2:-6.5);
          P.y=e.y-P.h-1;
        }
      } else hurt();
    }
  }
  for(let i=enemies.length-1;i>=0;i--) if(enemies[i].dying && enemies[i].squash<=0) enemies.splice(i,1);
}

function updateItems(){
  for(let i=items.length-1;i>=0;i--){
    const it=items[i];
    if(it.rise>0){ it.y-=0.9; it.rise-=0.9; }
    else{
      it.vy+=GRAV; if(it.vy>MAXFALL)it.vy=MAXFALL;
      const pv=it.vx;
      const col=moveEntity(it,{});
      if(col.l||col.r) it.vx=-pv;
      if(col.d && it.type==='star') it.vy=-6.5;
      if(it.y>H+80){ items.splice(i,1); continue; }
    }
    it.hue=(it.hue+4)%360;
    // collect
    if(P.x<it.x+it.w && P.x+P.w>it.x && P.y<it.y+it.h && P.y+P.h>it.y && it.rise<=0){
      if(it.type==='shroom'){
        if(!P.big){ setBig(true); toast('✦ COSMIC KIBBLE — Rue awakens her third eye'); }
        P.score+=1000; floats.push({x:it.x,y:it.y,txt:'+1000',t:1});
        Sound.power(); rumble(0.5,0.5,300); addTrip(0.6);
      } else {
        P.star=8*60; P.score+=1000; floats.push({x:it.x,y:it.y,txt:'STARSEED!',t:1.2});
        Sound.starJ(); rumble(0.7,0.7,500); addTrip(1);
        toast('⭐ STARSEED — Rue is one with everything');
      }
      items.splice(i,1);
    }
  }
}

function updateBones(){
  for(const b of bonesArr){
    if(b.taken) continue;
    b.t+=1/60;
    const pad=8;
    if(P.x-pad<b.x+8 && P.x+P.w+pad>b.x-8 && P.y-pad<b.y+8 && P.y+P.h+pad>b.y-8){
      b.taken=true; collectBone(b.x,b.y,1);
    }
  }
}

// ---------------- particles / floats ----------------
function part(x,y,vx,vy,life,color,size,grav){
  if(parts.length>500) parts.shift();
  parts.push({x,y,vx,vy,l:life,l0:life,c:color,s:size,g:grav||0});
}
function mandalaBurst(x,y){
  for(let ring=0;ring<4;ring++) for(let i=0;i<28;i++){
    const a=i/28*TAU + ring*0.2, sp=2+ring*1.4;
    part(x,y,Math.cos(a)*sp,Math.sin(a)*sp,1.6,`hsla(${(ring*60+i*12)%360},95%,68%,1)`,4,0.02);
  }
}
function updateParts(){
  for(let i=parts.length-1;i>=0;i--){
    const p=parts[i];
    p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.l-=1/60;
    if(p.l<=0) parts.splice(i,1);
  }
  for(let i=floats.length-1;i>=0;i--){
    const f=floats[i]; f.y-=0.7; f.t-=1/60;
    if(f.t<=0) floats.splice(i,1);
  }
  for(let i=toasts.length-1;i>=0;i--){ toasts[i].t-=1/60; if(toasts[i].t<=0) toasts.splice(i,1); }
}
function addTrip(v){ tripPulse=Math.min(1,tripPulse+v); }

// ---------------- rendering (2D world layer) ----------------
let hue=0;
function render(){
  hue=(gt*14)%360;
  ctx.clearRect(0,0,W,H);
  drawHills();
  drawOrbs();
  drawTips();
  drawCheckpoint();
  drawGate();
  drawItems();     // behind tiles so they emerge from blocks
  drawTiles();
  drawBones();
  drawEnemies();
  drawPlayer();
  drawParts();
  drawFloats();
  drawHUD();
  if(state==='title') drawTitle();
  if(state==='pause') drawPause();
  if(state==='win') drawWin();
  if(state==='over') drawOver();
}

function drawHills(){
  const layers=[
    {p:0.25,amp:34,base:H-150,al:0.20,ho:140},
    {p:0.45,amp:52,base:H-95,al:0.30,ho:250},
  ];
  for(const L of layers){
    ctx.beginPath(); ctx.moveTo(0,H);
    for(let x=0;x<=W;x+=16){
      const y=L.base+Math.sin((x+camX*L.p)*0.008+gt*0.25)*L.amp*(1+0.2*Math.sin(gt*0.5))
              +Math.sin((x+camX*L.p)*0.021-gt*0.15)*L.amp*0.4;
      ctx.lineTo(x,y);
    }
    ctx.lineTo(W,H); ctx.closePath();
    ctx.fillStyle=`hsla(${(hue+L.ho)%360},60%,30%,${L.al})`;
    ctx.fill();
  }
}
function drawOrbs(){
  for(const o of orbs){
    const x=o.x-camX*o.p;
    if(x<-20||x>W+20) continue;
    const y=o.y+Math.sin(gt*0.8+o.ph)*14;
    ctx.fillStyle=`hsla(${(o.hue+hue*2)%360},95%,72%,${0.25+0.2*Math.sin(gt*2+o.ph)})`;
    ctx.beginPath(); ctx.arc(x,y,o.r*(1+0.3*Math.sin(gt*1.5+o.ph)),0,TAU); ctx.fill();
  }
}
function drawTips(){
  ctx.textAlign='center'; ctx.font='bold 15px Consolas, monospace';
  for(const t of tipsArr){
    const x=t.x-camX;
    if(x<-400||x>W+400) continue;
    const y=t.y+Math.sin(gt*1.4+t.x)*4;
    ctx.fillStyle=`hsla(${(hue*3)%360},100%,85%,0.9)`;
    ctx.fillText(t.text,x,y);
  }
}

function drawTiles(){
  const c0=Math.max(0,Math.floor(camX/TILE)-1), c1=Math.min(LW-1,Math.ceil((camX+W)/TILE)+1);
  for(let c=c0;c<=c1;c++){
    const wob=Math.sin(gt*1.8+c*0.45)*2.4*trip;
    for(let r=0;r<ROWS;r++){
      const t=tget(c,r);
      if(!t||t===0) continue;
      const key=c+','+r;
      let by=0;
      if(bounceAnim[key]>0){ bounceAnim[key]--; by=-Math.sin((10-bounceAnim[key])/10*Math.PI)*8; }
      const x=c*TILE-camX, y=r*TILE+wob+by;
      if(t===1){
        const top=!isSolid(tget(c,r-1));
        ctx.fillStyle=`hsl(${(hue+190)%360},52%,${top?40:29}%)`;
        ctx.fillRect(x,y,TILE+1,TILE+1);
        if(top){
          ctx.fillStyle=`hsl(${(hue+120)%360},85%,58%)`;
          ctx.fillRect(x,y,TILE+1,7);
          ctx.fillStyle=`hsla(${(hue+80)%360},100%,80%,0.95)`;
          ctx.fillRect(x,y,TILE+1,2.5);
        } else if((c*7+r*13)%5===0){
          ctx.fillStyle='rgba(0,0,0,0.18)';
          ctx.fillRect(x+8,y+10,6,6);
        }
      } else if(t===2){
        ctx.fillStyle=`hsl(${(hue+40)%360},55%,42%)`;
        ctx.fillRect(x+1,y+1,TILE-2,TILE-2);
        ctx.fillStyle='rgba(0,0,0,0.25)';
        ctx.fillRect(x+1,y+15,TILE-2,2); ctx.fillRect(x+15,y+1,2,14); ctx.fillRect(x+8,y+17,2,14);
        ctx.fillStyle='rgba(255,255,255,0.22)';
        ctx.fillRect(x+1,y+1,TILE-2,2);
      } else if(t===3){
        const pulse=55+12*Math.sin(gt*4+c);
        ctx.fillStyle=`hsl(46,95%,${pulse}%)`;
        ctx.fillRect(x+1,y+1,TILE-2,TILE-2);
        ctx.fillStyle='rgba(120,60,0,0.9)';
        ctx.font='bold 22px Consolas, monospace'; ctx.textAlign='center';
        ctx.fillText('?',x+16,y+24);
        ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2;
        ctx.strokeRect(x+2.5,y+2.5,TILE-5,TILE-5);
      } else if(t===4){
        ctx.fillStyle=`hsl(${(hue+220)%360},15%,32%)`;
        ctx.fillRect(x+1,y+1,TILE-2,TILE-2);
        ctx.fillStyle='rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(x+16,y+16,3,0,TAU); ctx.fill();
      } else if(t===5){
        const capHere=tget(c,r-1)!==5;
        const leftSide=tget(c-1,r)!==5;
        const g=ctx.createLinearGradient(x-(leftSide?0:TILE),y,x+(leftSide?TILE*2:TILE),y);
        g.addColorStop(0,`hsl(${(hue+300)%360},70%,38%)`);
        g.addColorStop(0.5,`hsl(${(hue+300)%360},85%,62%)`);
        g.addColorStop(1,`hsl(${(hue+300)%360},70%,32%)`);
        ctx.fillStyle=g;
        ctx.fillRect(x,y,TILE+1,TILE+1);
        if(capHere){
          ctx.fillStyle=`hsl(${(hue+330)%360},85%,55%)`;
          ctx.fillRect(x-(leftSide?4:-1),y-2,TILE+(leftSide?4:5),12);
          ctx.fillStyle='rgba(255,255,255,0.35)';
          ctx.fillRect(x-(leftSide?4:-1),y-2,TILE+(leftSide?4:5),3);
        }
      } else if(t===7){
        const g=ctx.createLinearGradient(x,y,x+TILE,y+12);
        g.addColorStop(0,`hsl(${(hue+150)%360},75%,65%)`);
        g.addColorStop(1,`hsl(${(hue+320)%360},80%,70%)`);
        ctx.fillStyle=g;
        rr(ctx,x+1,y+2,TILE-2,11,5);
        ctx.fillStyle=`hsla(${(hue+150)%360},100%,80%,${0.3+0.2*Math.sin(gt*3+c)})`;
        ctx.fillRect(x+4,y+14,TILE-8,3);
      }
    }
  }
}

function drawBones(){
  for(const b of bonesArr){
    if(b.taken) continue;
    const x=b.x-camX;
    if(x<-40||x>W+40) continue;
    const y=b.y+Math.sin(gt*2.4+b.t)*3;
    ctx.save(); ctx.translate(x,y); ctx.rotate(Math.sin(gt*1.6+b.t)*0.5);
    ctx.fillStyle=`hsla(${(hue*4)%360},90%,80%,0.35)`;
    ctx.beginPath(); ctx.arc(0,0,13,0,TAU); ctx.fill();
    ctx.fillStyle='#fdf8ee';
    ctx.fillRect(-7,-2.5,14,5);
    for(const [bx,byy] of [[-7,-4],[-7,4],[7,-4],[7,4]]){
      ctx.beginPath(); ctx.arc(bx,byy*0.9,4,0,TAU); ctx.fill();
    }
    ctx.restore();
  }
}

function drawEnemies(){
  for(const e of enemies){
    if(!e.alive && !e.dying) continue;
    const sx=e.x-camX;
    if(sx<-60||sx>W+60) continue;
    if(e.type==='shroom') drawShroom(e);
    else drawJelly(e);
  }
}
function drawShroom(e){
  const x=e.x-camX+e.w/2, y=e.y+e.h;
  const hueE=(hue*2+e.hueOff)%360;
  ctx.save(); ctx.translate(x,y);
  if(e.dying){ ctx.scale(1.35,Math.max(0.12,e.squash)); ctx.globalAlpha=Math.max(0,e.squash); }
  const step=e.dying?0:Math.sin(gt*11+e.hueOff)*2.4;
  ctx.fillStyle='#4a3a52';
  ctx.fillRect(-8+step,-4,6,4); ctx.fillRect(2-step,-4,6,4);
  ctx.fillStyle='#f3e9dc';
  rr(ctx,-9,-16,18,13,4);
  ctx.fillStyle='#241d20';
  ctx.fillRect(-5,-13,3,5); ctx.fillRect(2,-13,3,5);
  ctx.fillStyle='#fff';
  ctx.fillRect(-4,-12,1.4,1.4); ctx.fillRect(3,-12,1.4,1.4);
  const g=ctx.createLinearGradient(-15,-26,15,-12);
  g.addColorStop(0,`hsl(${hueE},85%,62%)`);
  g.addColorStop(1,`hsl(${(hueE+70)%360},85%,45%)`);
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.ellipse(0,-16,15,9.5,0,Math.PI,0); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.85)';
  for(const [dx,dy,r0] of [[-7,-20,2.2],[1,-23,2.6],[8,-19,1.8]]){
    ctx.beginPath(); ctx.arc(dx,dy,r0,0,TAU); ctx.fill();
  }
  ctx.restore();
}
function drawJelly(e){
  const x=e.x-camX+e.w/2, y=e.y+e.h/2;
  const hueE=(hue*3+e.hueOff)%360;
  ctx.save(); ctx.translate(x,y);
  if(e.dying){ ctx.scale(1.2,Math.max(0.1,e.squash)); ctx.globalAlpha=Math.max(0,e.squash); }
  ctx.fillStyle=`hsla(${hueE},95%,70%,0.25)`;
  ctx.beginPath(); ctx.arc(0,0,20,0,TAU); ctx.fill();
  // spikes on top
  ctx.fillStyle=`hsl(${(hueE+180)%360},60%,30%)`;
  for(const a of [-0.85,-0.5,-0.15]){
    const bx=Math.cos(a*Math.PI)*11, byy=Math.sin(a*Math.PI)*11;
    ctx.beginPath();
    ctx.moveTo(bx*0.8,byy*0.8);
    ctx.lineTo(bx*1.7,byy*1.7);
    ctx.lineTo(bx*0.8+4,byy*0.8+2);
    ctx.closePath(); ctx.fill();
  }
  // tentacles
  ctx.strokeStyle=`hsla(${hueE},80%,65%,0.8)`; ctx.lineWidth=2;
  for(let i=0;i<4;i++){
    const bx=-9+i*6;
    ctx.beginPath(); ctx.moveTo(bx,9);
    ctx.quadraticCurveTo(bx+Math.sin(gt*5+i)*4,16,bx+Math.sin(gt*5+i+1)*6,22);
    ctx.stroke();
  }
  // eyeball
  ctx.fillStyle='#f8f4ec'; ctx.beginPath(); ctx.arc(0,0,12,0,TAU); ctx.fill();
  ctx.fillStyle=`hsl(${hueE},90%,55%)`; ctx.beginPath(); ctx.arc(0,0,7,0,TAU); ctx.fill();
  const px=clamp((P.x-e.x)*0.02,-3,3);
  ctx.fillStyle='#1a1218'; ctx.beginPath(); ctx.arc(px,0,3.4,0,TAU); ctx.fill();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(px-1.4,-1.4,1.2,0,TAU); ctx.fill();
  ctx.restore();
}

function drawItems(){
  for(const it of items){
    const x=it.x-camX+it.w/2, y=it.y+it.h;
    ctx.save(); ctx.translate(x,y);
    if(it.type==='shroom'){
      ctx.fillStyle='#f6ecd9'; rr(ctx,-6,-13,12,12,3);
      const g=ctx.createLinearGradient(-12,-24,12,-10);
      g.addColorStop(0,`hsl(${(20+it.hue)%360},95%,60%)`);
      g.addColorStop(1,`hsl(${(320+it.hue)%360},95%,55%)`);
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.ellipse(0,-13,12,8,0,Math.PI,0); ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(0,-16,4,it.hue*0.05,it.hue*0.05+4.4); ctx.stroke();
    } else {
      ctx.rotate(it.hue*0.05);
      ctx.fillStyle=`hsl(${it.hue},100%,65%)`;
      ctx.beginPath();
      for(let i=0;i<10;i++){
        const rad=i%2===0?12:5, a=i/10*TAU-Math.PI/2;
        ctx.lineTo(Math.cos(a)*rad,Math.sin(a)*rad-10);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(-2,-12,2,0,TAU); ctx.fill();
    }
    ctx.restore();
  }
}

function drawCheckpoint(){
  const x=checkpointX-camX;
  if(x<-60||x>W+60) return;
  const gy=groundTopAt(92);
  ctx.save(); ctx.translate(x+12,gy);
  ctx.fillStyle=checkpointHit?`hsl(${(hue*3)%360},70%,55%)`:'#5a4e66';
  rr(ctx,-10,-48,20,48,6);
  ctx.fillStyle='#f8f4ec';
  ctx.beginPath(); ctx.ellipse(0,-34,7,checkpointHit?7:2,0,0,TAU); ctx.fill();
  if(checkpointHit){
    ctx.fillStyle=`hsl(${(hue*4)%360},90%,50%)`;
    ctx.beginPath(); ctx.arc(0,-34,3.6,0,TAU); ctx.fill();
    ctx.fillStyle=`hsla(${(hue*4)%360},90%,70%,0.4)`;
    ctx.beginPath(); ctx.arc(0,-34,12+2*Math.sin(gt*4),0,TAU); ctx.fill();
  }
  ctx.restore();
}

function drawGate(){
  const x=gateX-camX;
  if(x<-260||x>W+260) return;
  const gy=groundTopAt(186);
  const cx=x+16, cy=gy-118;
  // pillars
  for(const dx of [-74,58]){
    const g=ctx.createLinearGradient(x+dx,0,x+dx+18,0);
    g.addColorStop(0,`hsl(${(hue+260)%360},60%,30%)`);
    g.addColorStop(0.5,`hsl(${(hue+260)%360},75%,55%)`);
    g.addColorStop(1,`hsl(${(hue+260)%360},60%,28%)`);
    ctx.fillStyle=g;
    rr(ctx,x+dx,gy-190,18,190,8);
  }
  // the great eye
  const open=state==='win'?Math.min(1,winT*1.5):0.55+0.1*Math.sin(gt*1.2);
  const pulse=1+0.05*Math.sin(gt*2);
  ctx.save(); ctx.translate(cx,cy); ctx.scale(pulse,pulse);
  for(let i=5;i>=0;i--){
    ctx.fillStyle=`hsla(${(hue*2+i*40)%360},90%,${60-i*5}%,${0.16+i*0.05})`;
    ctx.beginPath(); ctx.arc(0,0,64-i*8,0,TAU); ctx.fill();
  }
  ctx.fillStyle='#f8f4ec';
  ctx.beginPath(); ctx.ellipse(0,0,42,30*open+4,0,0,TAU); ctx.fill();
  ctx.fillStyle=`hsl(${(hue*3)%360},90%,50%)`;
  ctx.beginPath(); ctx.arc(0,0,16*open+5,0,TAU); ctx.fill();
  ctx.fillStyle='#140a18';
  ctx.beginPath(); ctx.arc(0,0,(state==='win'?12:7)*open+2,0,TAU); ctx.fill();
  // rays
  ctx.strokeStyle=`hsla(${(hue*2)%360},100%,75%,${0.35+0.3*open})`; ctx.lineWidth=3;
  for(let i=0;i<12;i++){
    const a=i/12*TAU+gt*0.3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*70,Math.sin(a)*70);
    ctx.lineTo(Math.cos(a)*(84+6*Math.sin(gt*3+i)),Math.sin(a)*(84+6*Math.sin(gt*3+i)));
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------- Rue ----------------
const FUR={tan:'#c98f5f',tanD:'#a5714a',white:'#f6f1e7',pink:'#f2ddd0',spot:'#d9a06a',nose:'#241d20',muz:'#7b675c',eye:'#332218',mint:'#9adcc9',pinkH:'#e26fa4',tongue:'#e2708a',tailBand:'#6e5138'};
function furPal(){
  if(P.star>0){
    const h=(gt*420)%360;
    return {...FUR,tan:`hsl(${h},85%,66%)`,tanD:`hsl(${(h+50)%360},85%,55%)`,white:`hsl(${(h+180)%360},70%,90%)`,pink:`hsl(${(h+220)%360},70%,82%)`};
  }
  return FUR;
}
function drawPlayer(){
  if(P.inv>0 && Math.floor(gt*18)%2===0 && state==='play') return;
  const cx=P.x-camX+P.w/2, feet=P.y+P.h;
  const pal=furPal();
  const big=P.big;
  if(big){ // enlightened aura
    const g=ctx.createRadialGradient(cx,feet-20,4,cx,feet-20,40);
    g.addColorStop(0,`hsla(${(hue*4)%360},95%,70%,0.35)`);
    g.addColorStop(1,'hsla(0,0%,0%,0)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(cx,feet-20,40,0,TAU); ctx.fill();
  }
  const sitting = (P.idleT>4 || state==='title' || state==='win');
  if(sitting){ drawRueSit(cx,feet,pal,big); return; }
  drawRueSide(cx,feet,pal,big);
}
function drawRueSide(cx,feet,pal,big){
  const u=big?2.25:1.9;
  const spd=Math.abs(P.vx);
  ctx.save();
  ctx.translate(cx,feet);
  if(P.spinning){ ctx.translate(0,-9*u); ctx.rotate(P.spinA*P.dir); ctx.translate(0,9*u); }
  ctx.scale(P.dir,1);
  const R=(x,y,w,h,c)=>{ ctx.fillStyle=c; ctx.fillRect(x*u,y*u,w*u,h*u); };
  const air=!P.grounded;
  const rising=P.vy<-0.5;
  // tail (wags)
  const wag=Math.sin(gt*(spd>0.3?14:6))*1.6;
  R(-13.5,-12,2.5,2.5,pal.white);
  R(-16,-13.5+wag,3,3,'#fdfbf5');
  // legs
  const sw=air?0:Math.sin(P.runPhase*TAU)*(spd>0.2?2.4:0);
  if(air){
    if(rising){ R(-9,-5,2.4,4,pal.white); R(-5.5,-5,2.4,4,pal.white); R(5.5,-6,2.4,6,pal.white); R(9,-6,2.4,6,pal.white); }
    else { R(-10.5,-6,2.4,6,pal.white); R(-5,-4,2.4,4,pal.white); R(4,-4,2.4,4,pal.white); R(9.5,-6,2.4,6,pal.white); }
  } else {
    R(-10.5+sw,-6,2.4,6,pal.pink);
    R(-6.5-sw,-6,2.4,6,pal.white);
    R(4.5+sw*0.8,-6,2.4,6,pal.pink);
    R(8.5-sw*0.8,-6,2.4,6,pal.white);
  }
  // body
  R(-13,-11,2,6,pal.white);
  R(-12,-12,21,8,pal.white);
  R(-9,-12.8,9,3,pal.tan); // saddle patch
  // belly spots
  R(-6,-5.4,1.3,1.3,pal.spot); R(-2,-4.9,1.3,1.3,pal.spot); R(-8.5,-4.7,1,1,pal.spot);
  // harness (mint + pink, like the real one)
  R(0,-12.3,3,8.4,pal.mint);
  R(1.1,-12.3,0.9,8.4,pal.pinkH);
  // chest
  R(7,-11,4,7,pal.white);
  // head
  R(7,-19,10,8.6,pal.tan);
  // far ear
  const earUp=air;
  if(earUp){ R(7.6,-23.5,2.4,5,pal.tanD); } else { R(7.4,-20.8,2.6,2.2,pal.tanD); }
  // snout + nose
  R(14,-16.6,5.6,3.6,pal.white);
  R(18.4,-17.1,2.3,2.3,pal.nose);
  // mouth / tongue
  if(spd>3.4 && P.grounded){ R(15.5,-13.2,2,2.6,pal.tongue); }
  R(14.5,-13.4,3,0.8,pal.tanD);
  // eye
  R(11.3,-17.6,2.3,2.5,pal.eye);
  R(12.5,-17.3,0.9,0.9,'#fff');
  // near ear (floppy on ground, flies up in air)
  if(earUp){
    R(11.5,-24.5,2.8,6,pal.tanD);
    R(11.9,-23.9,1.4,4,pal.tan);
  } else {
    R(10.5,-21.4,3.4,2.4,pal.tanD);
    R(9,-19.8,2.8,2.8,pal.tanD);
  }
  // third eye when big
  if(big){ R(11,-19.8,1.6,1.6,'#ffd75e'); }
  ctx.restore();
}
function drawRueSit(cx,feet,pal,big){
  const u=big?2.25:1.9;
  ctx.save(); ctx.translate(cx,feet);
  const R=(x,y,w,h,c)=>{ ctx.fillStyle=c; ctx.fillRect(x*u,y*u,w*u,h*u); };
  const breathe=Math.sin(gt*2)*0.4;
  // haunches
  R(-8,-7,16,7,pal.white);
  // tail curled beside
  R(6.5,-4,4.5,2.4,pal.white); R(10,-5,2.4,2.4,'#fdfbf5');
  // upright body + belly
  R(-5.5,-16+breathe,11,10,pal.white);
  R(-3.8,-13.4+breathe,7.6,6.8,pal.pink);
  R(-2.5,-11.5,1.3,1.3,pal.spot); R(1,-12.6,1.3,1.3,pal.spot); R(-0.6,-9.4,1.3,1.3,pal.spot);
  // front paws tucked (the beg)
  R(-3.4,-9.6+breathe,2.4,3.4,pal.white); R(1.2,-9.6+breathe,2.4,3.4,pal.white);
  R(-3.4,-7+breathe,2.4,0.9,pal.spot); R(1.2,-7+breathe,2.4,0.9,pal.spot);
  // head (front view)
  R(-5.8,-25.5+breathe,11.6,9.6,pal.tan);
  // airplane ears
  R(-10.5,-26+breathe,4.8,3,pal.tanD);
  R(5.8,-26+breathe,4.8,3,pal.tanD);
  // blaze + muzzle
  R(-1.6,-22+breathe,3.2,6,pal.white);
  R(-2.8,-19.4+breathe,5.6,3.4,pal.white);
  // nose + mouth
  R(-1.1,-20.6+breathe,2.2,1.9,pal.nose);
  R(-0.5,-17.6+breathe,1,0.8,pal.tanD);
  // big soulful eyes
  R(-4.3,-23+breathe,2.2,2.6,pal.eye); R(2.1,-23+breathe,2.2,2.6,pal.eye);
  R(-3.3,-22.6+breathe,0.9,0.9,'#fff'); R(3.1,-22.6+breathe,0.9,0.9,'#fff');
  if(big){ R(-0.8,-25+breathe,1.6,1.6,'#ffd75e'); }
  ctx.restore();
}

function drawParts(){
  for(const p of parts){
    ctx.globalAlpha=Math.max(0,p.l/p.l0);
    ctx.fillStyle=p.c;
    ctx.beginPath(); ctx.arc(p.x-camX,p.y,p.s*(p.l/p.l0),0,TAU); ctx.fill();
  }
  ctx.globalAlpha=1;
}
function drawFloats(){
  ctx.font='bold 16px Consolas, monospace'; ctx.textAlign='center';
  for(const f of floats){
    ctx.globalAlpha=Math.max(0,f.t);
    ctx.fillStyle='#fff';
    ctx.fillText(f.txt,f.x-camX,f.y);
  }
  ctx.globalAlpha=1;
}

// ---------------- HUD ----------------
function drawHUD(){
  ctx.textAlign='left';
  // paw hearts
  for(let i=0;i<Math.max(3,P.hearts);i++){
    const x=22+i*30, y=24;
    const on=i<P.hearts;
    ctx.fillStyle=on?`hsl(${340+8*Math.sin(gt*3+i)},85%,62%)`:'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(x,y+3,7,0,TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x-6,y-4,3.4,0,TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x,y-6,3.4,0,TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x+6,y-4,3.4,0,TAU); ctx.fill();
  }
  // bones
  ctx.save(); ctx.translate(28,54);
  ctx.fillStyle='#fdf8ee';
  ctx.fillRect(-6,-2,12,4);
  for(const [bx,by] of [[-6,-3.4],[-6,3.4],[6,-3.4],[6,3.4]]){ ctx.beginPath(); ctx.arc(bx,by,3.2,0,TAU); ctx.fill(); }
  ctx.restore();
  ctx.font='bold 17px Consolas, monospace';
  ctx.fillStyle='#fff';
  ctx.fillText('× '+P.bones,44,60);
  // score & time (right)
  ctx.textAlign='right';
  ctx.fillText('SCORE '+P.score,W-20,30);
  const m=Math.floor(playT/60), s=Math.floor(playT%60);
  ctx.fillText('TIME '+m+':'+(s<10?'0':'')+s,W-20,54);
  // status row (bottom)
  ctx.font='13px Consolas, monospace';
  ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.textAlign='left';
  ctx.fillText(Input.padOn?'🎮 controller':'⌨ keyboard (connect an Xbox controller any time)',16,H-12);
  ctx.textAlign='right';
  ctx.fillText('M/Ⓨ music · F fullscreen · Start/P pause',W-16,H-12);
  // star timer
  if(P.star>0){
    ctx.fillStyle=`hsl(${(gt*300)%360},100%,65%)`;
    ctx.fillRect(W/2-80,14,160*(P.star/(8*60)),8);
    ctx.strokeStyle='rgba(255,255,255,0.6)';
    ctx.strokeRect(W/2-80,14,160,8);
  }
  // toasts
  ctx.textAlign='center'; ctx.font='bold 16px Consolas, monospace';
  toasts.forEach((t,i)=>{
    ctx.globalAlpha=clamp(t.t,0,1);
    ctx.fillStyle='#fff';
    ctx.fillText(t.txt,W/2,88+i*24);
  });
  ctx.globalAlpha=1;
}

// ---------------- overlays ----------------
function veil(a){ ctx.fillStyle=`rgba(8,2,20,${a})`; ctx.fillRect(0,0,W,H); }
function wavyTitle(txt,cx,cy,size){
  ctx.font=`bold ${size}px Consolas, monospace`;
  ctx.textAlign='center';
  const tw=ctx.measureText(txt).width;
  let x=cx-tw/2;
  ctx.textAlign='left';
  for(let i=0;i<txt.length;i++){
    const ch=txt[i];
    const w=ctx.measureText(ch).width;
    const yo=Math.sin(gt*2.2+i*0.55)*6;
    ctx.fillStyle=`hsl(${(hue*4+i*22)%360},95%,68%)`;
    ctx.fillText(ch,x,cy+yo);
    x+=w;
  }
  ctx.textAlign='center';
}
function drawTitle(){
  veil(0.45);
  wavyTitle("RUE'S PSYCHEDELIC ODYSSEY",W/2,150,44);
  ctx.font='italic 17px Consolas, monospace';
  ctx.fillStyle='rgba(255,255,255,0.85)';
  ctx.fillText('a very good girl crosses the cosmic veil',W/2,186);
  if(Math.sin(gt*3.5)>-0.4){
    ctx.font='bold 24px Consolas, monospace';
    ctx.fillStyle='#fff';
    ctx.fillText('press Ⓐ or ENTER to begin',W/2,400);
  }
  ctx.font='15px Consolas, monospace';
  ctx.fillStyle='rgba(255,255,255,0.7)';
  ctx.fillText('stick/←→ move · Ⓐ/Z jump · Ⓑ/C spin-jump · hold Ⓧ/SHIFT run · Ⓨ/M music',W/2,438);
  ctx.fillText('collect cosmic bones · bounce shroomies · spin off the spiky eyes · reach the Great Eye',W/2,462);
  if(hiScore>0){ ctx.fillStyle=`hsl(${(hue*3)%360},90%,70%)`; ctx.fillText('high score '+hiScore,W/2,492); }
  if(Sound.ctx && Sound.ctx.state==='suspended'){
    ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.fillText('(click or press a key once to enable sound)',W/2,516);
  }
}
function drawPause(){
  veil(0.5);
  wavyTitle('PAUSED',W/2,H/2-20,40);
  ctx.font='16px Consolas, monospace'; ctx.fillStyle='#fff'; ctx.textAlign='center';
  ctx.fillText('Start / P to resume',W/2,H/2+24);
}
function drawWin(){
  if(winT>1.2){
    veil(Math.min(0.5,(winT-1.2)*0.5));
    wavyTitle('RUE TRANSCENDS ✧',W/2,170,44);
    ctx.font='18px Consolas, monospace'; ctx.fillStyle='#fff'; ctx.textAlign='center';
    const m=Math.floor(playT/60), s=Math.floor(playT%60);
    ctx.fillText(`cosmic bones  ${P.bones} / ${totalBones}`,W/2,240);
    ctx.fillText(`time  ${m}:${(s<10?'0':'')+s}`,W/2,270);
    ctx.fillText(`score  ${P.score}${P.score>=hiScore?'  ★ new high!':''}`,W/2,300);
    if(winT>2.5 && Math.sin(gt*3.5)>-0.4){
      ctx.font='bold 20px Consolas, monospace';
      ctx.fillText('press Ⓐ / ENTER to journey again',W/2,370);
    }
  }
}
function drawOver(){
  veil(Math.min(0.6,overT*0.6));
  wavyTitle('THE TRIP FADES…',W/2,H/2-40,40);
  ctx.font='18px Consolas, monospace'; ctx.fillStyle='#fff'; ctx.textAlign='center';
  ctx.fillText('score '+P.score,W/2,H/2+8);
  if(overT>1 && Math.sin(gt*3.5)>-0.4) ctx.fillText('press Ⓐ / ENTER to wake up and try again',W/2,H/2+48);
}

// ---------------- update ----------------
function update(){
  gt+=1/60;
  Input.poll();
  if(Input.musicP) Sound.toggle();
  switch(state){
    case 'title':
      titleT+=1/60;
      if(Input.jumpP||Input.startP){ Sound.unlock(); resetGame(); state='play'; toast('go, Rue, go!'); }
      break;
    case 'play':
      playT+=1/60;
      if(Input.startP){ state='pause'; break; }
      updatePlayer();
      updateEnemies();
      updateItems();
      updateBones();
      // camera
      camX+=((P.x-W*0.38+P.vx*20)-camX)*0.1;
      camX=clamp(camX,0,LW*TILE-W);
      break;
    case 'pause':
      if(Input.startP) state='play';
      break;
    case 'win':
      winT+=1/60;
      if(winT<1.2 && Math.random()<0.3) mandalaBurstSmall();
      camX+=((gateX-W*0.5)-camX)*0.06;
      camX=clamp(camX,0,LW*TILE-W);
      if(winT>2.5 && (Input.jumpP||Input.startP)) state='title';
      break;
    case 'over':
      overT+=1/60;
      if(overT>1 && (Input.jumpP||Input.startP)) state='title';
      break;
  }
  // trip level easing
  let base=0.32+0.06*Math.sin(gt*0.23);
  if(P.star>0) base=1; else if(P.big) base+=0.14;
  if(state==='win') base=1;
  trip+=(clamp(base+tripPulse,0,1.25)-trip)*0.04;
  tripPulse*=0.97;
  updateParts();
  Input.clear();
}
function mandalaBurstSmall(){
  const a=Math.random()*TAU, d=60+Math.random()*120;
  mandalaBurst(gateX+16+Math.cos(a)*d, groundTopAt(186)-120+Math.sin(a)*d*0.5);
}

// ---------------- WebGL compositor ----------------
let gl, prog, tex, rect=[0,0,1,1], uni={};
const VSH=`attribute vec2 aP; void main(){ gl_Position=vec4(aP,0.,1.); }`;
const FSH=`
precision highp float;
uniform vec2 uRes; uniform float uT; uniform float uTrip; uniform float uCam; uniform float uWin;
uniform vec4 uRect; uniform sampler2D uTex;
vec3 pal(float t){ return 0.5+0.5*cos(6.28318*(t+vec3(0.0,0.33,0.67))); }
void main(){
  vec2 f=gl_FragCoord.xy;
  vec2 p=(f-0.5*uRes)/uRes.y;
  float t=uT;
  p.x+=uCam*0.00005;
  float r=length(p);
  float a=atan(p.y,p.x);
  float N=8.0+2.0*sin(t*0.05);
  float seg=6.28318/N;
  float af=mod(a+t*0.06,seg)-seg*0.5;
  vec2 k=vec2(cos(af),sin(af))*r;
  float w=0.0;
  w+=sin(k.x*9.0+t*0.7);
  w+=sin(k.y*11.0-t*0.9);
  w+=sin((k.x+k.y)*6.0+t*0.5);
  w+=sin(r*22.0-t*1.5)*1.2;
  vec3 col=pal(w*0.12+r*0.4-t*0.02)*(0.30+0.38*uTrip);
  float lat=abs(sin(p.x*26.0+sin(p.y*18.0+t*0.8)*1.6))*abs(sin(p.y*22.0-t*0.6+sin(p.x*14.0)*1.2));
  col+=vec3(1.0,0.75,0.35)*pow(max(0.0,1.0-lat),18.0)*(0.22+0.5*uTrip);
  float ir=exp(-r*1.8)*smoothstep(0.10,0.0,abs(sin(r*34.0-t*1.8))-0.06);
  col+=pal(r*2.0-t*0.05+0.5)*ir*(0.2+0.55*uTrip);
  col*=1.0-0.30*r;
  col*=0.88+0.12*sin(t*0.4);
  col+=pal(t*0.2)*uWin*exp(-r*1.2)*0.55*(0.5+0.5*sin(r*30.0-t*6.0));
  vec2 g=(f-uRect.xy)/uRect.zw;
  if(g.x>=0.0&&g.x<=1.0&&g.y>=0.0&&g.y<=1.0){
    float amp=0.0012+0.005*uTrip;
    vec2 wob=vec2(sin(g.y*20.0+t*2.0),cos(g.x*17.0-t*1.6))*amp;
    vec2 gg=clamp(g+wob,0.0,1.0);
    vec2 dir=gg-0.5;
    vec2 off=dir*(0.0012+0.007*uTrip);
    vec4 cc=texture2D(uTex,gg);
    float rr2=texture2D(uTex,clamp(gg+off,0.0,1.0)).r;
    float bb=texture2D(uTex,clamp(gg-off,0.0,1.0)).b;
    vec3 grgb=vec3(rr2,cc.g,bb);
    col=col*(1.0-cc.a)+grgb;
  }
  gl_FragColor=vec4(col,1.0);
}`;
function initGL(){
  gl=view.getContext('webgl',{antialias:false,alpha:false});
  if(!gl){ console.warn('WebGL unavailable — 2D fallback'); return; }
  function sh(type,src){
    const s=gl.createShader(type);
    gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }
  prog=gl.createProgram();
  gl.attachShader(prog,sh(gl.VERTEX_SHADER,VSH));
  gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FSH));
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,'aP');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  for(const n of ['uRes','uT','uTrip','uCam','uWin','uRect','uTex']) uni[n]=gl.getUniformLocation(prog,n);
  tex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.uniform1i(uni.uTex,0);
}
function resize(){
  const dpr=Math.min(window.devicePixelRatio||1,2);
  view.width=Math.floor(innerWidth*dpr);
  view.height=Math.floor(innerHeight*dpr);
  if(gl) gl.viewport(0,0,view.width,view.height);
  const s=Math.min(view.width/W,view.height/H);
  rect=[(view.width-W*s)/2,(view.height-H*s)/2,W*s,H*s];
}
window.addEventListener('resize',resize);
function glDraw(tSec){
  if(!gl){
    // fallback: plain 2D blit
    const c2=view.getContext('2d');
    c2.fillStyle='#0a0418'; c2.fillRect(0,0,view.width,view.height);
    c2.drawImage(game,rect[0],rect[1],rect[2],rect[3]);
    return;
  }
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,game);
  gl.uniform2f(uni.uRes,view.width,view.height);
  gl.uniform1f(uni.uT,tSec);
  gl.uniform1f(uni.uTrip,trip);
  gl.uniform1f(uni.uCam,camX);
  gl.uniform1f(uni.uWin,state==='win'?Math.min(1,winT):0);
  gl.uniform4f(uni.uRect,rect[0],rect[1],rect[2],rect[3]);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

// ---------------- main loop ----------------
let last=performance.now(), acc=0;
const STEP=1000/60;
function frame(now){
  requestAnimationFrame(frame);
  acc+=Math.min(100,now-last); last=now;
  let n=0;
  while(acc>=STEP&&n<5){ update(); acc-=STEP; n++; }
  render();
  glDraw(now/1000);
}

// ---------------- boot ----------------
resetGame();
initGL();
resize();
requestAnimationFrame(frame);

// debug hooks (for automated testing)
window.__g={ P, get state(){return state;}, set state(s){state=s;}, get camX(){return camX;},
  tp(x){ P.x=x; P.y=60; P.vy=0; camX=clamp(x-W*0.38,0,LW*TILE-W); },
  start(){ if(state==='title'){ resetGame(); state='play'; } } };
