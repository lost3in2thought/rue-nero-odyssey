/* ============================================================
   PAWS ENGINE — gameplay logic (renderer-agnostic)
   Fixed 60 Hz timestep. Logic space: x right, y DOWN, pixels.
   Renderers read state from G; renderer-specific reactions go
   through G.hooks.
   ============================================================ */
import {TILE,ROWS,VIEW_W as W,VIEW_H as H,TAU,clamp,Save,Sound,Input,rumble,CHARS} from './shared.js';

export const GRAV=0.42, MAXFALL=10;

export const G={
  mode:null, level:null, char:CHARS.rue, LW:0, grid:null, blockItems:{}, bounceAnim:{},
  bonesArr:[], enemies:[], tipsArr:[], items:[], parts:[], floats:[], toasts:[],
  P:{x:0,y:0,w:34,h:26,vx:0,vy:0,dir:1,grounded:false,coyote:0,jbuf:0,jbufSpin:false,
     spinning:false,spinA:0,big:false,star:0,inv:0,hearts:3,bones:0,score:0,combo:0,
     runPhase:0,idleT:0,prevY:0},
  camX:0, gt:0, playT:0, winT:0, overT:0,
  trip:0.35, tripPulse:0,
  state:'menu',            // menu | play | pause | win | over
  checkpointHit:false, newBest:false,
  hooks:{},                // onWorldRebuild, onBlockUsed(key), onBrickBreak(key), onState(s)
};

export function tget(c,r){ if(c<0||c>=G.LW) return 1; if(r<0||r>=ROWS) return 0; return G.grid[r*G.LW+c]; }
export function isSolid(v){ return v===1||v===2||v===3||v===4||v===5; }
function tset(c,r,v){ if(c>=0&&c<G.LW&&r>=0&&r<ROWS) G.grid[r*G.LW+c]=v; }
export function groundTopAt(c){ for(let r=0;r<ROWS;r++) if(isSolid(tget(c,r))) return r*TILE; return ROWS*TILE; }

export function toast(txt){ G.toasts.push({txt,t:3.2}); if(G.toasts.length>3) G.toasts.shift(); }

function setState(s){ G.state=s; if(G.hooks.onState) G.hooks.onState(s); }

// ---------------- level lifecycle ----------------
export function loadLevel(mode,levelDef,charId){
  const L=levelDef.build();
  L.id=levelDef.id; L.name=levelDef.name; L.theme=levelDef.theme;
  G.mode=mode; G.level=L;
  G.char=CHARS[charId||Save.settings.char]||CHARS.rue;
  G.LW=L.LW; G.grid=L.grid; G.blockItems=L.blockItems; G.bounceAnim={};
  G.bonesArr=L.bones; G.enemies=L.enemies; G.tipsArr=L.tips;
  G.items=[]; G.parts=[]; G.floats=[]; G.toasts.length=0;
  const P=G.P;
  P.x=L.startX; P.y=L.startY; P.w=34; P.h=26; P.vx=0; P.vy=0; P.dir=1;
  P.big=false; P.star=0; P.inv=0; P.hearts=3; P.bones=0; P.score=0; P.combo=0;
  P.grounded=false; P.spinning=false; P.spinA=0; P.idleT=0;
  G.camX=0; G.playT=0; G.winT=0; G.overT=0;
  G.checkpointHit=false; G.tripPulse=0; G.newBest=false;
  if(G.hooks.onWorldRebuild) G.hooks.onWorldRebuild();
  setState('play');
  toast(`go, ${G.char.name}, go!`);
}

