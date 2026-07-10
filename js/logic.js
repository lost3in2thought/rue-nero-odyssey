/* ============================================================
   PAWS ENGINE — gameplay logic (renderer-agnostic)
   Fixed 60 Hz timestep. Logic space: x right, y DOWN, pixels.
   Supports 1-2 players: single, couch co-op (both simulated),
   or online co-op (players[0] local, players[1] mirrored from
   the network; the host owns enemies/items/world).
   In co-op the dream never drifts home — naps are instant.
   ============================================================ */
import {TILE,ROWS,VIEW_W as W,VIEW_H as H,TAU,clamp,Save,Sound,Input,CHARS} from './shared.js';

export const GRAV=0.42, MAXFALL=10;

function makePlayer(char,input,simulated){
  return {char,input,simulated,
    x:0,y:0,w:34,h:26,vx:0,vy:0,dir:1,grounded:false,coyote:0,jbuf:0,jbufSpin:false,
    spinning:false,spinA:0,big:false,star:0,inv:0,hearts:3,bones:0,balls:0,score:0,combo:0,
    runPhase:0,idleT:0,prevY:0,nx:0,ny:0};
}

export const G={
  mode:null, level:null, coop:null, players:[],
  LW:0, grid:null, blockItems:{}, bounceAnim:{}, itemSeq:0,
  bonesArr:[], ballsArr:[], enemies:[], tipsArr:[], items:[], parts:[], floats:[], toasts:[],
  camX:0, gt:0, playT:0, winT:0, overT:0,
  trip:0.35, tripPulse:0,
  state:'menu',
  checkpointHit:false, newBest:false,
  hooks:{},
  _ev:{},
  on(k,f){ (this._ev[k]||(this._ev[k]=[])).push(f); },
  off(k){ delete this._ev[k]; },
  emit(k,...a){ const l=this._ev[k]; if(l) for(const f of l) f(...a); },
  get P(){ return this.players[0]; },
  get char(){ return this.players[0]?this.players[0].char:CHARS.rue; },
};

export function tget(c,r){ if(c<0||c>=G.LW) return 1; if(r<0||r>=ROWS) return 0; return G.grid[r*G.LW+c]; }
export function isSolid(v){ return v===1||v===2||v===3||v===4||v===5; }
function tset(c,r,v){ if(c>=0&&c<G.LW&&r>=0&&r<ROWS) G.grid[r*G.LW+c]=v; }
export function groundTopAt(c){ for(let r=0;r<ROWS;r++) if(isSolid(tget(c,r))) return r*TILE; return ROWS*TILE; }

export function toast(txt){ G.toasts.push({txt,t:3.2}); if(G.toasts.length>3) G.toasts.shift(); }
function setState(s){ G.state=s; if(G.hooks.onState) G.hooks.onState(s); }
function buzz(p,s,w,ms){
  try{
    const pad=p&&p.input&&p.input.pad;
    if(pad&&pad.vibrationActuator) pad.vibrationActuator.playEffect('dual-rumble',{duration:ms,strongMagnitude:s,weakMagnitude:w});
  }catch(e){}
}
export function sumOf(field){ return G.players.reduce((a,p)=>a+p[field],0); }

// ---------------- level lifecycle ----------------
/** opts: charId string (single player) or
    {coop:'local'|'host'|'guest'|null, chars:[id,id?], inputs:[PlayerInput,...]} */
