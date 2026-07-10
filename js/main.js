/* ============================================================
   PAWS ENGINE — main orchestrator
   Menus · settings · touch UI · shared HUD · game loop
   ============================================================ */
import {VIEW_W as W,VIEW_H as H,TAU,clamp,isMobile,Save,Sound,Input,Input2,routeKey,bindTouch,LEVELS,WORLDS,CHARS,levelUnlocked} from './shared.js';
import {G,loadLevel,update as logicUpdate,sumOf} from './logic.js';
import {Net} from './net.js';
import {Render2D,drawPortrait} from './render2d.js';
import {Render3D} from './render3d.js';

const $=id=>document.getElementById(id);
Save.load();

// ---------------- state ----------------
let mode=null, levelIdx=0, charId=Save.settings.char||'rue';
let activeR=null;
let panel='pMain', settingsReturn='pMain';
let selItems=[], selIdx=0;
let winShown=false, overShown=false;
let pendingCoop=null;   // null | 'local' | 'host' | 'guest'
const PANELS=['pMain','pMulti','pModeSel','pHost','pJoin','pChar','pLevels','pPause','pWin','pOver','pSettings'];

// ---------------- HUD canvas ----------------
const hud=$('hudTop'), hctx=hud.getContext('2d');
let hw=0,hh=0,hk=1;
function sizeHud(){
  const dpr=Math.min(window.devicePixelRatio||1,2);
  hw=hud.width=Math.max(8,Math.floor((innerWidth||1280)*dpr));
  hh=hud.height=Math.max(8,Math.floor((innerHeight||720)*dpr));
  hk=Math.max(0.6,Math.min(hw/1280,hh/720));
}

// ---------------- panels & navigation ----------------
function showPanel(id){
  for(const p of PANELS) $(p).classList.toggle('hidden',p!==id);
  panel=id;
  $('menuBg').classList.toggle('hidden',!!G.level&&id!=='pMain');
  rebuildSel();
}
function hidePanels(){
  for(const p of PANELS) $(p).classList.add('hidden');
  panel=null;
  $('menuBg').classList.add('hidden');
}
function rebuildSel(){
  selItems=panel?[...$(panel).querySelectorAll('.mbtn:not(:disabled), .card:not(.locked), .ltile:not(.locked), input[type=range]')]:[];
  selIdx=0; paintSel();
}
function paintSel(){
  selItems.forEach((el,i)=>el.classList.toggle('sel',i===selIdx));
}
function moveSel(d){
  if(!selItems.length) return;
  selIdx=(selIdx+d+selItems.length)%selItems.length;
  paintSel(); Sound.uiS();
}
function activateSel(){
  const el=selItems[selIdx];
  if(!el||el.tagName==='INPUT') return;
  Sound.uiS(); el.click();
}
function adjustSel(d){
  const el=selItems[selIdx];
  if(el&&el.tagName==='INPUT'){
    el.value=+el.value+d*5;
    el.dispatchEvent(new Event('input'));
  } else moveSel(d);
}
function backAction(){
  if(panel==='pChar') showPanel('pMain');
  else if(panel==='pLevels') showPanel(pendingCoop?'pModeSel':'pChar');
  else if(panel==='pMulti'){ pendingCoop=null; showPanel('pMain'); }
  else if(panel==='pModeSel'){ if(pendingCoop==='host'){ showPanel('pHost'); } else { pendingCoop=null; showPanel('pMulti'); } }
  else if(panel==='pHost'||panel==='pJoin'){ Net.close(); pendingCoop=null; showPanel('pMulti'); }
  else if(panel==='pSettings') showPanel(settingsReturn);
  else if(panel==='pPause') resumeGame();
}

