/* ============================================================
   PAWS ENGINE — 2D pixel renderer (classic mode)
   World layer on an internal 960×540 canvas, composited through
   a psychedelic WebGL shader (kaleidoscope bg, wobble, chroma).
   HUD is drawn by main.js on the shared overlay canvas.
   ============================================================ */
import {TILE,ROWS,VIEW_W as W,VIEW_H as H,TAU,clamp} from './shared.js';
import {G,tget,isSolid} from './logic.js';

/** Front-view sitting sprite (the beg pose). Standalone so menus can draw
    character portraits. ctx must be translated to (cx, feetY); u = pixel unit. */
export function sitSprite(ctx,pal,shape,big,breathe,u){
  const R=(x,y,w,h,c)=>{ ctx.fillStyle=c; ctx.fillRect(x*u,y*u,w*u,h*u); };
  const nk=shape.neck||0;
  R(-8,-7,16,7,pal.body);                                   // haunches
  R(6.5,-4,4.5,2.4,pal.tailBase); R(10,-5,2.4,2.4,pal.tailTip);
  R(-5.5,-16+breathe,11,10,pal.body);                       // upright body
  R(-3.8,-13.4+breathe,7.6,6.8,pal.belly);
  if(shape.blaze) R(-2.2,-16+breathe,4.4,9,pal.chest);      // white chest stripe
  if(shape.spots){ R(-2.5,-11.5,1.3,1.3,pal.spot); R(1,-12.6,1.3,1.3,pal.spot); R(-0.6,-9.4,1.3,1.3,pal.spot); }
  R(-3.4,-9.6+breathe,2.4,3.4,pal.chest); R(1.2,-9.6+breathe,2.4,3.4,pal.chest); // paws
  const hy=-nk;                                             // longer neck lifts the head
  if(nk>0) R(-2.6,-18+breathe,5.2,4+nk,pal.head);
  R(-5.8,hy-25.5+breathe,11.6,9.6,pal.head);
  if(shape.earStyle==='rose'){
    R(-8.6,hy-25+breathe,3.4,2.2,pal.ear);
    R(5.2,hy-25+breathe,3.4,2.2,pal.ear);
  } else {
    R(-10.5,hy-26+breathe,4.8,3,pal.ear);
    R(5.8,hy-26+breathe,4.8,3,pal.ear);
  }
  R(-1.6,hy-22+breathe,3.2,6,pal.snout);                    // blaze / muzzle stripe
  R(-2.8,hy-19.4+breathe,5.6,3.4,pal.snout);
  R(-1.1,hy-20.6+breathe,2.2,1.9,pal.nose);
  R(-0.5,hy-17.6+breathe,1,0.8,pal.muz);
  R(-4.3,hy-23+breathe,2.2,2.6,pal.eye); R(2.1,hy-23+breathe,2.2,2.6,pal.eye);
  R(-3.3,hy-22.6+breathe,0.9,0.9,'#fff'); R(3.1,hy-22.6+breathe,0.9,0.9,'#fff');
  if(big) R(-0.8,hy-25+breathe,1.6,1.6,'#ffd75e');
}
/** Draw a character portrait into any 2D canvas (for menu cards). */
export function drawPortrait(ctx,char,cx,feetY,u){
  ctx.save(); ctx.translate(cx,feetY);
  sitSprite(ctx,char.pal,char.shape,false,0,u);
  ctx.restore();
}