export function loadLevel(mode,levelDef,opts){
  if(typeof opts==='string'||!opts) opts={chars:[opts||Save.settings.char]};
  const L=levelDef.build();
  L.id=levelDef.id; L.name=levelDef.name; L.theme=levelDef.theme;
  G.mode=mode; G.level=L; G.coop=opts.coop||null;
  G.LW=L.LW; G.grid=L.grid; G.blockItems=L.blockItems; G.bounceAnim={}; G.itemSeq=0;
  G.bonesArr=L.bones; G.ballsArr=L.balls||[]; G.enemies=L.enemies; G.tipsArr=L.tips;
  G.enemies.forEach((e,i)=>{ e.id=i; e.gone=false; });
  G.items=[]; G.parts=[]; G.floats=[]; G.toasts.length=0;
  G.players=[];
  const chars=opts.chars, inputs=opts.inputs||[Input];
  chars.forEach((cid,i)=>{
    const sim=G.coop===null?true:(G.coop==='local'?true:i===0);
    const p=makePlayer(CHARS[cid]||CHARS.rue,sim?(inputs[i]||Input):null,sim);
    p.x=L.startX+i*44; p.y=L.startY; p.nx=p.x; p.ny=p.y;
    G.players.push(p);
  });
  G.camX=0; G.playT=0; G.winT=0; G.overT=0;
  G.checkpointHit=false; G.tripPulse=0; G.newBest=false;
  if(G.hooks.onWorldRebuild) G.hooks.onWorldRebuild();
  setState('play');
  toast(G.players.length>1?'go, good dogs, go!':`go, ${G.P.char.name}, go!`);
}

function setBig(p,b){
  const feet=p.y+p.h;
  p.big=b; p.h=b?32:26; p.w=b?36:34;
  p.y=feet-p.h;
}

// ---------------- particles ----------------
export function part(x,y,vx,vy,life,h,s,l,size,grav){
  if(G.parts.length>580) G.parts.shift();
  G.parts.push({x,y,vx,vy,l:life,l0:life,h,s,ll:l,sz:size,g:grav||0});
}
export function mandalaBurst(x,y){
  for(let ring=0;ring<4;ring++) for(let i=0;i<28;i++){
    const a=i/28*TAU+ring*0.2, sp=2+ring*1.4;
    part(x,y,Math.cos(a)*sp,Math.sin(a)*sp,1.6,(ring*60+i*12)%360,0.95,0.68,5,0.02);
  }
}
export function addTrip(v){ G.tripPulse=Math.min(1,G.tripPulse+v); }