// ---------------- menu content ----------------
function buildCharCards(){
  const wrap=$('charCards'); wrap.innerHTML='';
  for(const id of Object.keys(CHARS)){
    const ch=CHARS[id];
    const card=document.createElement('div');
    card.className='card'; card.dataset.char=id;
    const cv=document.createElement('canvas'); cv.width=120; cv.height=116;
    const c2=cv.getContext('2d'); c2.imageSmoothingEnabled=false;
    drawPortrait(c2,ch,60,106,3.4);
    card.append(cv);
    const zoom=Math.round((ch.stats.run/CHARS.rue.stats.run)*100);
    const spring=Math.round((ch.stats.jump/CHARS.rue.stats.jump)*100);
    card.insertAdjacentHTML('beforeend',
      `<h3>${ch.name}</h3><p>${ch.desc}</p><p class="statline">zoom ${zoom}% · spring ${spring}%</p>`);
    wrap.append(card);
  }
}
function fmtTime(s){ const m=Math.floor(s/60); s=Math.floor(s%60); return m+':'+(s<10?'0':'')+s; }
function buildLevelCards(){
  const wrap=$('levelCards'); wrap.innerHTML='';
  $('levelsTitle').textContent=(mode==='classic'?'🎨 classic dreams':'🌀 odyssey dreams')+' — '+CHARS[charId].name;
  WORLDS[mode].forEach((wd,w)=>{
    const head=document.createElement('div');
    head.className='lwname';
    head.innerHTML=`<span class="wnum">world ${w+1}</span> ${wd.name}`;
    wrap.append(head);
    const grid=document.createElement('div');
    grid.className='lgrid';
    for(let l=0;l<4;l++){
      const i=w*4+l;
      const d=LEVELS[mode][i];
      const un=levelUnlocked(mode,i);
      const st=Save.stat(d.id);
      const tile=document.createElement('div');
      tile.className='ltile'+(un?'':' locked');
      if(un) tile.dataset.idx=i;
      const marks=(st&&st.done?'★':'')+(st&&st.balls>=5?' 🎾':'');
      const sub=st&&st.done?`${st.best}`:(un?'···':'🔒');
      tile.innerHTML=`<div class="lnum">${w+1}-${l+1}</div><div class="lmark">${marks||'&nbsp;'}</div><div class="lbest">${sub}</div>`;
      tile.title=d.name;
      grid.append(tile);
    }
    wrap.append(grid);
  });
}
function showWinPanel(){
  winShown=true;
  const L=G.level;
  const names=G.players.map(p=>p.char.name.toUpperCase());
  $('winTitle').textContent=names.length>1?`✧ ${names.join(' & ')} DID IT! ✧`:`✧ ${names[0]} DID IT! ✧`;
  const balls=Math.min(L.totalBalls||5,sumOf('balls'));
  $('winStats').innerHTML=
    `cosmic bones &nbsp;${sumOf('bones')} / ${L.totalBones}<br>`+
    `🎾 tennis balls &nbsp;${balls} / ${L.totalBalls||5}${balls>=(L.totalBalls||5)?' &nbsp;✧ all of them!':''}<br>`+
    `time &nbsp;${fmtTime(G.playT)}<br>`+
    `score &nbsp;${sumOf('score')}${G.newBest?' &nbsp;★ new best!':''}`;
  const isGuest=G.coop==='guest';
  const hasNext=!isGuest&&levelIdx+1<LEVELS[mode].length;
  $('btnNext').classList.toggle('hidden',!hasNext);
  $('pWin').querySelector('[data-act="restart"]').classList.toggle('hidden',isGuest);
  if(isGuest) toast('the host picks the next dream');
  showPanel('pWin');
}
function showOverPanel(){
  overShown=true;
  $('overText').textContent=`${G.char.name} wakes up safe and cozy on the couch — every adventure ends in a nap.`;
  $('overStats').textContent=`score ${G.P.score} · ${G.P.bones} cosmic bones gathered`;
  showPanel('pOver');
}