function setBig(b){
  const P=G.P, feet=P.y+P.h;
  P.big=b; P.h=b?32:26; P.w=b?36:34;
  P.y=feet-P.h;
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
      if(isSolid(t)||(t===7&&opts.oneway&&prevBottom<=r*TILE+6)){
        e.y=r*TILE-e.h; e.vy=0; col.d=true; break;
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
function updatePlayer(){
  const P=G.P, st=G.char.stats;
  P.prevY=P.y;
  const maxSpd=Input.run?st.run:st.walk;
  const accel=(P.grounded?st.accel:st.accel*0.78);
  const before=Math.abs(P.vx);
  if(Input.l){ P.vx-=accel*(P.vx>0?1.7:1); P.dir=-1; }
  else if(Input.r){ P.vx+=accel*(P.vx<0?1.7:1); P.dir=1; }
  else if(P.grounded){ P.vx*=st.fric; if(Math.abs(P.vx)<0.05)P.vx=0; }
  const spd=Math.abs(P.vx);
  if(spd>maxSpd) P.vx=Math.sign(P.vx)*(before>maxSpd?Math.max(maxSpd,before-0.12):maxSpd);
  if(Input.jumpP){ P.jbuf=7; P.jbufSpin=false; }
  if(Input.spinP){ P.jbuf=7; P.jbufSpin=true; }
  if(P.jbuf>0) P.jbuf--;
  if(P.grounded) P.coyote=6; else if(P.coyote>0) P.coyote--;
  if(P.jbuf>0&&P.coyote>0){
    P.jbuf=0; P.coyote=0; P.grounded=false;
    P.spinning=P.jbufSpin; P.spinA=0;
    P.vy=-(P.jbufSpin?st.jump*0.88:st.jump)-Math.abs(P.vx)*0.14;
    if(P.jbufSpin) Sound.spinS(); else Sound.jump();
    for(let i=0;i<8;i++) part(P.x+P.w/2,P.y+P.h,(Math.random()-0.5)*3,-Math.random()*1.5,0.5,(G.gt*80)%360,0.9,0.75,4,0.05);
  }
  if(!Input.jump&&!Input.spin&&P.vy<-3.6) P.vy=-3.6;
  P.vy+=GRAV; if(P.vy>MAXFALL)P.vy=MAXFALL;
  const col=moveEntity(P,{oneway:true});
  P.grounded=col.d;
  if(col.u&&col.bumped) hitBlock(col.bumped[0],col.bumped[1],col.bumped[2]);
  if(P.grounded){ P.spinning=false; P.combo=0; }
  if(P.spinning) P.spinA+=0.45;
  if(P.grounded&&spd>0.2) P.runPhase+=spd*0.05;
  if(P.grounded&&spd<0.1&&!Input.l&&!Input.r) P.idleT+=1/60; else P.idleT=0;
  if(P.inv>0)P.inv--;
  if(P.star>0){
    P.star--; if(P.star===0) toast('the glow fades…');
    if(P.star%2===0) part(P.x+P.w/2+(Math.random()-0.5)*24,P.y+P.h-6,(Math.random()-0.5)*1,-Math.random()*1,0.8,(G.gt*300+Math.random()*90)%360,1,0.7,5,-0.02);
  }
  // checkpoint
  const L=G.level;
  if(!G.checkpointHit&&P.x+P.w>L.checkpointX-6&&P.x<L.checkpointX+30){
    G.checkpointHit=true; Sound.heartS(); toast('checkpoint attuned ✧'); addTrip(0.35);
    for(let i=0;i<24;i++) part(L.checkpointX+12,L.cpY-30,(Math.random()-0.5)*4,-Math.random()*4,1.0,Math.random()*360,0.9,0.7,4,0.08);
  }
  // gate
  if(P.x+P.w/2>=L.gateX&&G.state==='play'){
    P.vx=0; G.winT=0;
    P.score+=Math.max(0,Math.round((300-G.playT))*10);
    G.newBest=Save.recordWin(L.id,P.score,P.bones,G.playT);
    Sound.winS(); rumble(0.6,0.9,500);
    mandalaBurst(L.gateX+16,L.gateY-120);
    setState('win');
  }
  if(P.y>H+60) pitDeath();
}

function hitBlock(c,r,t){
  const key=c+','+r;
  const P=G.P;
  if(t===3){
    tset(c,r,4); G.bounceAnim[key]=10;
    const item=G.blockItems[key];
    const bx=c*TILE+16, by=r*TILE-10;
    if(item==='bone') collectBone(bx,by,1);
    else if(item==='bones5') collectBone(bx,by,5);
    else if(item==='shroom'){ G.items.push({type:'shroom',x:c*TILE+4,y:r*TILE,w:24,h:24,vx:1.3,vy:0,rise:28,hue:0}); Sound.power(); }
    else if(item==='star'){ G.items.push({type:'star',x:c*TILE+4,y:r*TILE,w:24,h:24,vx:1.6,vy:0,rise:28,hue:0}); Sound.power(); }
    if(G.hooks.onBlockUsed) G.hooks.onBlockUsed(key);
    rumble(0.2,0.5,90);
  } else if(t===2){
    if(P.big){
      tset(c,r,0); Sound.brick(); P.score+=50; rumble(0.5,0.8,140);
      if(G.hooks.onBrickBreak) G.hooks.onBrickBreak(key);
      for(let i=0;i<10;i++) part(c*TILE+16,r*TILE+16,(Math.random()-0.5)*6,-Math.random()*5-1,0.9,(G.gt*60+40)%360,0.75,0.6,6,0.3);
    } else { G.bounceAnim[key]=8; Sound.bump(); }
  }
}

function collectBone(x,y,n){
  const P=G.P;
  P.bones+=n; P.score+=100*n;
  Sound.bone(); addTrip(0.12);
  G.floats.push({x,y,txt:n>1?`+${n} ✦`:'+100',t:1});
  for(let i=0;i<6*n;i++) part(x,y,(Math.random()-0.5)*4,-Math.random()*3-1,0.7,45+Math.random()*40,1,0.7,4,0.12);
  if(P.bones>=50&&(P.bones-n)<50&&P.hearts<5){ P.hearts++; Sound.heartS(); toast('❤ 50 bones — extra heart!'); }
  if(P.bones>=100&&(P.bones-n)<100&&P.hearts<5){ P.hearts++; Sound.heartS(); toast('❤ 100 bones — extra heart!'); }
}

function hurt(){
  const P=G.P;
  if(P.inv>0||P.star>0) return;
  if(P.big){ setBig(false); P.inv=130; Sound.hurtS(); rumble(0.8,0.4,220); toast('ouch — the vision dims'); }
  else{
    P.hearts--; P.inv=140; Sound.hurtS(); rumble(1,0.6,320);
    P.vy=-5; P.vx=-P.dir*3;
    if(P.hearts<=0){ gameOver(); return; }
  }
  addTrip(0.5);
}
function pitDeath(){
  const P=G.P;
  P.hearts--; Sound.hurtS(); rumble(1,1,420);
  if(P.hearts<=0){ gameOver(); return; }
  respawn();
}
function respawn(){
  const P=G.P, L=G.level;
  const rx=G.checkpointHit?L.checkpointX:L.startX;
  const rc=Math.floor((rx+P.w/2)/TILE);
  P.x=rx; P.y=groundTopAt(rc)-P.h-2; P.vx=0; P.vy=0; P.inv=160;
  G.camX=clamp(P.x-W*0.38,0,G.LW*TILE-W);
  toast('the world reassembles itself…');
}
function gameOver(){
  G.overT=0; Sound.overS();
  setState('over');
}

// ---------------- enemies ----------------
function killEnemy(e){
  const P=G.P;
  e.dying=true; e.alive=false;
  P.combo=Math.min(P.combo+1,8);
  const pts=200*P.combo;
  P.score+=pts;
  G.floats.push({x:e.x+e.w/2,y:e.y,txt:'+'+pts,t:1});
  Sound.stomp(); rumble(0.4,0.7,120); addTrip(0.2);
  for(let i=0;i<12;i++) part(e.x+e.w/2,e.y+e.h/2,(Math.random()-0.5)*5,-Math.random()*4,0.9,(e.hueOff+G.gt*120)%360,0.9,0.65,5,0.2);
}

function updateEnemies(){
  const P=G.P;
  for(const e of G.enemies){
    if(e.dying){ e.squash-=0.05; continue; }
    if(!e.alive) continue;
    if(!e.active){ if(e.x<G.camX+W+96&&e.x>G.camX-320) e.active=true; else continue; }
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
      if(e.y>H+80){ e.alive=false; continue; }
    } else {
      e.y=e.baseY+Math.sin(G.gt*2+e.ph)*22;
    }
    if(G.state!=='play') continue;
    if(P.x<e.x+e.w&&P.x+P.w>e.x&&P.y<e.y+e.h&&P.y+P.h>e.y){
      if(P.star>0){ killEnemy(e); continue; }
      const stomp=P.vy>0.5&&(P.prevY+P.h)<=e.y+10;
      if(stomp){
        if(e.type==='jelly'&&!P.spinning){ hurt(); P.vy=-6; }
        else{
          killEnemy(e);
          P.vy=P.spinning?-8:(Input.jump?-10.2:-6.5);
          P.y=e.y-P.h-1;
        }
      } else hurt();
    }
  }
  for(let i=G.enemies.length-1;i>=0;i--){
    const e=G.enemies[i];
    if(e.dying&&e.squash<=0){
      if(G.hooks.onEnemyGone) G.hooks.onEnemyGone(e);
      G.enemies.splice(i,1);
    }
  }
}

// ---------------- items ----------------
function removeItem(i){
  const it=G.items[i];
  if(G.hooks.onItemGone) G.hooks.onItemGone(it);
  G.items.splice(i,1);
}
function updateItems(){
  const P=G.P;
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
    if(P.x<it.x+it.w&&P.x+P.w>it.x&&P.y<it.y+it.h&&P.y+P.h>it.y&&it.rise<=0){
      if(it.type==='shroom'){
        if(!P.big){ setBig(true); toast('✦ COSMIC KIBBLE — Rue awakens her third eye'); }
        P.score+=1000; G.floats.push({x:it.x,y:it.y,txt:'+1000',t:1});
        Sound.power(); rumble(0.5,0.5,300); addTrip(0.6);
      } else {
        P.star=8*60; P.score+=1000; G.floats.push({x:it.x,y:it.y,txt:'STARSEED!',t:1.2});
        Sound.starJ(); rumble(0.7,0.7,500); addTrip(1);
        toast('⭐ STARSEED — Rue is one with everything');
      }
      removeItem(i);
    }
  }
}