const VSH=`attribute vec2 aP; void main(){ gl_Position=vec4(aP,0.,1.); }`;
const FSH=`
precision highp float;
uniform vec2 uRes; uniform float uT; uniform float uTrip; uniform float uCam; uniform float uWin;
uniform float uHue; uniform float uDark;
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
  vec3 col=pal(w*0.12+r*0.4-t*0.02+uHue)*(0.30+0.38*uTrip);
  float lat=abs(sin(p.x*26.0+sin(p.y*18.0+t*0.8)*1.6))*abs(sin(p.y*22.0-t*0.6+sin(p.x*14.0)*1.2));
  col+=vec3(1.0,0.75,0.35)*pow(max(0.0,1.0-lat),18.0)*(0.22+0.5*uTrip);
  float ir=exp(-r*1.8)*smoothstep(0.10,0.0,abs(sin(r*34.0-t*1.8))-0.06);
  col+=pal(r*2.0-t*0.05+0.5+uHue)*ir*(0.2+0.55*uTrip);
  col*=1.0-0.30*r;
  col*=(0.88+0.12*sin(t*0.4))*(1.0-uDark*0.55);
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

export const Render2D={
  built:false, active:false,
  view:null, gl:null, prog:null, tex:null, uni:{},
  game:null, ctx:null,
  rect:[0,0,1,1], cssRect:{x:0,y:0,w:1,h:1},
  orbs:[], hue:0, themeHue:0, themeDark:0,

  ensure(){
    if(this.built) return;
    this.built=true;
    this.view=document.getElementById('view2d');
    this.game=document.createElement('canvas');
    this.game.width=W; this.game.height=H;
    this.ctx=this.game.getContext('2d');
    this.ctx.imageSmoothingEnabled=false;
    const gl=this.gl=this.view.getContext('webgl',{antialias:false,alpha:false});
    if(!gl) return;
    const sh=(type,src)=>{
      const s=gl.createShader(type);
      gl.shaderSource(s,src); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog=this.prog=gl.createProgram();
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
    for(const n of ['uRes','uT','uTrip','uCam','uWin','uHue','uDark','uRect','uTex']) this.uni[n]=gl.getUniformLocation(prog,n);
    this.tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.uniform1i(this.uni.uTex,0);
    this.resize();
  },
  show(){ this.ensure(); this.active=true; document.getElementById('stage2d').classList.remove('hidden'); this.resize(); },
  hide(){ this.active=false; document.getElementById('stage2d').classList.add('hidden'); },
  resize(fw,fh){
    if(!this.built) return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    let cw=fw||Math.floor((innerWidth||1280)*dpr), ch=fh||Math.floor((innerHeight||720)*dpr);
    if(cw<8||ch<8){ cw=1280; ch=720; }
    this.view.width=cw; this.view.height=ch;
    if(this.gl) this.gl.viewport(0,0,cw,ch);
    const s=Math.min(cw/W,ch/H);
    this.rect=[(cw-W*s)/2,(ch-H*s)/2,W*s,H*s];
    this.cssRect={x:this.rect[0],y:(ch-this.rect[1]-this.rect[3]),w:this.rect[2],h:this.rect[3]};
    this.cssRect.y=this.rect[1]; // centered letterbox → same either origin
  },
  forceSize(w,h){ this.ensure(); this.resize(w,h); },
  onLevel(){
    this.ensure();
    const th=G.level.theme||{hue:0,dark:0};
    this.themeHue=th.hue/360; this.themeDark=th.dark;
    this.orbs=[];
    for(let i=0;i<26;i++) this.orbs.push({x:Math.random()*G.LW*TILE,y:40+Math.random()*(H-160),r:2+Math.random()*5,p:0.25+Math.random()*0.4,hue:Math.random()*360,ph:Math.random()*TAU});
  },
  /** Normalized (0..1) screen position for a world point — HUD scales it. */
  worldToScreenN(x,y){
    const r=this.cssRect;
    return [(r.x+(x-G.camX)/W*r.w)/this.view.width,(r.y+y/H*r.h)/this.view.height];
  },
  uiScale(){ return this.cssRect.w/W; },

  render(){
    if(!this.built||!this.active) return;
    this.hue=(G.gt*14+(this.themeHue*360))%360;
    const ctx=this.ctx;
    ctx.clearRect(0,0,W,H);
    this.drawHills(); this.drawOrbs();
    this.drawCheckpoint(); this.drawGate();
    this.drawItems();
    this.drawTiles();
    this.drawBones();
    this.drawBalls();
    this.drawEnemies();
    this.drawPlayer();
    this.drawParts();
    // composite
    const gl=this.gl;
    if(!gl){ return; }
    gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.game);
    gl.uniform2f(this.uni.uRes,this.view.width,this.view.height);
    gl.uniform1f(this.uni.uT,G.gt);
    gl.uniform1f(this.uni.uTrip,G.trip);
    gl.uniform1f(this.uni.uCam,G.camX);
    gl.uniform1f(this.uni.uWin,G.state==='win'?Math.min(1,G.winT):0);
    gl.uniform1f(this.uni.uHue,this.themeHue);
    gl.uniform1f(this.uni.uDark,this.themeDark);
    gl.uniform4f(this.uni.uRect,this.rect[0],this.rect[1],this.rect[2],this.rect[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  },

  // ---------- world drawing ----------
  drawHills(){
    const ctx=this.ctx, gt=G.gt, hue=this.hue;
    const layers=[
      {p:0.25,amp:34,base:H-150,al:0.20,ho:140},
      {p:0.45,amp:52,base:H-95,al:0.30,ho:250},
    ];
    for(const L of layers){
      ctx.beginPath(); ctx.moveTo(0,H);
      for(let x=0;x<=W;x+=16){
        const y=L.base+Math.sin((x+G.camX*L.p)*0.008+gt*0.25)*L.amp*(1+0.2*Math.sin(gt*0.5))
                +Math.sin((x+G.camX*L.p)*0.021-gt*0.15)*L.amp*0.4;
        ctx.lineTo(x,y);
      }
      ctx.lineTo(W,H); ctx.closePath();
      ctx.fillStyle=`hsla(${(hue+L.ho)%360},60%,30%,${L.al})`;
      ctx.fill();
    }
  },
  drawOrbs(){
    const ctx=this.ctx, gt=G.gt, hue=this.hue;
    for(const o of this.orbs){
      const x=o.x-G.camX*o.p;
      if(x<-20||x>W+20) continue;
      const y=o.y+Math.sin(gt*0.8+o.ph)*14;
      ctx.fillStyle=`hsla(${(o.hue+hue*2)%360},95%,72%,${0.25+0.2*Math.sin(gt*2+o.ph)})`;
      ctx.beginPath(); ctx.arc(x,y,o.r*(1+0.3*Math.sin(gt*1.5+o.ph)),0,TAU); ctx.fill();
    }
  },
  rr(x,y,w,h,rad){ const g=this.ctx; g.beginPath(); if(g.roundRect) g.roundRect(x,y,w,h,rad); else g.rect(x,y,w,h); g.fill(); },
  drawTiles(){
    const ctx=this.ctx, gt=G.gt, hue=this.hue;
    const c0=Math.max(0,Math.floor(G.camX/TILE)-1), c1=Math.min(G.LW-1,Math.ceil((G.camX+W)/TILE)+1);
    for(let c=c0;c<=c1;c++){
      const wob=Math.sin(gt*1.8+c*0.45)*2.4*G.trip;
      for(let r=0;r<ROWS;r++){
        const t=tget(c,r);
        if(!t) continue;
        const key=c+','+r;
        let by=0;
        const bAnim=G.bounceAnim[key];
        if(bAnim>0) by=-Math.sin((10-bAnim)/10*Math.PI)*8;
        const x=c*TILE-G.camX, y=r*TILE+wob+by;
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
          this.rr(x+1,y+2,TILE-2,11,5);
          ctx.fillStyle=`hsla(${(hue+150)%360},100%,80%,${0.3+0.2*Math.sin(gt*3+c)})`;
          ctx.fillRect(x+4,y+14,TILE-8,3);
        } else if(t===8){
          // bounce bloom: springy coil + glowing petal pad
          const squish=1+0.15*Math.sin(gt*6+c);
          ctx.strokeStyle=`hsl(${(hue+110)%360},70%,55%)`;
          ctx.lineWidth=2.5;
          for(let i=0;i<3;i++){
            ctx.beginPath();
            ctx.ellipse(x+16,y+26-i*5,9-i*1.5,3,0,0,TAU);
            ctx.stroke();
          }
          const g=ctx.createRadialGradient(x+16,y+8,2,x+16,y+8,15);
          g.addColorStop(0,'#f4ffb0');
          g.addColorStop(0.6,`hsl(${(hue+90)%360},95%,62%)`);
          g.addColorStop(1,`hsla(${(hue+90)%360},95%,55%,0.25)`);
          ctx.fillStyle=g;
          ctx.beginPath(); ctx.ellipse(x+16,y+9,14,6*squish,0,0,TAU); ctx.fill();
          for(let p=0;p<6;p++){
            const a=p/6*TAU+gt*1.5;
            ctx.fillStyle=`hsla(${(hue+90+p*20)%360},95%,72%,0.85)`;
            ctx.beginPath(); ctx.ellipse(x+16+Math.cos(a)*13,y+9+Math.sin(a)*4.5,4,2.4,a,0,TAU); ctx.fill();
          }
        }
      }
    }
  },
  drawBones(){
    const ctx=this.ctx, gt=G.gt, hue=this.hue;
    for(const b of G.bonesArr){
      if(b.taken) continue;
      const x=b.x-G.camX;
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
  },
  drawBalls(){
    const ctx=this.ctx, gt=G.gt;
    for(const bl of G.ballsArr){
      if(bl.taken) continue;
      const x=bl.x-G.camX;
      if(x<-40||x>W+40) continue;
      const y=bl.y+Math.sin(gt*2.2+bl.t)*4;
      ctx.save(); ctx.translate(x,y); ctx.rotate(gt*2+bl.t);
      ctx.fillStyle=`hsla(${(this.hue*3+70)%360},100%,75%,0.35)`;
      ctx.beginPath(); ctx.arc(0,0,16,0,TAU); ctx.fill();
      ctx.fillStyle='#d7f74a';
      ctx.beginPath(); ctx.arc(0,0,10,0,TAU); ctx.fill();
      ctx.strokeStyle='#fdfef2'; ctx.lineWidth=2.2;
      ctx.beginPath(); ctx.arc(-9,0,10.5,-0.9,0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(9,0,10.5,Math.PI-0.9,Math.PI+0.9); ctx.stroke();
      ctx.restore();
    }
  },
  drawEnemies(){
    for(const e of G.enemies){
      if(!e.alive&&!e.dying) continue;
      const sx=e.x-G.camX;
      if(sx<-60||sx>W+60) continue;
      if(e.type==='shroom') this.drawShroom(e);
      else this.drawJelly(e);
    }
  },
  drawShroom(e){
    const ctx=this.ctx, gt=G.gt, hue=this.hue;
    const x=e.x-G.camX+e.w/2, y=e.y+e.h;
    const hueE=(hue*2+e.hueOff)%360;
    ctx.save(); ctx.translate(x,y);
    if(e.dying){ ctx.scale(1.35,Math.max(0.12,e.squash)); ctx.globalAlpha=Math.max(0,e.squash); }
    const step=e.dying?0:Math.sin(gt*11+e.hueOff)*2.4;
    ctx.fillStyle='#4a3a52';
    ctx.fillRect(-8+step,-4,6,4); ctx.fillRect(2-step,-4,6,4);
    ctx.fillStyle='#f3e9dc';
    this.rr(-9,-16,18,13,4);
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
  },
  drawJelly(e){
    const ctx=this.ctx, gt=G.gt, hue=this.hue;
    const x=e.x-G.camX+e.w/2, y=e.y+e.h/2;
    const hueE=(hue*3+e.hueOff)%360;
    ctx.save(); ctx.translate(x,y);
    if(e.dying){ ctx.scale(1.2,Math.max(0.1,e.squash)); ctx.globalAlpha=Math.max(0,e.squash); }
    ctx.fillStyle=`hsla(${hueE},95%,70%,0.25)`;
    ctx.beginPath(); ctx.arc(0,0,20,0,TAU); ctx.fill();
    ctx.fillStyle=`hsl(${(hueE+180)%360},60%,30%)`;
    for(const a of [-0.85,-0.5,-0.15]){
      const bx=Math.cos(a*Math.PI)*11, byy=Math.sin(a*Math.PI)*11;
      ctx.beginPath();
      ctx.moveTo(bx*0.8,byy*0.8);
      ctx.lineTo(bx*1.7,byy*1.7);
      ctx.lineTo(bx*0.8+4,byy*0.8+2);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle=`hsla(${hueE},80%,65%,0.8)`; ctx.lineWidth=2;
    for(let i=0;i<4;i++){
      const bx=-9+i*6;
      ctx.beginPath(); ctx.moveTo(bx,9);
      ctx.quadraticCurveTo(bx+Math.sin(gt*5+i)*4,16,bx+Math.sin(gt*5+i+1)*6,22);
      ctx.stroke();
    }
    ctx.fillStyle='#f8f4ec'; ctx.beginPath(); ctx.arc(0,0,12,0,TAU); ctx.fill();
    ctx.fillStyle=`hsl(${hueE},90%,55%)`; ctx.beginPath(); ctx.arc(0,0,7,0,TAU); ctx.fill();
    const px=clamp((G.P.x-e.x)*0.02,-3,3);
    ctx.fillStyle='#1a1218'; ctx.beginPath(); ctx.arc(px,0,3.4,0,TAU); ctx.fill();
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(px-1.4,-1.4,1.2,0,TAU); ctx.fill();
    ctx.restore();
  },
  drawItems(){
    const ctx=this.ctx;
    for(const it of G.items){
      const x=it.x-G.camX+it.w/2, y=it.y+it.h;
      ctx.save(); ctx.translate(x,y);
      if(it.type==='shroom'){
        ctx.fillStyle='#f6ecd9'; this.rr(-6,-13,12,12,3);
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
  },
  drawCheckpoint(){
    const ctx=this.ctx, gt=G.gt, hue=this.hue, L=G.level;
    const x=L.checkpointX-G.camX;
    if(x<-60||x>W+60) return;
    ctx.save(); ctx.translate(x+12,L.cpY);
    ctx.fillStyle=G.checkpointHit?`hsl(${(hue*3)%360},70%,55%)`:'#5a4e66';
    this.rr(-10,-48,20,48,6);
    ctx.fillStyle='#f8f4ec';
    ctx.beginPath(); ctx.ellipse(0,-34,7,G.checkpointHit?7:2,0,0,TAU); ctx.fill();
    if(G.checkpointHit){
      ctx.fillStyle=`hsl(${(hue*4)%360},90%,50%)`;
      ctx.beginPath(); ctx.arc(0,-34,3.6,0,TAU); ctx.fill();
      ctx.fillStyle=`hsla(${(hue*4)%360},90%,70%,0.4)`;
      ctx.beginPath(); ctx.arc(0,-34,12+2*Math.sin(gt*4),0,TAU); ctx.fill();
    }
    ctx.restore();
  },
  drawGate(){
    const ctx=this.ctx, gt=G.gt, hue=this.hue, L=G.level;
    const x=L.gateX-G.camX;
    if(x<-260||x>W+260) return;
    const gy=L.gateY;
    const cx=x+16, cy=gy-118;
    for(const dx of [-74,58]){
      const g=ctx.createLinearGradient(x+dx,0,x+dx+18,0);
      g.addColorStop(0,`hsl(${(hue+260)%360},60%,30%)`);
      g.addColorStop(0.5,`hsl(${(hue+260)%360},75%,55%)`);
      g.addColorStop(1,`hsl(${(hue+260)%360},60%,28%)`);
      ctx.fillStyle=g;
      this.rr(x+dx,gy-190,18,190,8);
    }
    const open=G.state==='win'?Math.min(1,G.winT*1.5):0.55+0.1*Math.sin(gt*1.2);
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
    ctx.beginPath(); ctx.arc(0,0,(G.state==='win'?12:7)*open+2,0,TAU); ctx.fill();
    ctx.strokeStyle=`hsla(${(hue*2)%360},100%,75%,${0.35+0.3*open})`; ctx.lineWidth=3;
    for(let i=0;i<12;i++){
      const a=i/12*TAU+gt*0.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*70,Math.sin(a)*70);
      ctx.lineTo(Math.cos(a)*(84+6*Math.sin(gt*3+i)),Math.sin(a)*(84+6*Math.sin(gt*3+i)));
      ctx.stroke();
    }
    ctx.restore();
  },
  charPal(p){
    const base=p.char.pal;
    if(p.star>0){
      const h=(G.gt*420)%360;
      return {...base,
        body:`hsl(${(h+180)%360},70%,88%)`, head:`hsl(${h},85%,66%)`,
        ear:`hsl(${(h+50)%360},85%,55%)`, chest:`hsl(${(h+200)%360},70%,92%)`,
        belly:`hsl(${(h+220)%360},70%,82%)`, snout:`hsl(${(h+180)%360},70%,90%)`};
    }
    return base;
  },
  drawPlayer(){
    for(const p of G.players) this.drawOneDog(p);
  },
  drawOneDog(P){
    const ctx=this.ctx;
    if(P.inv>0&&Math.floor(G.gt*18)%2===0&&G.state==='play') return;
    const cx=P.x-G.camX+P.w/2, feet=P.y+P.h;
    if(cx<-60||cx>W+60) return;
    const pal=this.charPal(P), shape=P.char.shape;
    if(P.big){
      const g=ctx.createRadialGradient(cx,feet-20,4,cx,feet-20,40);
      g.addColorStop(0,`hsla(${(this.hue*4)%360},95%,70%,0.35)`);
      g.addColorStop(1,'hsla(0,0%,0%,0)');
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(cx,feet-20,40,0,TAU); ctx.fill();
    }
    const u=P.big?2.25:1.9;
    const sitting=(P.idleT>4||G.state==='win');
    if(sitting){
      ctx.save(); ctx.translate(cx,feet);
      sitSprite(ctx,pal,shape,P.big,Math.sin(G.gt*2)*0.4,u);
      ctx.restore();
      return;
    }
    this.drawDogSide(P,cx,feet,pal,shape,P.big,u);
  },
  drawDogSide(P,cx,feet,pal,shape,big,u){
    const ctx=this.ctx, gt=G.gt;
    const spd=Math.abs(P.vx);
    ctx.save();
    ctx.translate(cx,feet);
    if(P.spinning){ ctx.translate(0,-9*u); ctx.rotate(P.spinA*P.dir); ctx.translate(0,9*u); }
    ctx.scale(P.dir,1);
    const R=(x,y,w,h,c)=>{ ctx.fillStyle=c; ctx.fillRect(x*u,y*u,w*u,h*u); };
    const air=!P.grounded, rising=P.vy<-0.5;
    const LH=shape.legH;                 // leg height
    const bB=-LH+2, bT=bB-8;             // body bottom / top
    const dy=bT+12;                      // body anchor offset (0 for Rue)
    const nk=shape.neck||0;
    const hy=dy-nk;                      // head anchor offset
    // tail
    const wag=Math.sin(gt*(spd>0.3?14:6))*1.6;
    R(-13.5,dy-12,2.5,2.5,pal.tailBase);
    R(-16,dy-13.5+wag,3,3,pal.tailTip);
    // legs
    const sw=air?0:Math.sin(P.runPhase*TAU)*(spd>0.2?2.4:0);
    if(air){
      if(rising){ R(-9,-LH+1,2.4,LH-2,pal.body); R(-5.5,-LH+1,2.4,LH-2,pal.body); R(5.5,-LH,2.4,LH,pal.body); R(9,-LH,2.4,LH,pal.body); }
      else { R(-10.5,-LH,2.4,LH,pal.body); R(-5,-LH+2,2.4,LH-2,pal.body); R(4,-LH+2,2.4,LH-2,pal.body); R(9.5,-LH,2.4,LH,pal.body); }
    } else {
      R(-10.5+sw,-LH,2.4,LH,pal.belly);
      R(-6.5-sw,-LH,2.4,LH,pal.body);
      R(4.5+sw*0.8,-LH,2.4,LH,pal.belly);
      R(8.5-sw*0.8,-LH,2.4,LH,pal.body);
    }
    // body
    R(-13,dy-11,2,6,pal.body);
    R(-12,dy-12,21,8,pal.body);
    if(shape.saddle) R(-9,dy-12.8,9,3,pal.head);
    R(-8,bB-1.7,13,1.8,pal.belly);
    if(shape.spots){ R(-6,bB-1.5,1.3,1.3,pal.spot); R(-2,bB-1,1.3,1.3,pal.spot); R(-8.5,bB-0.8,1,1,pal.spot); }
    // harness
    R(0,dy-12.3,3,8.4,pal.harA);
    R(1.1,dy-12.3,0.9,8.4,pal.harB);
    // chest
    R(7,dy-11,4,7,pal.chest);
    // neck (iggy)
    if(nk>0){ R(7.5,bT-nk-1,6,nk+3,pal.head); R(9.5,bT-nk-1,3,nk+3,pal.chest); }
    // head
    R(7,hy-19,10,8.6,pal.head);
    if(shape.blaze) R(12.6,hy-19,1.8,5.4,pal.chest);
    // far ear
    const earUp=air;
    if(shape.earStyle==='rose'){
      if(earUp) R(7.8,hy-22,2,3.2,pal.ear);
      else R(7.2,hy-20.6,3,1.8,pal.ear);
    } else {
      if(earUp){ R(7.6,hy-23.5,2.4,5,pal.ear); } else { R(7.4,hy-20.8,2.6,2.2,pal.ear); }
    }
    // snout + nose
    R(14,hy-16.6,5.6,3.6,pal.snout);
    R(18.4,hy-17.1,2.3,2.3,pal.nose);
    if(spd>3.4&&P.grounded){ R(15.5,hy-13.2,2,2.6,pal.tongue); }
    R(14.5,hy-13.4,3,0.8,pal.muz);
    // eye
    R(11.3,hy-17.6,2.3,2.5,pal.eye);
    R(12.5,hy-17.3,0.9,0.9,'#fff');
    // near ear
    if(shape.earStyle==='rose'){
      if(earUp){ R(10.8,hy-22.6,2.2,4,pal.ear); R(11.2,hy-22,1.2,2.6,pal.belly); }
      else { R(10.2,hy-21,3.6,2,pal.ear); R(9.4,hy-20.2,2,1.6,pal.ear); }
    } else {
      if(earUp){
        R(11.5,hy-24.5,2.8,6,pal.ear);
        R(11.9,hy-23.9,1.4,4,pal.head);
      } else {
        R(10.5,hy-21.4,3.4,2.4,pal.ear);
        R(9,hy-19.8,2.8,2.8,pal.ear);
      }
    }
    if(big){ R(11,hy-19.8,1.6,1.6,'#ffd75e'); }
    ctx.restore();
  },
  drawParts(){
    const ctx=this.ctx;
    for(const p of G.parts){
      ctx.globalAlpha=Math.max(0,p.l/p.l0);
      ctx.fillStyle=`hsl(${p.h%360},${p.s*100}%,${p.ll*100}%)`;
      ctx.beginPath(); ctx.arc(p.x-G.camX,p.y,p.sz*(p.l/p.l0),0,TAU); ctx.fill();
    }
    ctx.globalAlpha=1;
  },
};