// ---------------- game flow ----------------
function configureCouchInputs(){
  const pads=[...(navigator.getGamepads?navigator.getGamepads():[])].filter(p=>p&&p.connected);
  if(pads.length>=2){
    Input.configure({keymap:'p1',pad:pads[0].index,touch:true});
    Input2.configure({keymap:'p2',pad:pads[1].index});
    toast('P1: pad 1 · P2: pad 2');
  } else if(pads.length===1){
    Input.configure({keymap:'p1',pad:null,touch:true});
    Input2.configure({keymap:'p2',pad:pads[0].index});
    toast('P1: keyboard/touch · P2: gamepad');
  } else {
    Input.configure({keymap:'p1',pad:null,touch:true});
    Input2.configure({keymap:'p2',pad:null});
    toast('P1: arrows + Z/X/C · P2: WASD + Space/Q/E');
  }
}
function toast(t){ G.toasts.push({txt:t,t:3.2}); if(G.toasts.length>3) G.toasts.shift(); }
function startGame(idx){
  levelIdx=idx;
  winShown=overShown=false;
  Sound.unlock(); Sound.applyVolumes();
  const next=mode==='classic'?Render2D:Render3D;
  const other=mode==='classic'?Render3D:Render2D;
  other.hide();
  let opts;
  if(pendingCoop==='local'){
    configureCouchInputs();
    opts={coop:'local',chars:[charId,charId==='rue'?'nero':'rue'],inputs:[Input,Input2]};
  } else if(pendingCoop==='host'&&Net.connected){
    Input.configure({keymap:'merged',pad:'any',touch:true});
    opts={coop:'host',chars:[charId,Net.remoteChar]};
    Net.sendInit(mode,idx);
  } else if(pendingCoop==='guest'){
    Input.configure({keymap:'merged',pad:'any',touch:true});
    opts={coop:'guest',chars:[charId,Net.remoteChar]};
  } else {
    pendingCoop=null;
    Input.configure({keymap:'merged',pad:'any',touch:true});
    opts={chars:[charId]};
  }
  loadLevel(mode,LEVELS[mode][idx],opts);
  next.show();
  if(mode==='classic'){
    G.hooks.onBlockUsed=G.hooks.onBrickBreak=G.hooks.onEnemyGone=G.hooks.onItemGone=null;
  }
  next.onLevel();
  activeR=next;
  hidePanels();
  updateTouchVisibility();
}
function pauseGame(){
  if(G.state!=='play') return;
  G.state='pause';
  showPanel('pPause');
}
function resumeGame(){
  if(G.state!=='pause') return;
  hidePanels();
  G.state='play';
}
function quitToMenu(){
  G.state='menu'; G.level=null;
  Net.close(); pendingCoop=null;
  Input.configure({keymap:'merged',pad:'any',touch:true});
  if(activeR) activeR.hide();
  activeR=null;
  hctx.clearRect(0,0,hw,hh);
  showPanel('pMain');
  updateTouchVisibility();
}

// ---------------- actions ----------------
function doAct(act){
  if(act.startsWith('mode:')){
    mode=act.slice(5);
    if(pendingCoop){ buildLevelCards(); showPanel('pLevels'); }
    else { buildCharCards(); showPanel('pChar'); }
  }
  else if(act==='multi') showPanel('pMulti');
  else if(act==='couch'){ pendingCoop='local'; showPanel('pModeSel'); }
  else if(act==='hostRoom'){
    pendingCoop='host';
    showPanel('pHost');
    $('roomCode').textContent='····';
    Net.host().then(code=>{ $('roomCode').textContent=code; });
  }
  else if(act==='joinRoom'){ pendingCoop='guest'; showPanel('pJoin'); $('joinStatus').textContent=''; }
  else if(act==='joinGo'){
    const code=$('joinCode').value;
    if(code.trim().length===4) Net.join(code);
    else $('joinStatus').textContent='the code is 4 letters';
  }
  else if(act==='netCancel'){ Net.close(); pendingCoop=null; showPanel('pMulti'); }
  else if(act==='settings'){ settingsReturn=panel; showPanel('pSettings'); }
  else if(act==='back') backAction();
  else if(act==='resume') resumeGame();
  else if(act==='restart') startGame(levelIdx);
  else if(act==='next') startGame(levelIdx+1);
  else if(act==='quit') quitToMenu();
  else if(act==='fullscreen') toggleFS();
  else if(act==='resetProgress'){
    if(window.confirm('Reset all level progress and best scores?')){ Save.resetProgress(); }
  }
}
$('menus').addEventListener('click',e=>{
  const card=e.target.closest('.card,.ltile');
  if(card&&!card.classList.contains('locked')){
    if(card.dataset.char){
      charId=card.dataset.char;
      Save.settings.char=charId; Save.store();
      buildLevelCards();
      showPanel('pLevels');
    } else if(card.dataset.idx!=null){
      startGame(+card.dataset.idx);
    }
    Sound.unlock();
    return;
  }
  const btn=e.target.closest('[data-act]');
  if(btn){ Sound.unlock(); doAct(btn.dataset.act); }
});