function updateBones(){
  const P=G.P;
  for(const b of G.bonesArr){
    if(b.taken) continue;
    b.t+=1/60;
    const pad=8;
    if(P.x-pad<b.x+8&&P.x+P.w+pad>b.x-8&&P.y-pad<b.y+8&&P.y+P.h+pad>b.y-8){
      b.taken=true; collectBone(b.x,b.y,1);
    }
  }
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

// ---------------- top-level update (one 60 Hz step) ----------------
export function update(){
  if(G.state==='menu'||G.state==='pause') return;
  G.gt+=1/60;
  switch(G.state){
    case 'play':
      G.playT+=1/60;
      updatePlayer();
      updateEnemies();
      updateItems();
      updateBones();
      G.camX+=((G.P.x-W*0.38+G.P.vx*20)-G.camX)*0.1;
      G.camX=clamp(G.camX,0,G.LW*TILE-W);
      break;
    case 'win':
      G.winT+=1/60;
      if(G.winT<1.4&&Math.random()<0.35){
        const a=Math.random()*TAU, d=60+Math.random()*130;
        mandalaBurst(G.level.gateX+16+Math.cos(a)*d,G.level.gateY-120+Math.sin(a)*d*0.5);
      }
      G.camX+=((G.level.gateX-W*0.5)-G.camX)*0.06;
      G.camX=clamp(G.camX,0,G.LW*TILE-W);
      updateEnemies();
      break;
    case 'over':
      G.overT+=1/60;
      break;
  }
  // trip level — scaled by the settings intensity
  const tripScale=Save.settings.trip;
  let base=0.30+0.06*Math.sin(G.gt*0.23);
  if(G.P.star>0) base=1; else if(G.P.big) base+=0.14;
  if(G.state==='win') base=1;
  G.trip+=(clamp((base+G.tripPulse)*tripScale,0,1.25)-G.trip)*0.04;
  G.tripPulse*=0.97;
  for(const k in G.bounceAnim){ if(G.bounceAnim[k]>0) G.bounceAnim[k]--; }
  updateParts();
}