// ---------------- collision ----------------
function moveEntity(e,opts){
  opts=opts||{};
  const col={l:false,r:false,u:false,d:false,bumped:null};
  e.x+=e.vx;
  let r0=Math.floor(e.y/TILE), r1=Math.floor((e.y+e.h-1)/TILE);
  if(e.vx>0){
    const c=Math.floor((e.x+e.w)/TILE);
    for(let r=r0;r<=r1;r++) if(isSolid(tget(c,r))){ e.x=c*TILE-e.w; e.vx=0; col.r=true; break; }
  } else if(e.vx<0){
    const c=Math.floor(e.x/TILE);
    for(let r=r0;r<=r1;r++) if(isSolid(tget(c,r))){ e.x=(c+1)*TILE; e.vx=0; col.l=true; break; }
  }
  const prevBottom=e.y+e.h;
  e.y+=e.vy;
  const c0=Math.floor(e.x/TILE), c1=Math.floor((e.x+e.w-1)/TILE);
  if(e.vy>0){
    const r=Math.floor((e.y+e.h)/TILE);
    for(let c=c0;c<=c1;c++){
      const t=tget(c,r);
      if(isSolid(t)||((t===7||t===8)&&opts.oneway&&prevBottom<=r*TILE+6)){
        e.y=r*TILE-e.h; e.vy=0; col.d=true; col.padT=t; break;
      }
    }
  } else if(e.vy<0){
    const r=Math.floor(e.y/TILE);
    let best=null,bestOv=0;
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

// ---------------- player ----------------
function updatePlayer(p){
  const st=p.char.stats, In=p.input;
  p.prevY=p.y;
  const maxSpd=In.run?st.run:st.walk;
  const accel=(p.grounded?st.accel:st.accel*0.78);
  const before=Math.abs(p.vx);
  if(In.l){ p.vx-=accel*(p.vx>0?1.7:1); p.dir=-1; }
  else if(In.r){ p.vx+=accel*(p.vx<0?1.7:1); p.dir=1; }
  else if(p.grounded){ p.vx*=st.fric; if(Math.abs(p.vx)<0.05)p.vx=0; }
  const spd=Math.abs(p.vx);
  if(spd>maxSpd) p.vx=Math.sign(p.vx)*(before>maxSpd?Math.max(maxSpd,before-0.12):maxSpd);
  if(In.jumpP){ p.jbuf=7; p.jbufSpin=false; }
  if(In.spinP){ p.jbuf=7; p.jbufSpin=true; }
  if(p.jbuf>0) p.jbuf--;
  if(p.grounded) p.coyote=6; else if(p.coyote>0) p.coyote--;
  if(p.jbuf>0&&p.coyote>0){
    p.jbuf=0; p.coyote=0; p.grounded=false;
    p.spinning=p.jbufSpin; p.spinA=0;
    p.vy=-(p.jbufSpin?st.jump*0.88:st.jump)-Math.abs(p.vx)*0.14;
    if(p.jbufSpin) Sound.spinS(); else Sound.jump();
    for(let i=0;i<8;i++) part(p.x+p.w/2,p.y+p.h,(Math.random()-0.5)*3,-Math.random()*1.5,0.5,(G.gt*80)%360,0.9,0.75,4,0.05);
  }
  if(!In.jump&&!In.spin&&p.vy<-3.6) p.vy=-3.6;
  p.vy+=GRAV; if(p.vy>MAXFALL)p.vy=MAXFALL;
  const col=moveEntity(p,{oneway:true});
  p.grounded=col.d;
  if(col.u&&col.bumped) hitBlock(col.bumped[0],col.bumped[1],col.bumped[2],p);
  if(col.d&&col.padT===8){
    p.vy=-(In.jump||In.spin?16.5:14);
    p.grounded=false; p.coyote=0;
    Sound.boing(); buzz(p,0.3,0.6,140); addTrip(0.12);
    for(let i=0;i<10;i++) part(p.x+p.w/2,p.y+p.h,(Math.random()-0.5)*4,-Math.random()*3,0.7,(100+Math.random()*60)%360,0.95,0.7,5,0.1);
  }
  if(p.grounded){ p.spinning=false; p.combo=0; }
  if(p.spinning) p.spinA+=0.45;
  if(p.grounded&&spd>0.2) p.runPhase+=spd*0.05;
  if(p.grounded&&spd<0.1&&!In.l&&!In.r) p.idleT+=1/60; else p.idleT=0;
  if(p.inv>0)p.inv--;
  if(p.star>0){ p.star--; if(p.star===0) toast('star sparkle all used up — zoomies remain!'); }
  // checkpoint
  const L=G.level;
  if(!G.checkpointHit&&p.x+p.w>L.checkpointX-6&&p.x<L.checkpointX+30){
    G.checkpointHit=true; Sound.heartS(); toast('checkpoint attuned ✧'); addTrip(0.35);
    for(let i=0;i<24;i++) part(L.checkpointX+12,L.cpY-30,(Math.random()-0.5)*4,-Math.random()*4,1.0,Math.random()*360,0.9,0.7,4,0.08);
  }
  // gate
  if(p.x+p.w/2>=L.gateX&&G.state==='play') triggerWin(true);
  if(p.y>H+60) pitFall(p);
}
function cosmetics(p){
  if(p.star>0&&Math.floor(G.gt*30)%2===0)
    part(p.x+p.w/2+(Math.random()-0.5)*24,p.y+p.h-6,(Math.random()-0.5)*1,-Math.random()*1,0.8,(G.gt*300+Math.random()*90)%360,1,0.7,5,-0.02);
}
function lerpRemote(p){
  p.x+=(p.nx-p.x)*0.35;
  p.y+=(p.ny-p.y)*0.35;
  if(p.spinning) p.spinA+=0.45;
  if(p.inv>0) p.inv--;
}

function triggerWin(byLocal){
  if(G.state!=='play') return;
  const L=G.level;
  G.winT=0;
  if(byLocal){
    G.players[0].score+=Math.max(0,Math.round((300-G.playT))*10);
    G.emit('net','win',{});
  }
  G.newBest=Save.recordWin(L.id,sumOf('score'),sumOf('bones'),G.playT,Math.min(5,sumOf('balls')));
  Sound.winS(); buzz(G.players[0],0.6,0.9,500);
  mandalaBurst(L.gateX+16,L.gateY-120);
  setState('win');
}

function hitBlock(c,r,t,p){
  const key=c+','+r;
  if(t===3){
    tset(c,r,4); G.bounceAnim[key]=10;
    if(G.hooks.onBlockUsed) G.hooks.onBlockUsed(key);
    buzz(p,0.2,0.5,90);
    G.emit('net','block',{key});
    if(G.coop==='guest') return;            // the host resolves contents & credits us
    resolveBlock(key,c,r,p,true);
  } else if(t===2){
    if(p.big){
      tset(c,r,0); Sound.brick(); p.score+=50; buzz(p,0.5,0.8,140);
      if(G.hooks.onBrickBreak) G.hooks.onBrickBreak(key);
      G.emit('net','brick',{key});
      for(let i=0;i<10;i++) part(c*TILE+16,r*TILE+16,(Math.random()-0.5)*6,-Math.random()*5-1,0.9,(G.gt*60+40)%360,0.75,0.6,6,0.3);
    } else { G.bounceAnim[key]=8; Sound.bump(); }
  }
}
function resolveBlock(key,c,r,p,local){
  const item=G.blockItems[key];
  const bx=c*TILE+16, by=r*TILE-10;
  if(item==='bone'){ if(local) collectBone(p,bx,by,1); else G.emit('net','credit',{bones:1,points:100}); }
  else if(item==='bones5'){ if(local) collectBone(p,bx,by,5); else G.emit('net','credit',{bones:5,points:500}); }
  else if(item==='shroom'){ G.items.push({id:G.itemSeq++,type:'shroom',x:c*TILE+4,y:r*TILE,w:24,h:24,vx:1.3,vy:0,rise:28,hue:0}); Sound.power(); }
  else if(item==='star'){ G.items.push({id:G.itemSeq++,type:'star',x:c*TILE+4,y:r*TILE,w:24,h:24,vx:1.6,vy:0,rise:28,hue:0}); Sound.power(); }
}

function collectBone(p,x,y,n){
  p.bones+=n; p.score+=100*n;
  Sound.bone(); addTrip(0.12);
  G.floats.push({x,y,txt:n>1?`+${n} ✦`:'+100',t:1});
  for(let i=0;i<6*n;i++) part(x,y,(Math.random()-0.5)*4,-Math.random()*3-1,0.7,45+Math.random()*40,1,0.7,4,0.12);
  if(p.bones>=50&&(p.bones-n)<50&&p.hearts<5){ p.hearts++; Sound.heartS(); toast('❤ 50 bones — extra heart!'); }
  if(p.bones>=100&&(p.bones-n)<100&&p.hearts<5){ p.hearts++; Sound.heartS(); toast('❤ 100 bones — extra heart!'); }
}

function hurt(p){
  if(p.inv>0||p.star>0) return;
  if(p.big){ setBig(p,false); p.inv=130; Sound.hurtS(); buzz(p,0.8,0.4,220); toast('bonk! the cosmic kibble wore off'); }
  else{
    p.hearts--; p.inv=140; Sound.hurtS(); buzz(p,1,0.6,320);
    p.vy=-5; p.vx=-p.dir*3;
    if(p.hearts<=0){
      if(G.coop){ quickNap(p); }
      else { dreamHome(); }
      return;
    }
  }
  addTrip(0.5);
}
function pitFall(p){
  p.hearts--; Sound.hurtS(); buzz(p,1,1,420);
  if(p.hearts<=0){
    if(G.coop){ quickNap(p); return; }
    dreamHome(); return;
  }
  respawn(p);
}
function quickNap(p){
  // co-op is endless: a quick nap, then right back to the zoomies
  p.hearts=3; p.score=Math.max(0,p.score-500);
  toast(`${p.char.name} took a quick nap — back to the zoomies!`);
  respawn(p);
}
function respawn(p){
  const L=G.level;
  const buddy=G.coop==='local'?G.players.find(q=>q!==p&&q.y<H):null;
  if(buddy){
    p.x=buddy.x; p.y=Math.max(20,buddy.y-40);
  } else {
    const rx=G.checkpointHit?L.checkpointX:L.startX;
    const rc=Math.floor((rx+p.w/2)/TILE);
    p.x=rx; p.y=groundTopAt(rc)-p.h-2;
  }
  p.vx=0; p.vy=0; p.inv=160;
  if(p===G.players[0]||!G.coop) G.camX=clamp(G.players[0].x-W*0.38,0,G.LW*TILE-W);
  for(let i=0;i<14;i++) part(p.x+p.w/2,p.y+p.h/2,(Math.random()-0.5)*4,-Math.random()*3,0.8,Math.random()*360,0.9,0.72,4,0.05);
  toast('the world reassembles itself…');
}
function dreamHome(){
  G.overT=0; Sound.overS();
  setState('over');
}

// ---------------- enemies ----------------
function killEnemy(e,p,credit){
  if(!e.alive&&e.dying) return;
  e.dying=true; e.alive=false;
  if(credit&&p){
    p.combo=Math.min(p.combo+1,8);
    const pts=200*p.combo;
    p.score+=pts;
    G.floats.push({x:e.x+e.w/2,y:e.y,txt:'+'+pts,t:1});
    G.emit('net','stomp',{i:e.id});
  }
  Sound.stomp(); if(p) buzz(p,0.4,0.7,120);
  addTrip(0.2);
  for(let i=0;i<12;i++) part(e.x+e.w/2,e.y+e.h/2,(Math.random()-0.5)*5,-Math.random()*4,0.9,(e.hueOff+G.gt*120)%360,0.9,0.65,5,0.2);
}

function collideEnemies(p){
  if(G.state!=='play') return;
  for(const e of G.enemies){
    if(!e.alive||e.gone) continue;
    if(p.x<e.x+e.w&&p.x+p.w>e.x&&p.y<e.y+e.h&&p.y+p.h>e.y){
      if(p.star>0){ killEnemy(e,p,true); continue; }
      const stomp=p.vy>0.5&&(p.prevY+p.h)<=e.y+10;
      if(stomp){
        if(e.type==='jelly'&&!p.spinning){ hurt(p); p.vy=-6; }
        else{
          killEnemy(e,p,true);
          p.vy=p.spinning?-8:(p.input&&p.input.jump?-10.2:-6.5);
          p.y=e.y-p.h-1;
        }
      } else hurt(p);
    }
  }
}

function updateEnemies(){
  const anyX=G.players.map(p=>p.x);
  for(const e of G.enemies){
    if(e.gone) continue;
    if(e.dying){
      e.squash-=0.05;
      if(e.squash<=0){
        e.dying=false; e.gone=true;
        if(G.hooks.onEnemyGone) G.hooks.onEnemyGone(e);
      }
      continue;
    }
    if(!e.alive) continue;
    if(!e.active){
      if(anyX.some(x=>e.x<x+W+96&&e.x>x-W-96)||e.x<G.camX+W+96&&e.x>G.camX-320) e.active=true;
      else continue;
    }
    if(e.type==='shroom'){
      e.vy+=GRAV; if(e.vy>MAXFALL)e.vy=MAXFALL;
      if(e.vx===0) e.vx=Math.random()<0.5?-0.8:0.8;
      const col=moveEntity(e,{});
      if(col.l) e.vx=0.8; if(col.r) e.vx=-0.8;
      if(col.d){
        const fx=e.vx>0?e.x+e.w+3:e.x-3;
        const fc=Math.floor(fx/TILE), fr=Math.floor((e.y+e.h+6)/TILE);
        const below=tget(fc,fr);
        if(!isSolid(below)&&below!==7) e.vx=-e.vx;
      }
      if(e.y>H+80){ e.alive=false; e.gone=true; if(G.hooks.onEnemyGone) G.hooks.onEnemyGone(e); continue; }
    } else {
      e.y=e.baseY+Math.sin(G.gt*2+e.ph)*22;
    }
  }
}
function guestEnemies(){
  for(const e of G.enemies){
    if(e.gone) continue;
    if(e.tx!==undefined){ e.x+=(e.tx-e.x)*0.4; e.y+=(e.ty-e.y)*0.4; }
    if(!e.alive){
      e.dying=true; e.squash-=0.05;
      if(e.squash<=0){ e.dying=false; e.gone=true; if(G.hooks.onEnemyGone) G.hooks.onEnemyGone(e); }
    }
  }
}

// ---------------- items ----------------
function removeItem(i){
  const it=G.items[i];
  if(G.hooks.onItemGone) G.hooks.onItemGone(it);
  G.items.splice(i,1);
}
function applyItem(p,it){
  if(it.type==='shroom'){
    if(!p.big){ setBig(p,true); toast('✦ COSMIC KIBBLE — the third eye awakens'); }
    p.score+=1000; G.floats.push({x:it.x,y:it.y,txt:'+1000',t:1});
    Sound.power(); buzz(p,0.5,0.5,300); addTrip(0.6);
  } else {
    p.star=8*60; p.score+=1000; G.floats.push({x:it.x,y:it.y,txt:'STARSEED!',t:1.2});
    Sound.starJ(); buzz(p,0.7,0.7,500); addTrip(1);
    toast('⭐ STARSEED — one with everything');
  }
}
function updateItems(){
  for(let i=G.items.length-1;i>=0;i--){
    const it=G.items[i];
    if(it.rise>0){ it.y-=0.9; it.rise-=0.9; }
    else{
      it.vy+=GRAV; if(it.vy>MAXFALL)it.vy=MAXFALL;
      const pv=it.vx;
      const col=moveEntity(it,{});
      if(col.l||col.r) it.vx=-pv;
      if(col.d&&it.type==='star') it.vy=-6.5;
      if(it.y>H+80){ removeItem(i); continue; }
    }
    it.hue=(it.hue+4)%360;
    for(const p of G.players){
      if(!p.simulated) continue;
      if(p.x<it.x+it.w&&p.x+p.w>it.x&&p.y<it.y+it.h&&p.y+p.h>it.y&&it.rise<=0){
        applyItem(p,it);
        G.emit('net','itemGone',{id:it.id});
        removeItem(i);
        break;
      }
    }
  }
}
function guestItems(){
  const p=G.players[0];
  for(let i=G.items.length-1;i>=0;i--){
    const it=G.items[i];
    if(it.tx!==undefined){ it.x+=(it.tx-it.x)*0.4; it.y+=(it.ty-it.y)*0.4; }
    it.hue=(it.hue+4)%360;
    if(it.rise<=0&&p.x<it.x+it.w&&p.x+p.w>it.x&&p.y<it.y+it.h&&p.y+p.h>it.y){
      applyItem(p,it);
      G.emit('net','itemTake',{id:it.id});
      removeItem(i);
    }
  }
}

// ---------------- pickups ----------------
function updatePickups(){
  for(const p of G.players){
    if(!p.simulated) continue;
    for(let i=0;i<G.bonesArr.length;i++){
      const b=G.bonesArr[i];
      if(b.taken) continue;
      const pad=8;
      if(p.x-pad<b.x+8&&p.x+p.w+pad>b.x-8&&p.y-pad<b.y+8&&p.y+p.h+pad>b.y-8){
        b.taken=true; collectBone(p,b.x,b.y,1);
        G.emit('net','bone',{i});
      }
    }
    for(let i=0;i<G.ballsArr.length;i++){
      const bl=G.ballsArr[i];
      if(bl.taken) continue;
      const pad=12;
      if(p.x-pad<bl.x+10&&p.x+p.w+pad>bl.x-10&&p.y-pad<bl.y+10&&p.y+p.h+pad>bl.y-10){
        bl.taken=true;
        p.balls++; p.score+=1000;
        Sound.squeak(); buzz(p,0.3,0.8,200); addTrip(0.3);
        G.floats.push({x:bl.x,y:bl.y,txt:'🎾 +1000',t:1.2});
        for(let j=0;j<16;j++) part(bl.x,bl.y,(Math.random()-0.5)*5,-Math.random()*4,1.0,70+Math.random()*30,0.95,0.7,5,0.1);
        if(sumOf('balls')>=5) toast('🎾 all five tennis balls! very good dogs!');
        G.emit('net','ball',{i});
      }
    }
  }
  for(const b of G.bonesArr) if(!b.taken) b.t+=1/60;
  for(const bl of G.ballsArr) if(!bl.taken) bl.t+=1/60;
}

function updateParts(){
  for(let i=G.parts.length-1;i>=0;i--){
    const p=G.parts[i];
    p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.l-=1/60;
    if(p.l<=0) G.parts.splice(i,1);
  }
  for(let i=G.floats.length-1;i>=0;i--){
    const f=G.floats[i]; f.y-=0.7; f.t-=1/60;
    if(f.t<=0) G.floats.splice(i,1);
  }
  for(let i=G.toasts.length-1;i>=0;i--){ G.toasts[i].t-=1/60; if(G.toasts[i].t<=0) G.toasts.splice(i,1); }
}

// ---------------- camera ----------------
function updateCamera(){
  let focus=G.players[0];
  if(G.coop==='local'){
    for(const p of G.players) if(p.x>focus.x) focus=p;
    // catch-up zoomies: nobody gets left behind
    for(const p of G.players){
      if(p===focus) continue;
      if(p.x<G.camX-80){
        p.x=focus.x-30; p.y=Math.max(20,focus.y-40); p.vx=0; p.vy=0; p.inv=Math.max(p.inv,40);
        for(let i=0;i<10;i++) part(p.x+p.w/2,p.y+p.h/2,(Math.random()-0.5)*4,-Math.random()*3,0.7,(180+Math.random()*90)%360,0.9,0.7,4,0.05);
      }
    }
  }
  G.camX+=((focus.x-W*0.38+focus.vx*20)-G.camX)*0.1;
  G.camX=clamp(G.camX,0,G.LW*TILE-W);
}

// ---------------- top-level update ----------------
export function update(){
  if(G.state==='menu'||G.state==='pause') return;
  G.gt+=1/60;
  switch(G.state){
    case 'play':
      G.playT+=1/60;
      for(const p of G.players){
        if(p.simulated) updatePlayer(p); else lerpRemote(p);
        cosmetics(p);
      }
      if(G.coop==='guest'){ guestEnemies(); guestItems(); }
      else { updateEnemies(); updateItems(); }
      for(const p of G.players) if(p.simulated) collideEnemies(p);
      updatePickups();
      updateCamera();
      break;
    case 'win':
      G.winT+=1/60;
      if(G.winT<1.4&&Math.random()<0.35){
        const a=Math.random()*TAU, d=60+Math.random()*130;
        mandalaBurst(G.level.gateX+16+Math.cos(a)*d,G.level.gateY-120+Math.sin(a)*d*0.5);
      }
      G.camX+=((G.level.gateX-W*0.5)-G.camX)*0.06;
      G.camX=clamp(G.camX,0,G.LW*TILE-W);
      if(G.coop==='guest') guestEnemies(); else updateEnemies();
      break;
    case 'over':
      G.overT+=1/60;
      break;
  }
  const tripScale=Save.settings.trip;
  let base=0.30+0.06*Math.sin(G.gt*0.23);
  if(G.players.some(p=>p.star>0)) base=1; else if(G.players.some(p=>p.big)) base+=0.14;
  if(G.state==='win') base=1;
  G.trip+=(clamp((base+G.tripPulse)*tripScale,0,1.25)-G.trip)*0.04;
  G.tripPulse*=0.97;
  for(const k in G.bounceAnim){ if(G.bounceAnim[k]>0) G.bounceAnim[k]--; }
  updateParts();
}

/* ============================================================
   NET OPERATIONS — called by js/net.js when messages arrive
   ============================================================ */
export function packState(){
  const p=G.players[0];
  return [Math.round(p.x+p.w/2),Math.round(p.y+p.h),+p.vx.toFixed(2),+p.vy.toFixed(2),p.dir,
          p.grounded?1:0,p.spinning?1:0,+p.spinA.toFixed(2),+p.runPhase.toFixed(2),
          p.big?1:0,p.star,p.inv,p.hearts,p.score,p.bones,p.balls,+p.idleT.toFixed(1)];
}
export function netState(a){
  const p=G.players[1]; if(!p) return;
  const big=!!a[9];
  if(big!==p.big){ p.big=big; p.h=big?32:26; p.w=big?36:34; }
  p.nx=a[0]-p.w/2; p.ny=a[1]-p.h;
  p.vx=a[2]; p.vy=a[3]; p.dir=a[4]; p.grounded=!!a[5]; p.spinning=!!a[6]; p.spinA=a[7];
  p.runPhase=a[8]; p.star=a[10]; p.inv=a[11]; p.hearts=a[12]; p.score=a[13]; p.bones=a[14]; p.balls=a[15]; p.idleT=a[16];
}
export function packWorld(){
  return {e:G.enemies.map(e=>[Math.round(e.x),Math.round(e.y),e.alive?1:0,+Math.max(0,e.squash).toFixed(2)]),
          i:G.items.map(it=>[it.id,it.type==='star'?1:0,Math.round(it.x),Math.round(it.y),Math.round(it.rise)])};
}
export function netWorld(m){
  m.e.forEach((a,i)=>{
    const e=G.enemies[i]; if(!e||e.gone) return;
    e.tx=a[0]; e.ty=a[1];
    if(e._ni===undefined){ e.x=a[0]; e.y=a[1]; e._ni=1; }
    if(!a[2]&&e.alive) e.alive=false;
    if(!e.alive) e.squash=Math.min(e.squash,a[3]);
  });
  const seen=new Set();
  for(const a of m.i){
    seen.add(a[0]);
    let it=G.items.find(x=>x.id===a[0]);
    if(!it){ it={id:a[0],type:a[1]?'star':'shroom',x:a[2],y:a[3],w:24,h:24,vx:0,vy:0,rise:a[4],hue:0}; G.items.push(it); }
    it.tx=a[2]; it.ty=a[3]; it.rise=a[4];
  }
  for(let j=G.items.length-1;j>=0;j--) if(!seen.has(G.items[j].id)) removeItem(j);
}
export function netBone(i){ const b=G.bonesArr[i]; if(b&&!b.taken){ b.taken=true; } }
export function netBall(i){ const b=G.ballsArr[i]; if(b&&!b.taken){ b.taken=true; } }
export function netBlock(key){
  const [c,r]=key.split(',').map(Number);
  if(tget(c,r)===3){
    tset(c,r,4); G.bounceAnim[key]=10;
    if(G.hooks.onBlockUsed) G.hooks.onBlockUsed(key);
    if(G.coop==='host') resolveBlock(key,c,r,null,false);  // credit goes back to the guest
  }
}
export function netBrick(key){
  const [c,r]=key.split(',').map(Number);
  if(tget(c,r)===2){
    tset(c,r,0);
    if(G.hooks.onBrickBreak) G.hooks.onBrickBreak(key);
  }
}
export function netStomp(i){
  const e=G.enemies.find(x=>x.id===i);
  if(e&&e.alive) killEnemy(e,null,false);
}
export function netItemTake(id){
  const j=G.items.findIndex(x=>x.id===id);
  if(j>=0) removeItem(j);
}
export function netCredit(d){
  const p=G.players[0];
  collectBone(p,p.x+p.w/2,p.y,d.bones||0);
}
export function netWin(){ triggerWin(false); }