// ---------------- settings ----------------
function initSettings(){
  const s=Save.settings;
  const wire=(slId,vId,key,fmt,post)=>{
    const sl=$(slId), v=$(vId);
    sl.value=Math.round(s[key]*100);
    v.textContent=fmt(sl.value);
    sl.addEventListener('input',()=>{
      s[key]=clamp(sl.value/100,0,1.25);
      v.textContent=fmt(sl.value);
      Save.store();
      if(post) post();
    });
  };
  wire('sMusic','vMusic','music',v=>v+'%',()=>Sound.applyVolumes());
  wire('sSfx','vSfx','sfx',v=>v+'%',()=>Sound.applyVolumes());
  wire('sTrip','vTrip','trip',v=>v+'%');
  const paintSeg=(segId,attr,val)=>{
    for(const b of $(segId).querySelectorAll('button')) b.classList.toggle('on',b.dataset[attr]===val);
  };
  paintSeg('segQuality','q',s.quality);
  $('segQuality').addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    s.quality=b.dataset.q; Save.store();
    paintSeg('segQuality','q',s.quality);
    Render3D.setQuality(s.quality);
  });
  paintSeg('segTouch','t',s.touch);
  $('segTouch').addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    s.touch=b.dataset.t; Save.store();
    paintSeg('segTouch','t',s.touch);
    updateTouchVisibility();
  });
  if(!fsSupported()){
    for(const b of document.querySelectorAll('[data-act="fullscreen"]')) b.style.display='none';
    $('tFS').style.display='none';
    if(isMobile) $('fsHint').classList.remove('hidden');
  }
}
function fsSupported(){
  const d=document.documentElement;
  return !!(d.requestFullscreen||d.webkitRequestFullscreen);
}
async function toggleFS(){
  try{
    const d=document.documentElement;
    if(document.fullscreenElement||document.webkitFullscreenElement){
      await (document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen());
    } else if(d.requestFullscreen||d.webkitRequestFullscreen){
      await (d.requestFullscreen?d.requestFullscreen():d.webkitRequestFullscreen());
      // keep the dream widescreen on phones
      if(isMobile&&screen.orientation&&screen.orientation.lock){
        screen.orientation.lock('landscape').catch(()=>{});
      }
    }
  }catch(e){}
}

// ---------------- touch ----------------
function touchWanted(){
  const t=Save.settings.touch;
  return t==='on'||(t==='auto'&&isMobile);
}
function updateTouchVisibility(){
  $('touchUI').classList.toggle('hidden',!(touchWanted()&&!!G.level));
}
bindTouch();
$('tPause').addEventListener('click',()=>{
  if(G.state==='play') pauseGame();
  else if(G.state==='pause') resumeGame();
});
$('tMusic').addEventListener('click',()=>{ Sound.toggle(); });
$('tFS').addEventListener('click',()=>{ Sound.unlock(); toggleFS(); });

// ---------------- global input events ----------------
window.addEventListener('keydown',e=>{
  if(e.target&&e.target.tagName==='INPUT') return;   // let the room-code field type freely
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if(e.code==='KeyF'&&!e.repeat) toggleFS();
  routeKey(e,true); Sound.unlock();
});
window.addEventListener('keyup',e=>routeKey(e,false));
window.addEventListener('pointerdown',()=>Sound.unlock());
window.addEventListener('gamepadconnected',()=>{ Input.padOn=true; });
window.addEventListener('blur',()=>pauseGame());
document.addEventListener('visibilitychange',()=>{ if(document.hidden) pauseGame(); });
window.addEventListener('resize',()=>{ sizeHud(); Render2D.resize(); Render3D.resize(); });

// ---------------- HUD drawing ----------------
function drawHUD(){
  hctx.clearRect(0,0,hw,hh);
  if(!G.level||!activeR||!activeR.active) return;
  const k=hk, P=G.P;
  // world-anchored tips & floats
  hctx.textAlign='center';
  hctx.font=`bold ${15*k}px Consolas, monospace`;
  for(const t of G.tipsArr){
    if(Math.abs(t.x-(G.camX+W/2))>W) continue;
    const [nx,ny]=activeR.worldToScreenN(t.x,t.y+Math.sin(G.gt*1.4+t.x*0.01)*4);
    hctx.fillStyle=`hsla(${(G.gt*42)%360},100%,85%,0.92)`;
    hctx.fillText(t.text,nx*hw,ny*hh);
  }
  hctx.font=`bold ${16*k}px Consolas, monospace`;
  for(const f of G.floats){
    const [nx,ny]=activeR.worldToScreenN(f.x,f.y);
    hctx.globalAlpha=Math.max(0,f.t);
    hctx.fillStyle='#fff';
    hctx.fillText(f.txt,nx*hw,ny*hh);
  }
  hctx.globalAlpha=1;
  // hearts — one row per pup, tinted chip with their initial
  G.players.forEach((pl,pi)=>{
    const y=(26+pi*30)*k;
    if(G.players.length>1){
      hctx.fillStyle=pl.char.pal.head;
      hctx.beginPath(); hctx.arc(12*k,y,6*k,0,TAU); hctx.fill();
      hctx.fillStyle='#0a0420';
      hctx.font=`bold ${9*k}px Consolas, monospace`; hctx.textAlign='center';
      hctx.fillText(pl.char.name[0],12*k,y+3*k);
    }
    for(let i=0;i<Math.max(3,pl.hearts);i++){
      const x=(30+i*30)*k, on=i<pl.hearts;
      hctx.fillStyle=on?`hsl(${340+8*Math.sin(G.gt*3+i)},85%,62%)`:'rgba(255,255,255,0.18)';
      hctx.beginPath(); hctx.arc(x,y+3*k,6.6*k,0,TAU); hctx.fill();
      hctx.beginPath(); hctx.arc(x-5.6*k,y-4*k,3.2*k,0,TAU); hctx.fill();
      hctx.beginPath(); hctx.arc(x,y-5.6*k,3.2*k,0,TAU); hctx.fill();
      hctx.beginPath(); hctx.arc(x+5.6*k,y-4*k,3.2*k,0,TAU); hctx.fill();
    }
  });
  const rowsY=26+G.players.length*30;
  // bone counter (team total)
  hctx.save(); hctx.translate(30*k,(rowsY+4)*k); hctx.scale(k,k);
  hctx.fillStyle='#fdf8ee';
  hctx.fillRect(-6,-2,12,4);
  for(const [bx,by] of [[-6,-3.4],[-6,3.4],[6,-3.4],[6,3.4]]){ hctx.beginPath(); hctx.arc(bx,by,3.2,0,TAU); hctx.fill(); }
  hctx.restore();
  hctx.font=`bold ${17*k}px Consolas, monospace`;
  hctx.fillStyle='#fff'; hctx.textAlign='left';
  hctx.fillText('× '+sumOf('bones'),46*k,(rowsY+10)*k);
  // tennis ball slots (team total)
  const totB=(G.level.totalBalls||5), gotB=Math.min(totB,sumOf('balls'));
  for(let i=0;i<totB;i++){
    const bx=(28+i*17)*k, by=(rowsY+32)*k;
    if(i<gotB){
      hctx.fillStyle='#d7f74a';
      hctx.beginPath(); hctx.arc(bx,by,6*k,0,TAU); hctx.fill();
      hctx.strokeStyle='#fff'; hctx.lineWidth=1.4*k;
      hctx.beginPath(); hctx.arc(bx-5*k,by,6.4*k,-0.8,0.8); hctx.stroke();
    } else {
      hctx.strokeStyle='rgba(255,255,255,0.3)'; hctx.lineWidth=1.4*k;
      hctx.beginPath(); hctx.arc(bx,by,6*k,0,TAU); hctx.stroke();
    }
  }
  // score / time / level name
  hctx.textAlign='right';
  hctx.fillText('SCORE '+sumOf('score'),hw-20*k,30*k);
  hctx.fillText('TIME '+fmtTime(G.playT),hw-20*k,56*k);
  hctx.font=`${12*k}px Consolas, monospace`;
  hctx.fillStyle='rgba(255,255,255,0.5)';
  hctx.fillText(G.level.name,hw-20*k,78*k);
  // status
  hctx.textAlign='left';
  if(!touchWanted()){
    hctx.fillText(Input.padOn?'🎮 controller':'⌨ keyboard · Ⓐ/Z jump · Ⓑ/C spin · Ⓧ/SHIFT run',16*k,hh-12*k);
    hctx.textAlign='right';
    hctx.fillText('M music · F fullscreen · P/Start pause',hw-16*k,hh-12*k);
  }
  // star bar
  if(P.star>0){
    hctx.fillStyle=`hsl(${(G.gt*300)%360},100%,65%)`;
    hctx.fillRect(hw/2-80*k,14*k,160*k*(P.star/(8*60)),8*k);
    hctx.strokeStyle='rgba(255,255,255,0.6)';
    hctx.strokeRect(hw/2-80*k,14*k,160*k,8*k);
  }
  // toasts
  hctx.textAlign='center'; hctx.font=`bold ${16*k}px Consolas, monospace`;
  G.toasts.forEach((t,i)=>{
    hctx.globalAlpha=clamp(t.t,0,1);
    hctx.fillStyle='#fff';
    hctx.fillText(t.txt,hw/2,(92+i*24)*k);
  });
  hctx.globalAlpha=1;
}

// ---------------- main loop ----------------
function navTick(){
  if(Input.uP) moveSel(-1);
  if(Input.dP) moveSel(1);
  if(Input.lP) adjustSel(-1);
  if(Input.rP) adjustSel(1);
  if(Input.jumpP||Input.startP) activateSel();
  else if(Input.backP) backAction();
}
function tick(){
  Input.poll();
  if(G.coop==='local') Input2.poll();
  if(Input.musicP) Sound.toggle();
  const menuOpen=!!panel;
  if(menuOpen){
    navTick();
    // let the win/over celebration keep swirling behind its panel
    if(G.state==='win'||G.state==='over') logicUpdate();
    if(Net.role&&G.level) Net.tick();
  } else if(G.level){
    if(G.state==='play'&&(Input.startP||Input.backP)){ pauseGame(); Input.clear(); Input2.clear(); return; }
    logicUpdate();
    if(Net.role) Net.tick();
    if(G.state==='win'&&G.winT>1.4&&!winShown) showWinPanel();
    if(G.state==='over'&&G.overT>0.8&&!overShown) showOverPanel();
  }
  Input.clear();
  if(G.coop==='local') Input2.clear();
}
let last=performance.now(), acc=0;
const STEP=1000/60;
function frame(now){
  requestAnimationFrame(frame);
  acc+=Math.min(100,now-last); last=now;
  let n=0;
  while(acc>=STEP&&n<5){ tick(); acc-=STEP; n++; }
  if(activeR) activeR.render();
  drawHUD();
}

// ---------------- boot ----------------
$('mainHint').innerHTML=
  '🎮 controller · ⌨ keyboard · 📱 touch — all welcome<br>'+
  'collect cosmic bones · bounce shroomies · spin off the spiky eyes · reach the Great Eye';
// net session wiring
Net.onStatus=s=>{
  if(panel==='pHost') $('hostStatus').textContent=s;
  if(panel==='pJoin') $('joinStatus').textContent=s;
};
Net.onPeerJoined=()=>{ Sound.uiS(); showPanel('pModeSel'); };
Net.onStart=(m,idx)=>{ pendingCoop='guest'; mode=m; charId=Save.settings.char||charId; startGame(idx); };
Net.onDisconnect=()=>{ if(G.coop==='host'||G.coop==='guest') quitToMenu(); pendingCoop=null; };
initSettings();
Render3D.setQuality(Save.settings.quality);
sizeHud();
showPanel('pMain');
updateTouchVisibility();
requestAnimationFrame(frame);

// ---------------- debug hooks ----------------
window.__g={
  G,Save,LEVELS,CHARS,
  get panel(){return panel;}, get mode(){return mode;}, get charId(){return charId;},
  act:doAct,
  start(m,c,i){ mode=m; charId=c||charId; startGame(i||0); },
  quit:quitToMenu,
  step(n){ for(let i=0;i<n;i++){ tick(); if(activeR&&activeR.built){ if(activeR===Render3D) Render3D.sync&&Render3D.sync(); } } },
  key(c,down){ window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code:c})); },
  r2d:Render2D, r3d:Render3D,
  forceSize(w,h){
    hud.width=w; hud.height=h; hw=w; hh=h; hk=Math.max(0.6,Math.min(w/1280,h/720));
    Render2D.forceSize&&Render2D.forceSize(w,h);
    Render3D.forceSize&&Render3D.forceSize(w,h);
  },
  async cap(name){
    if(activeR) activeR.render();
    drawHUD();
    const send=async(cnv,suffix)=>{
      try{ await fetch('http://127.0.0.1:5218/',{method:'POST',body:name+suffix+'|'+cnv.toDataURL('image/png')}); }catch(e){}
    };
    if(activeR===Render2D) await send(Render2D.view,'');
    else if(activeR===Render3D) await send(Render3D.view,'');
    await send(hud,'_hud');
    return 'sent '+name;
  },
};
