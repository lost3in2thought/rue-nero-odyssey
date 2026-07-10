/* ============================================================
   PAWS ENGINE — 3D renderer (odyssey mode)
   Three.js scene · HDR bloom · feedback trails · chroma ·
   kaleidoscope skydome · sacred-geometry set dressing.
   Character rigs are built from CHARS[..].rig configs.
   ============================================================ */
import * as THREE from 'three';
import {TILE,ROWS,VIEW_W as W,VIEW_H as H,TAU,clamp,lerp,isMobile,Save} from './shared.js';
import {G,tget,isSolid} from './logic.js';

function stdM(c,rough=0.75,extra={}){ return new THREE.MeshStandardMaterial({color:c,roughness:rough,...extra}); }

const SKY_FSH=`
precision highp float;
varying vec3 vP; uniform float uT; uniform float uTrip; uniform float uHue; uniform float uDark;
vec3 pal(float t){ return 0.5+0.5*cos(6.28318*(t+vec3(0.0,0.33,0.67))); }
void main(){
  vec3 d=normalize(vP);
  float el=asin(clamp(d.y,-1.,1.));
  float az=atan(d.z,d.x);
  float N=10.0;
  float seg=6.28318/N;
  float af=mod(az+uT*0.05,seg)-seg*0.5;
  float w=sin(af*10.0+uT*0.7)+sin(el*16.0-uT*0.8)+sin((af+el)*9.0+uT*0.4);
  vec3 col=pal(w*0.13+el*0.5-uT*0.02+uHue)*(0.13+0.18*uTrip);
  float lat=abs(sin(az*12.0+sin(el*9.0+uT*0.7)*1.5))*abs(sin(el*14.0-uT*0.5));
  col+=vec3(1.0,0.78,0.4)*pow(max(0.0,1.0-lat),16.0)*(0.22+0.45*uTrip);
  float ang=acos(clamp(dot(d,vec3(0.,0.,-1.)),-1.,1.));
  float rings=smoothstep(0.10,0.0,abs(sin(ang*22.0-uT*1.5))-0.05);
  col+=pal(ang*2.0-uT*0.08+0.5+uHue)*rings*exp(-ang*1.1)*(0.22+0.45*uTrip);
  col+=pal(uT*0.03+uHue)*exp(-abs(el+0.25)*3.0)*0.07;
  col*=(1.0-uDark*0.5);
  gl_FragColor=vec4(col,1.0);
}`;
const QUAD_VSH=`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

export const Render3D={
  built:false, active:false, lastChar:null, resScale:1,
  view:null, renderer:null, scene:null, camera:null,
  rtScene:null, rtBloomA:null, rtBloomB:null, rtOut:null, rtPrev:null,
  worldGroup:null, actorGroup:null,
  world:{}, dog:null, bonesMesh:null,
  camPos:new THREE.Vector3(480,-270,545), camAim:new THREE.Vector3(480,-264,0),
  _v:new THREE.Vector3(), _m:new THREE.Matrix4(), _q:new THREE.Quaternion(), _e:new THREE.Euler(), _s:new THREE.Vector3(), _c:new THREE.Color(),

  // ---------------- lifecycle ----------------
  ensure(){
    if(this.built) return;
    this.built=true;
    this.view=document.getElementById('view3d');
    const renderer=this.renderer=new THREE.WebGLRenderer({canvas:this.view,antialias:false,alpha:false,powerPreference:'high-performance'});
    renderer.toneMapping=THREE.NoToneMapping;
    renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
    const scene=this.scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x0b0518,0.00048);
    this.camera=new THREE.PerspectiveCamera(55,16/9,10,4000);
    scene.add(new THREE.AmbientLight(0x9080b8,0.85));
    this.dirL=new THREE.DirectionalLight(0xfff2e0,1.6);
    scene.add(this.dirL); scene.add(this.dirL.target);
    this.dogLight=new THREE.PointLight(0xff88ff,3.2,520,0.9);
    scene.add(this.dogLight);
    this.gateLight=new THREE.PointLight(0x88aaff,4.0,700,0.9);
    scene.add(this.gateLight);
    // sky
    this.skyMat=new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false,fog:false,
      uniforms:{uT:{value:0},uTrip:{value:0.4},uHue:{value:0},uDark:{value:0}},
      vertexShader:`varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:SKY_FSH,
    });
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(1800,48,32),this.skyMat);
    scene.add(this.sky);
    // lattice shells
    this.shellMatA=new THREE.MeshBasicMaterial({wireframe:true,transparent:true,opacity:0.20,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,color:0xff66cc});
    this.shellMatB=this.shellMatA.clone(); this.shellMatB.opacity=0.13;
    this.shellA=new THREE.Mesh(new THREE.IcosahedronGeometry(760,2),this.shellMatA);
    this.shellB=new THREE.Mesh(new THREE.IcosahedronGeometry(520,1),this.shellMatB);
    scene.add(this.shellA,this.shellB);
    // rings
    this.rings=[];
    const ringGeo=new THREE.TorusGeometry(1,0.018,8,90);
    for(let i=0;i<8;i++){
      const m=new THREE.MeshBasicMaterial({transparent:true,opacity:0.5,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
      const r=new THREE.Mesh(ringGeo,m);
      r.scale.setScalar(110+i*46);
      r.position.set(400+i*760,-(140+(i%3)*120),-(220+(i%4)*90));
      r.userData={spin:0.05+((i*0.37)%1)*0.12,hue:(i*47)%360};
      this.rings.push(r); scene.add(r);
    }
    // distant blinking eyes
    this.eyeSprites=[];
    const texs=[this.eyeTexture(280),this.eyeTexture(160),this.eyeTexture(30)];
    for(let i=0;i<14;i++){
      const m=new THREE.SpriteMaterial({map:texs[i%3],transparent:true,opacity:0.55,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
      const s=new THREE.Sprite(m);
      const sc=36+((i*0.61)%1)*60;
      s.scale.set(sc,sc*0.7,1);
      s.position.set(((i*0.77)%1)*6000,-(80+((i*0.41)%1)*380),-(240+((i*0.23)%1)*300));
      s.userData={ph:i*1.3,base:sc};
      this.eyeSprites.push(s); scene.add(s);
    }
    // particles
    this.initParticles();
    // post pipeline
    this.initPost();
    this.worldGroup=new THREE.Group(); scene.add(this.worldGroup);
    this.actorGroup=new THREE.Group(); scene.add(this.actorGroup);
    this.resize();
  },
  show(){
    this.ensure(); this.active=true;
    document.getElementById('stage3d').classList.remove('hidden');
    G.hooks.onBlockUsed=k=>{ const m=this.world.qMeshes&&this.world.qMeshes[k]; if(m) m.material=this.world.usedMat; };
    G.hooks.onBrickBreak=k=>this.hideBrick(k);
    G.hooks.onEnemyGone=e=>{ if(e._rig){ this.actorGroup.remove(e._rig); e._rig=null; } };
    G.hooks.onItemGone=it=>{ if(it._rig){ this.actorGroup.remove(it._rig); it._rig=null; } };
    this.resize();
  },
  hide(){ this.active=false; document.getElementById('stage3d').classList.add('hidden'); },
  setQuality(q){
    this.resScale=q==='low'?0.5:q==='medium'?0.75:q==='high'?1:(isMobile?0.6:1);
    if(this.built) this.resize();
  },
  resize(fw,fh){
    if(!this.built) return;
    const dpr=Math.min(window.devicePixelRatio||1,isMobile?1.5:1.75)*this.resScale;
    let cw=fw||Math.floor((innerWidth||1280)*dpr), ch=fh||Math.floor((innerHeight||720)*dpr);
    if(cw<8||ch<8){ cw=1280; ch=720; }
    this.renderer.setSize(cw,ch,false);
    this.camera.aspect=cw/ch;
    this.camera.updateProjectionMatrix();
    this.allocRTs(cw,ch);
  },
  forceSize(w,h){ this.ensure(); this.resize(w,h); },

  // ---------------- textures ----------------
  eyeTexture(h){
    const c=document.createElement('canvas'); c.width=c.height=128;
    const g=c.getContext('2d');
    const grd=g.createRadialGradient(64,64,4,64,64,62);
    grd.addColorStop(0,`hsla(${h},90%,70%,0.9)`); grd.addColorStop(1,'hsla(0,0%,0%,0)');
    g.fillStyle=grd; g.fillRect(0,0,128,128);
    g.save();
    g.beginPath(); g.ellipse(64,64,46,26,0,0,TAU); g.clip();
    g.fillStyle='#f5efe2'; g.fillRect(0,0,128,128);
    const ir=g.createRadialGradient(64,64,2,64,64,22);
    ir.addColorStop(0,`hsl(${(h+40)%360},95%,65%)`); ir.addColorStop(1,`hsl(${h},95%,35%)`);
    g.fillStyle=ir; g.beginPath(); g.arc(64,64,20,0,TAU); g.fill();
    g.fillStyle='#120a16'; g.beginPath(); g.arc(64,64,9,0,TAU); g.fill();
    g.fillStyle='rgba(255,255,255,0.9)'; g.beginPath(); g.arc(58,58,3.5,0,TAU); g.fill();
    g.restore();
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
    return t;
  },
  qTexture(){
    const c=document.createElement('canvas'); c.width=c.height=64;
    const g=c.getContext('2d');
    g.fillStyle='#f7c531'; g.fillRect(0,0,64,64);
    g.strokeStyle='rgba(255,255,255,0.8)'; g.lineWidth=4; g.strokeRect(4,4,56,56);
    g.fillStyle='#6b3b00'; g.font='bold 42px Consolas,monospace'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText('?',32,36);
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
    return t;
  },

  // ---------------- geometry helpers ----------------
  mergeGeoms(list){
    let pos=[],norm=[];
    for(const g0 of list){
      const g=g0.index?g0.toNonIndexed():g0;
      pos.push(...g.attributes.position.array);
      norm.push(...g.attributes.normal.array);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));
    return g;
  },
  xform(geo,x,y,z,rx,ry,rz,s){
    const m=new THREE.Matrix4()
      .makeTranslation(x,y,z)
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx||0,ry||0,rz||0)))
      .multiply(new THREE.Matrix4().makeScale(s||1,s||1,s||1));
    return geo.clone().applyMatrix4(m);
  },
  disposeGroup(gr){
    gr.traverse(o=>{
      if(o.geometry) o.geometry.dispose();
      if(o.material) (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ if(m.map)m.map.dispose(); m.dispose(); });
    });
  },

  // ---------------- world (re)build per level ----------------
  onLevel(){
    this.ensure();
    const th=G.level.theme||{hue:0,dark:0};
    this.themeHue=th.hue/360; this.themeDark=th.dark;
    this.skyMat.uniforms.uHue.value=this.themeHue;
    this.skyMat.uniforms.uDark.value=this.themeDark;
    this.scene.remove(this.worldGroup); this.disposeGroup(this.worldGroup);
    this.scene.remove(this.actorGroup); this.disposeGroup(this.actorGroup);
    for(const e of G.enemies) e._rig=null;
    this.worldGroup=new THREE.Group(); this.scene.add(this.worldGroup);
    this.actorGroup=new THREE.Group(); this.scene.add(this.actorGroup);
    this.buildWorld();
    if(this.lastChar!==G.char.id){ this.buildDog(); }
    this.camPos.set(G.P.x+W/2,-270,545);
    this.camAim.set(G.P.x+W/2,-264,0);
  },
  buildWorld(){
    const world=this.world={qMeshes:{},brickIdx:{},lotusMeshes:[],padMats:[]};
    const m4=this._m, col=this._c;
    const LW=G.LW;
    const groundCells=[], lipCells=[];
    for(let c=0;c<LW;c++) for(let r=0;r<ROWS;r++){
      if(tget(c,r)===1){
        groundCells.push([c,r]);
        if(!isSolid(tget(c,r-1))) lipCells.push([c,r]);
      }
    }
    world.groundMat=stdM(0xffffff,0.85,{metalness:0.05});
    const gMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(TILE,TILE,46),world.groundMat,groundCells.length);
    groundCells.forEach(([c,r],i)=>{
      m4.makeTranslation(c*TILE+16,-(r*TILE+16),0);
      gMesh.setMatrixAt(i,m4);
      const depth=(r-8)/9;
      const n=Math.sin(c*12.9898+r*78.233)*43758.5453;
      const jitter=(n-Math.floor(n))*0.14;
      col.setHSL((0.68+this.themeHue+c*0.0009+jitter*0.3)%1,0.5+jitter,clamp(0.30-depth*0.10+jitter*0.5,0.12,0.45));
      gMesh.setColorAt(i,col);
    });
    gMesh.instanceMatrix.needsUpdate=true;
    if(gMesh.instanceColor) gMesh.instanceColor.needsUpdate=true;
    this.worldGroup.add(gMesh);
    world.lipMat=stdM(0x44ff99,0.4,{emissive:0x22cc66,emissiveIntensity:1.4});
    const lipMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(TILE,7,52),world.lipMat,lipCells.length);
    lipCells.forEach(([c,r],i)=>{
      m4.makeTranslation(c*TILE+16,-(r*TILE)-3.5,0);
      lipMesh.setMatrixAt(i,m4);
    });
    lipMesh.instanceMatrix.needsUpdate=true;
    this.worldGroup.add(lipMesh);
    // dream-crystals
    world.crystalMat=stdM(0xffffff,0.15,{emissive:0xffffff,emissiveIntensity:0.9});
    const cryCells=lipCells.filter(([c])=>{ const n=Math.sin(c*91.7)*43758.5453; return (n-Math.floor(n))<0.30; });
    if(cryCells.length){
      const cryMesh=new THREE.InstancedMesh(new THREE.OctahedronGeometry(5),world.crystalMat,cryCells.length);
      const q=this._q, sc=this._s, pos=this._v;
      cryCells.forEach(([c,r],i)=>{
        const n=Math.sin(c*17.3)*43758.5453, f=n-Math.floor(n);
        pos.set(c*TILE+8+f*16,-(r*TILE)+5+f*4,14+f*8);
        q.setFromEuler(new THREE.Euler(f*2,f*6,f*3));
        sc.setScalar(0.5+f*1.1);
        m4.compose(pos,q,sc);
        cryMesh.setMatrixAt(i,m4);
        col.setHSL((0.05+f*0.9)%1,0.9,0.62);
        cryMesh.setColorAt(i,col);
      });
      cryMesh.instanceMatrix.needsUpdate=true;
      if(cryMesh.instanceColor) cryMesh.instanceColor.needsUpdate=true;
      this.worldGroup.add(cryMesh);
    }
    // bricks
    const brickCells=[];
    for(let c=0;c<LW;c++) for(let r=0;r<ROWS;r++) if(tget(c,r)===2) brickCells.push([c,r]);
    world.brickMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(TILE-2,TILE-2,34),stdM(0xcc7a3a,0.6,{emissive:0x552200,emissiveIntensity:0.35}),Math.max(1,brickCells.length));
    brickCells.forEach(([c,r],i)=>{
      m4.makeTranslation(c*TILE+16,-(r*TILE+16),0);
      world.brickMesh.setMatrixAt(i,m4);
      world.brickIdx[c+','+r]=i;
    });
    world.brickMesh.count=brickCells.length;
    world.brickMesh.instanceMatrix.needsUpdate=true;
    this.worldGroup.add(world.brickMesh);
    // question blocks
    const qtex=this.qTexture();
    world.qMat=new THREE.MeshStandardMaterial({map:qtex,emissiveMap:qtex,emissive:0xffffff,emissiveIntensity:0.9,roughness:0.35});
    world.usedMat=stdM(0x59506b,0.8);
    const qGeo=new THREE.BoxGeometry(TILE-2,TILE-2,34);
    for(let c=0;c<LW;c++) for(let r=0;r<ROWS;r++) if(tget(c,r)===3){
      const mesh=new THREE.Mesh(qGeo,world.qMat);
      mesh.position.set(c*TILE+16,-(r*TILE+16),0);
      mesh.userData.baseY=-(r*TILE+16);
      world.qMeshes[c+','+r]=mesh;
      this.worldGroup.add(mesh);
    }
    // pipes
    const pipeMat=new THREE.MeshPhysicalMaterial({color:0xcc55ff,roughness:0.18,metalness:0.3,iridescence:1,iridescenceIOR:1.7,clearcoat:1,emissive:0x5511aa,emissiveIntensity:0.55});
    world.pipeGlowMat=new THREE.MeshBasicMaterial({color:0xff77ff,transparent:true,opacity:0.7,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
    for(let c=0;c<LW;c++) for(let r=0;r<ROWS;r++){
      if(tget(c,r)===5&&tget(c,r-1)!==5&&tget(c-1,r)!==5){
        let bot=r; while(tget(c,bot+1)===5) bot++;
        const hpx=(bot-r+1)*TILE;
        const cx=c*TILE+32, topY=-(r*TILE);
        const body=new THREE.Mesh(new THREE.CylinderGeometry(28,28,hpx,24),pipeMat);
        body.position.set(cx,topY-hpx/2,0);
        const cap=new THREE.Mesh(new THREE.CylinderGeometry(33,33,16,24),pipeMat);
        cap.position.set(cx,topY-8,0);
        const glow=new THREE.Mesh(new THREE.TorusGeometry(33,1.6,8,40),world.pipeGlowMat);
        glow.rotation.x=Math.PI/2; glow.position.set(cx,topY+1,0);
        this.worldGroup.add(body,cap,glow);
      }
    }
    // lotus pads
    const padMatA=stdM(0x7be8c8,0.4,{emissive:0x3ddc9c,emissiveIntensity:1.2});
    const padMatB=stdM(0xf08cc8,0.4,{emissive:0xe860ae,emissiveIntensity:1.2});
    world.padMats=[padMatA,padMatB];
    const padGeo=new THREE.CylinderGeometry(17,20,7,10);
    for(let c=0;c<LW;c++) for(let r=0;r<ROWS;r++) if(tget(c,r)===7){
      const mesh=new THREE.Mesh(padGeo,(c%2)?padMatA:padMatB);
      mesh.position.set(c*TILE+16,-(r*TILE)-4,0);
      world.lotusMeshes.push(mesh);
      this.worldGroup.add(mesh);
    }
    // bounce blooms
    world.bloomMat=stdM(0xd6ff5e,0.35,{emissive:0x9fdd22,emissiveIntensity:1.3});
    world.bloomMeshes=[];
    const coilMat=stdM(0x55cc66,0.5,{emissive:0x228833,emissiveIntensity:0.4});
    const petalMat=stdM(0xffe9f7,0.4,{emissive:0xff9ad4,emissiveIntensity:0.8});
    for(let c=0;c<LW;c++) for(let r=0;r<ROWS;r++) if(tget(c,r)===8){
      const g=new THREE.Group();
      g.position.set(c*TILE+16,-(r*TILE)-24,0);
      const coil=new THREE.Mesh(new THREE.CylinderGeometry(6,9,18,10),coilMat);
      coil.position.y=8; g.add(coil);
      const pad=new THREE.Mesh(new THREE.CylinderGeometry(15,13,6,12),world.bloomMat);
      pad.position.y=20; g.add(pad);
      for(let p=0;p<6;p++){
        const a=p/6*TAU;
        const petal=new THREE.Mesh(new THREE.SphereGeometry(4.4,8,6),petalMat);
        petal.scale.set(1.4,0.5,0.9);
        petal.position.set(Math.cos(a)*14,20,Math.sin(a)*14);
        petal.rotation.y=-a;
        g.add(petal);
      }
      g.userData={pad,ph:c*0.7};
      world.bloomMeshes.push(g);
      this.worldGroup.add(g);
    }
    // tennis balls (the squeaky five)
    world.ballMeshes=[];
    const ballMat=stdM(0xd7f74a,0.3,{emissive:0xa8d824,emissiveIntensity:1.0});
    const seamMat=stdM(0xffffff,0.4,{emissive:0xffffff,emissiveIntensity:0.45});
    for(const bl of G.ballsArr){
      const g=new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(11,16,12),ballMat));
      const seam=new THREE.Mesh(new THREE.TorusGeometry(10.2,1.1,6,32),seamMat);
      seam.rotation.x=0.9; seam.rotation.y=0.5;
      g.add(seam);
      const glow=new THREE.Mesh(new THREE.SphereGeometry(15,12,10),
        new THREE.MeshBasicMaterial({color:0xd7f74a,transparent:true,opacity:0.16,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
      g.add(glow);
      g.userData={bl};
      world.ballMeshes.push(g);
      this.worldGroup.add(g);
    }
    // bones (instanced)
    const boneGeo=this.mergeGeoms([
      this.xform(new THREE.CylinderGeometry(3.2,3.2,13,8),0,0,0,0,0,Math.PI/2),
      this.xform(new THREE.SphereGeometry(4.2,8,6),-7,3.4,0),
      this.xform(new THREE.SphereGeometry(4.2,8,6),-7,-3.4,0),
      this.xform(new THREE.SphereGeometry(4.2,8,6),7,3.4,0),
      this.xform(new THREE.SphereGeometry(4.2,8,6),7,-3.4,0),
    ]);
    this.bonesMesh=new THREE.InstancedMesh(boneGeo,stdM(0xfdf8ee,0.3,{emissive:0xfff6d8,emissiveIntensity:0.55}),Math.max(1,G.bonesArr.length));
    this.bonesMesh.count=G.bonesArr.length;
    this.worldGroup.add(this.bonesMesh);
    // checkpoint
    const L=G.level;
    const cpBase=new THREE.Mesh(new THREE.CylinderGeometry(9,12,44,8),stdM(0x5a4e70,0.7));
    cpBase.position.set(L.checkpointX+12,-(L.cpY)+22,0);
    world.cpCrystal=new THREE.Mesh(new THREE.OctahedronGeometry(11),stdM(0x9988bb,0.2,{emissive:0x442266,emissiveIntensity:0.5}));
    world.cpCrystal.position.set(L.checkpointX+12,-(L.cpY)+58,0);
    this.worldGroup.add(cpBase,world.cpCrystal);
    // the Great Eye gate
    const gGr=new THREE.Group();
    const pillarMat=new THREE.MeshPhysicalMaterial({color:0x7755cc,roughness:0.3,metalness:0.4,iridescence:0.9,iridescenceIOR:1.6});
    for(const dx of [-66,98]){
      const p=new THREE.Mesh(new THREE.CylinderGeometry(9,12,196,12),pillarMat);
      p.position.set(L.gateX+dx,-(L.gateY)+98,0);
      gGr.add(p);
    }
    const eye=new THREE.Group();
    eye.position.set(L.gateX+16,-(L.gateY-118),-4);
    const sclera=new THREE.Mesh(new THREE.SphereGeometry(1,24,18),stdM(0xf5efe2,0.35,{emissive:0xfff8ea,emissiveIntensity:0.25}));
    sclera.scale.set(46,32,14);
    const irisMat=new THREE.MeshBasicMaterial({color:0xff44aa,fog:false});
    const iris=new THREE.Mesh(new THREE.SphereGeometry(16,20,16),irisMat);
    iris.position.z=4;
    const pupil=new THREE.Mesh(new THREE.SphereGeometry(7.5,16,12),new THREE.MeshBasicMaterial({color:0x0d0612}));
    pupil.position.z=13;
    const ringMats=[];
    for(let i=0;i<4;i++){
      const rm=new THREE.MeshBasicMaterial({transparent:true,opacity:0.45-i*0.08,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
      ringMats.push(rm);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(58+i*15,1.6,8,64),rm);
      ring.userData={sp:(i%2?1:-1)*(0.15+i*0.08)};
      eye.add(ring);
    }
    const rayMat=new THREE.MeshBasicMaterial({color:0xffeeaa,transparent:true,opacity:0.35,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,side:THREE.DoubleSide});
    const rayGr=new THREE.Group();
    for(let i=0;i<12;i++){
      const ray=new THREE.Mesh(new THREE.PlaneGeometry(3,52),rayMat);
      const a=i/12*TAU;
      ray.position.set(Math.cos(a)*92,Math.sin(a)*92,0);
      ray.rotation.z=a+Math.PI/2;
      rayGr.add(ray);
    }
    eye.add(sclera,iris,pupil,rayGr);
    eye.userData={irisMat,pupil,rayGr,ringMats};
    world.gate=eye;
    gGr.add(eye);
    this.worldGroup.add(gGr);
    this.gateLight.position.set(L.gateX+16,-(L.gateY-118),60);
  },
  hideBrick(key){
    const i=this.world.brickIdx[key];
    if(i===undefined||!this.world.brickMesh) return;
    this._m.makeScale(0,0,0);
    this.world.brickMesh.setMatrixAt(i,this._m);
    this.world.brickMesh.instanceMatrix.needsUpdate=true;
  },

  // ---------------- character rig ----------------
  buildDog(){
    if(this.dog&&this.dog.root){ this.scene.remove(this.dog.root); this.disposeGroup(this.dog.root); }
    const cfg=G.char.rig;
    this.lastChar=G.char.id;
    const dog=this.dog={};
    const root=new THREE.Group();
    const yaw=new THREE.Group(); root.add(yaw);
    const rig=new THREE.Group(); yaw.add(rig);
    const body=stdM(cfg.body,0.7), head=stdM(cfg.head,0.75), ear=stdM(cfg.ear,0.8),
          chest=stdM(cfg.chest,0.7), belly=stdM(cfg.belly,0.8),
          nose=stdM(0x241d20,0.35), eyeM=stdM(0x2e1f14,0.25), muz=stdM(cfg.muz,0.7),
          snout=stdM(cfg.snout,0.7),
          harA=stdM(cfg.harA,0.5,{emissive:cfg.harA,emissiveIntensity:0.4}),
          harB=stdM(cfg.harB,0.5,{emissive:cfg.harB,emissiveIntensity:0.4}),
          gold=stdM(0xffd75e,0.3,{emissive:0xffc94a,emissiveIntensity:1.6}),
          tongueM=stdM(0xe2708a,0.5),
          tBase=stdM(cfg.tailBase,0.75), tBand=stdM(cfg.tailBand,0.8), tTip=stdM(cfg.tailTip,0.6);
    dog.mats=[body,head,ear,chest,belly,snout];
    dog.baseEm=dog.mats.map(m=>({e:m.emissive.getHex(),i:m.emissiveIntensity}));
    const legLen=cfg.legLen, legR=cfg.legR;
    const pivotY=legLen+4.1, bodyY=pivotY+5.5;
    // body
    const bodyMesh=new THREE.Mesh(new THREE.CapsuleGeometry(cfg.bodyR,cfg.bodyLen,6,14),body);
    bodyMesh.rotation.z=Math.PI/2; bodyMesh.position.set(-1,bodyY,0);
    rig.add(bodyMesh);
    // belly
    const bellyMesh=new THREE.Mesh(new THREE.SphereGeometry(cfg.bodyR*0.9,12,10),belly);
    bellyMesh.scale.set(1.35,0.8,0.95); bellyMesh.position.set(-1,bodyY-4.5,0);
    rig.add(bellyMesh);
    // saddle (Rue)
    if(cfg.saddle!=null){
      const saddle=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),stdM(cfg.saddle,0.75));
      saddle.scale.set(11.5,7,8.8); saddle.position.set(-8.5,bodyY+3.5,0);
      rig.add(saddle);
    }
    // ticking spots (Rue)
    if(cfg.spots!=null){
      const spotM=stdM(cfg.spots,0.8);
      for(const [sx,sy,sz] of [[-3,-5.5,4.5],[2,-6,-4],[-6,-5,-4.5],[4,-3.5,5]]){
        const sp=new THREE.Mesh(new THREE.SphereGeometry(1.4,6,5),spotM);
        sp.position.set(sx,bodyY+sy,sz); rig.add(sp);
      }
    }
    // chest
    const chestMesh=new THREE.Mesh(new THREE.SphereGeometry(cfg.bodyR*0.75,12,10),chest);
    chestMesh.position.set(cfg.bodyLen/2-1,bodyY-2.5,0); rig.add(chestMesh);
    // white chest blaze (Nero)
    if(cfg.saddle==null){
      const blaze=new THREE.Mesh(new THREE.SphereGeometry(cfg.bodyR*0.62,10,8),chest);
      blaze.scale.set(0.8,1.5,0.8);
      blaze.position.set(cfg.bodyLen/2+1.5,bodyY,0); rig.add(blaze);
    }
    // harness
    const hTor=new THREE.Mesh(new THREE.TorusGeometry(cfg.bodyR+1.3,1.8,10,28),harA);
    hTor.rotation.y=Math.PI/2; hTor.position.set(3,bodyY-0.5,0);
    const hTor2=new THREE.Mesh(new THREE.TorusGeometry(cfg.bodyR+1.5,0.8,8,28),harB);
    hTor2.rotation.y=Math.PI/2; hTor2.position.set(4.6,bodyY-0.5,0);
    rig.add(hTor,hTor2);
    // neck (iggy)
    if(cfg.neck){
      const neck=new THREE.Mesh(new THREE.CapsuleGeometry(3.4,9,4,10),head);
      neck.position.set(cfg.headX-3,(bodyY+cfg.headY)/2,0);
      neck.rotation.z=-0.35;
      rig.add(neck);
      const nBlaze=new THREE.Mesh(new THREE.CapsuleGeometry(2.2,8,4,8),chest);
      nBlaze.position.set(cfg.headX-1.4,(bodyY+cfg.headY)/2-0.5,0);
      nBlaze.rotation.z=-0.35;
      rig.add(nBlaze);
    }
    // head
    const headG=new THREE.Group(); headG.position.set(cfg.headX,cfg.headY,0); rig.add(headG);
    headG.add(new THREE.Mesh(new THREE.SphereGeometry(cfg.headR,18,14),head));
    const snoutMesh=new THREE.Mesh(new THREE.CapsuleGeometry(cfg.headR*0.4,4.6,6,10),snout);
    snoutMesh.rotation.z=Math.PI/2; snoutMesh.position.set(cfg.headR-0.4,-1.6,0); headG.add(snoutMesh);
    const muzMesh=new THREE.Mesh(new THREE.SphereGeometry(2.6,8,6),muz);
    muzMesh.scale.set(1.2,0.8,0.9); muzMesh.position.set(cfg.headR+1.4,-1.2,0); headG.add(muzMesh);
    const noseMesh=new THREE.Mesh(new THREE.SphereGeometry(2.1,10,8),nose);
    noseMesh.position.set(cfg.headR+3.4,-0.7,0); headG.add(noseMesh);
    // face blaze (Nero)
    if(cfg.saddle==null){
      const fb=new THREE.Mesh(new THREE.CapsuleGeometry(1.6,6,4,8),chest);
      fb.position.set(cfg.headR-2,1.5,0); fb.rotation.z=0.9;
      headG.add(fb);
    }
    // eyes + glints
    for(const s of [-1,1]){
      const e=new THREE.Mesh(new THREE.SphereGeometry(2.0,10,8),eyeM);
      e.position.set(cfg.headR*0.6,2.1,s*cfg.headR*0.63); headG.add(e);
      const gl=new THREE.Mesh(new THREE.SphereGeometry(0.6,6,5),stdM(0xffffff,0.2,{emissive:0xffffff,emissiveIntensity:0.8}));
      gl.position.set(cfg.headR*0.76,2.8,s*cfg.headR*0.63); headG.add(gl);
    }
    // ears
    dog.ears=[];
    for(const s of [-1,1]){
      const piv=new THREE.Group();
      piv.position.set(-0.5,cfg.headR-1.4,s*(cfg.headR*0.7)); headG.add(piv);
      if(cfg.earStyle==='rose'){
        const e=new THREE.Mesh(new THREE.BoxGeometry(3.2,4.6,1.2),ear);
        e.position.set(-1.2,1.8,0); e.rotation.y=s*0.5; piv.add(e);
        piv.rotation.x=s*1.1; piv.rotation.z=0.5;
      } else {
        const e=new THREE.Mesh(new THREE.BoxGeometry(4.6,7,1.5),ear);
        e.position.set(0,3.2,0); piv.add(e);
        piv.rotation.x=s*1.45; piv.rotation.z=-0.2;
      }
      piv.userData={s,rose:cfg.earStyle==='rose'};
      dog.ears.push(piv);
    }
    // tongue
    dog.tongue=new THREE.Mesh(new THREE.BoxGeometry(1.6,3.4,1.6),tongueM);
    dog.tongue.position.set(cfg.headR+0.8,-4.6,1.2); dog.tongue.visible=false; headG.add(dog.tongue);
    // third eye
    dog.thirdEye=new THREE.Mesh(new THREE.SphereGeometry(1.5,8,6),gold);
    dog.thirdEye.position.set(cfg.headR*0.55,cfg.headR-0.9,0); dog.thirdEye.visible=false; headG.add(dog.thirdEye);
    // legs
    dog.legs=[];
    const legGeo=new THREE.CapsuleGeometry(legR,legLen,4,8);
    const legDefs=[[cfg.bodyLen/2-1,-4.2],[cfg.bodyLen/2-1,4.2],[-(cfg.bodyLen/2)+0.5,-4.2],[-(cfg.bodyLen/2)+0.5,4.2]];
    legDefs.forEach(([lx,lz],i)=>{
      const piv=new THREE.Group(); piv.position.set(lx,pivotY,lz); rig.add(piv);
      const leg=new THREE.Mesh(legGeo,i<2?chest:body);
      leg.position.set(0,-(legLen/2+legR),0); piv.add(leg);
      piv.userData={front:lx>0,phase:(i===0||i===3)?0:Math.PI};
      dog.legs.push(piv);
    });
    // tail
    const tailPiv=new THREE.Group(); tailPiv.position.set(-(cfg.bodyLen/2)-3.5,bodyY+4,0); rig.add(tailPiv);
    const t1=new THREE.Mesh(new THREE.CylinderGeometry(1.7,2.1,7,8),tBase);
    t1.position.set(0,3.2,0); tailPiv.add(t1);
    const t2=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.7,3,8),tBand);
    t2.position.set(0,8,0); tailPiv.add(t2);
    const t3=new THREE.Mesh(new THREE.SphereGeometry(2.5,8,6),tTip);
    t3.position.set(0,10.6,0); tailPiv.add(t3);
    tailPiv.rotation.z=0.7;
    dog.tail=tailPiv;
    dog.root=root; dog.yaw=yaw; dog.rig=rig; dog.headG=headG;
    this.scene.add(root);
  },

  // ---------------- enemy / item rigs ----------------
  buildShroomRig(e){
    const g=new THREE.Group();
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(7.5,8.5,13,12),stdM(0xf3e9dc,0.7));
    stem.position.y=6.5; g.add(stem);
    const capMat=stdM(0xffffff,0.45,{emissiveIntensity:0.7});
    capMat.color.setHSL(e.hueOff/360,0.85,0.55);
    capMat.emissive.setHSL(e.hueOff/360,0.85,0.3);
    const cap=new THREE.Mesh(new THREE.SphereGeometry(14,16,12,0,TAU,0,Math.PI/2),capMat);
    cap.scale.set(1,0.75,1); cap.position.y=12; g.add(cap);
    for(let i=0;i<3;i++){
      const d=new THREE.Mesh(new THREE.SphereGeometry(2.4,6,5),stdM(0xffffff,0.4,{emissive:0xffffff,emissiveIntensity:0.4}));
      const a=i/3*TAU+0.5;
      d.position.set(Math.cos(a)*8,17+Math.sin(i*2.1)*2,Math.sin(a)*8);
      g.add(d);
    }
    for(const s of [-1,1]){
      const eye=new THREE.Mesh(new THREE.SphereGeometry(1.7,8,6),stdM(0x241d20,0.3));
      eye.position.set(3.5*s,8,7.2); g.add(eye);
    }
    g.userData={cap};
    return g;
  },
  buildJellyRig(e){
    const g=new THREE.Group();
    const hue=e.hueOff/360;
    g.add(new THREE.Mesh(new THREE.SphereGeometry(12,18,14),stdM(0xf8f4ec,0.35,{emissive:0xfff4e0,emissiveIntensity:0.25})));
    const irisM=stdM(0xffffff,0.3,{emissiveIntensity:0.9});
    irisM.color.setHSL(hue,0.9,0.5); irisM.emissive.setHSL(hue,0.9,0.4);
    const iris=new THREE.Mesh(new THREE.SphereGeometry(6.2,14,10),irisM);
    iris.position.z=7.5; g.add(iris);
    const pupil=new THREE.Mesh(new THREE.SphereGeometry(3,10,8),stdM(0x1a1218,0.2));
    pupil.position.z=11; g.add(pupil);
    const spikeM=stdM(0x332244,0.5,{emissive:0x221133,emissiveIntensity:0.5});
    for(let i=0;i<5;i++){
      const sp=new THREE.Mesh(new THREE.ConeGeometry(2.2,9,6),spikeM);
      const a=(i/4-0.5)*1.6;
      sp.position.set(Math.sin(a)*11,Math.cos(a)*11,0);
      sp.rotation.z=-a;
      g.add(sp);
    }
    const tentM=stdM(0xffffff,0.5,{emissiveIntensity:0.5});
    tentM.color.setHSL(hue,0.8,0.6); tentM.emissive.setHSL(hue,0.8,0.35);
    g.userData.tents=[];
    for(let i=0;i<4;i++){
      const t=new THREE.Mesh(new THREE.CylinderGeometry(0.9,0.5,13,5),tentM);
      t.position.set(-6+i*4,-15,0);
      g.add(t); g.userData.tents.push(t);
    }
    return g;
  },
  buildItemRig(it){
    const g=new THREE.Group();
    if(it.type==='shroom'){
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(6,7,11,10),stdM(0xf6ecd9,0.6));
      stem.position.y=5.5; g.add(stem);
      const cap=new THREE.Mesh(new THREE.SphereGeometry(11.5,14,10,0,TAU,0,Math.PI/2),stdM(0xff5a3c,0.4,{emissive:0xdd2200,emissiveIntensity:0.8}));
      cap.scale.set(1,0.8,1); cap.position.y=10; g.add(cap);
      for(let i=0;i<4;i++){
        const d=new THREE.Mesh(new THREE.SphereGeometry(2,6,5),stdM(0xfff6e8,0.4,{emissive:0xffffff,emissiveIntensity:0.5}));
        const a=i/4*TAU+0.4;
        d.position.set(Math.cos(a)*6.5,13.5,Math.sin(a)*6.5); g.add(d);
      }
      g.userData.spin=0.03;
    } else {
      const starM=stdM(0xffee66,0.25,{emissive:0xffcc00,emissiveIntensity:2.2});
      const star=new THREE.Mesh(new THREE.IcosahedronGeometry(11,0),starM);
      star.position.y=11; g.add(star);
      g.userData={spin:0.12,starM,star};
    }
    return g;
  },

  // ---------------- particles ----------------
  initParticles(){
    const MAXP=600;
    this.MAXP=MAXP;
    const pGeo=this.pGeo=new THREE.BufferGeometry();
    this.pPos=new Float32Array(MAXP*3); this.pCol=new Float32Array(MAXP*3);
    this.pSize=new Float32Array(MAXP); this.pAlp=new Float32Array(MAXP);
    pGeo.setAttribute('position',new THREE.BufferAttribute(this.pPos,3));
    pGeo.setAttribute('aCol',new THREE.BufferAttribute(this.pCol,3));
    pGeo.setAttribute('aSize',new THREE.BufferAttribute(this.pSize,1));
    pGeo.setAttribute('aAlp',new THREE.BufferAttribute(this.pAlp,1));
    const pMat=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false,
      vertexShader:`
        attribute vec3 aCol; attribute float aSize; attribute float aAlp;
        varying vec3 vC; varying float vA;
        void main(){
          vC=aCol; vA=aAlp;
          vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=aSize*(420.0/max(1.0,-mv.z));
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader:`
        varying vec3 vC; varying float vA;
        void main(){
          float d=length(gl_PointCoord-0.5);
          float a=smoothstep(0.5,0.12,d)*vA;
          gl_FragColor=vec4(vC*1.7,a);
        }`
    });
    const pts=new THREE.Points(pGeo,pMat);
    pts.frustumCulled=false;
    this.scene.add(pts);
  },
  syncParticles(){
    const n=Math.min(G.parts.length,this.MAXP);
    for(let i=0;i<n;i++){
      const p=G.parts[i];
      this.pPos[i*3]=p.x; this.pPos[i*3+1]=-p.y; this.pPos[i*3+2]=14;
      this._c.setHSL((p.h%360)/360,p.s,p.ll);
      this.pCol[i*3]=this._c.r; this.pCol[i*3+1]=this._c.g; this.pCol[i*3+2]=this._c.b;
      this.pSize[i]=p.sz;
      this.pAlp[i]=Math.max(0,p.l/p.l0);
    }
    this.pGeo.setDrawRange(0,n);
    this.pGeo.attributes.position.needsUpdate=true;
    this.pGeo.attributes.aCol.needsUpdate=true;
    this.pGeo.attributes.aSize.needsUpdate=true;
    this.pGeo.attributes.aAlp.needsUpdate=true;
  },

  // ---------------- post pipeline ----------------
  initPost(){
    this.postCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.postScene=new THREE.Scene();
    this.postQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),null);
    this.postScene.add(this.postQuad);
    this.brightMat=new THREE.ShaderMaterial({
      uniforms:{tex:{value:null}},
      vertexShader:QUAD_VSH,
      fragmentShader:`
        uniform sampler2D tex; varying vec2 vUv;
        void main(){
          vec3 c=texture2D(tex,vUv).rgb;
          float l=dot(c,vec3(0.299,0.587,0.114));
          gl_FragColor=vec4(c*smoothstep(0.9,1.5,l),1.0);
        }`
    });
    this.blurMat=new THREE.ShaderMaterial({
      uniforms:{tex:{value:null},dir:{value:new THREE.Vector2(1,0)},texel:{value:new THREE.Vector2(1/640,1/360)}},
      vertexShader:QUAD_VSH,
      fragmentShader:`
        uniform sampler2D tex; uniform vec2 dir; uniform vec2 texel; varying vec2 vUv;
        void main(){
          vec2 o=dir*texel;
          vec3 c=texture2D(tex,vUv).rgb*0.227;
          c+=(texture2D(tex,vUv+o*1.384).rgb+texture2D(tex,vUv-o*1.384).rgb)*0.316;
          c+=(texture2D(tex,vUv+o*3.230).rgb+texture2D(tex,vUv-o*3.230).rgb)*0.070;
          gl_FragColor=vec4(c,1.0);
        }`
    });
    this.compMat=new THREE.ShaderMaterial({
      uniforms:{tScene:{value:null},tBloom:{value:null},tPrev:{value:null},uT:{value:0},uTrip:{value:0.4},uFeed:{value:0.5}},
      vertexShader:QUAD_VSH,
      fragmentShader:`
        precision highp float;
        uniform sampler2D tScene,tBloom,tPrev;
        uniform float uT,uTrip,uFeed;
        varying vec2 vUv;
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
        vec3 hueShift(vec3 c,float a){
          const vec3 k=vec3(0.57735);
          float ca=cos(a), sa=sin(a);
          return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.0-ca);
        }
        void main(){
          vec2 cuv=vUv-0.5;
          vec2 uv=0.5+cuv*(1.0-0.008*uTrip*sin(uT*0.8));
          uv+=vec2(sin(uv.y*18.0+uT*1.7),cos(uv.x*15.0-uT*1.3))*0.0024*uTrip;
          float r=length(cuv);
          vec2 dir=cuv/max(r,1e-4);
          float ca2=(0.0012+0.0060*uTrip)*r;
          vec3 col;
          col.r=texture2D(tScene,uv+dir*ca2).r;
          col.g=texture2D(tScene,uv).g;
          col.b=texture2D(tScene,uv-dir*ca2).b;
          col+=texture2D(tBloom,uv).rgb*(0.8+0.6*uTrip);
          col=hueShift(col,0.22*uTrip*sin(uT*0.5));
          col=aces(col*1.05);
          col=pow(col,vec3(1.0/2.2));
          vec3 prev=texture2D(tPrev,0.5+cuv*0.986).rgb;
          col=max(col,prev*uFeed);
          col*=1.0-0.32*r*r;
          float g=fract(sin(dot(gl_FragCoord.xy+mod(uT,10.0)*61.0,vec2(12.9898,78.233)))*43758.5453);
          col+=(g-0.5)*0.028;
          gl_FragColor=vec4(col,1.0);
        }`
    });
    this.copyMat=new THREE.ShaderMaterial({
      uniforms:{tex:{value:null}},
      vertexShader:QUAD_VSH,
      fragmentShader:`uniform sampler2D tex; varying vec2 vUv; void main(){ gl_FragColor=texture2D(tex,vUv); }`
    });
  },
  runPass(mat,target){
    this.postQuad.material=mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.postScene,this.postCam);
  },
  allocRTs(w,h){
    for(const rt of [this.rtScene,this.rtBloomA,this.rtBloomB,this.rtOut,this.rtPrev]) if(rt) rt.dispose();
    const samples=(this.resScale<1||isMobile)?0:4;
    this.rtScene=new THREE.WebGLRenderTarget(w,h,{type:THREE.HalfFloatType,samples,depthBuffer:true});
    const bw=Math.max(2,w>>1), bh=Math.max(2,h>>1);
    this.rtBloomA=new THREE.WebGLRenderTarget(bw,bh,{type:THREE.HalfFloatType});
    this.rtBloomB=new THREE.WebGLRenderTarget(bw,bh,{type:THREE.HalfFloatType});
    this.rtOut=new THREE.WebGLRenderTarget(w,h,{});
    this.rtPrev=new THREE.WebGLRenderTarget(w,h,{});
    this.blurMat.uniforms.texel.value.set(1/bw,1/bh);
  },

  // ---------------- per-frame sync ----------------
  worldToScreenN(x,y){
    this._v.set(x,-y,0).project(this.camera);
    return [this._v.x*0.5+0.5,-this._v.y*0.5+0.5];
  },
  uiScale(){ return 1; },
  sync(){
    const t=G.gt, world=this.world, P=G.P, L=G.level;
    if(!L) return;
    // camera
    const cx=G.camX+W/2;
    const camY=-270-((P.y-300)*0.06);
    let px=cx, py=camY, pz=545+14*Math.sin(t*0.4)+G.trip*22;
    let ax=cx, ay=camY+6;
    if(G.state==='win'&&G.winT>1.0){
      px=P.x+P.w/2+40+Math.sin(t*0.3)*14;
      py=-(P.y+P.h)+60;
      pz=250;
      ax=L.gateX-30; ay=-(P.y+P.h)+70;
    }
    this.camPos.x=lerp(this.camPos.x,px,0.07); this.camPos.y=lerp(this.camPos.y,py,0.07); this.camPos.z=lerp(this.camPos.z,pz,0.07);
    this.camAim.x=lerp(this.camAim.x,ax,0.09); this.camAim.y=lerp(this.camAim.y,ay,0.09);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camAim.x,this.camAim.y,0);
    this.camera.rotation.z+=Math.sin(t*0.35)*0.008*G.trip;
    const fov=55+G.trip*3.5*Math.sin(t*0.9);
    if(Math.abs(this.camera.fov-fov)>0.01){ this.camera.fov=fov; this.camera.updateProjectionMatrix(); }
    this.sky.position.copy(this.camera.position);
    this.dirL.position.set(cx+220,180,420);
    this.dirL.target.position.set(cx,-300,0);
    // shells / rings / eyes
    this.shellA.position.set(cx*0.55+400,-270,-260);
    this.shellB.position.set(cx*0.7+300,-270,-200);
    this.shellA.rotation.y=t*0.03; this.shellA.rotation.x=Math.sin(t*0.1)*0.2;
    this.shellB.rotation.y=-t*0.05; this.shellB.rotation.z=t*0.02;
    this.shellMatA.color.setHSL((t*0.02+this.themeHue)%1,0.9,0.6);
    this.shellMatB.color.setHSL((t*0.02+0.5+this.themeHue)%1,0.9,0.6);
    for(const r of this.rings){
      r.rotation.z+=r.userData.spin/60;
      r.rotation.x=Math.sin(t*0.2+r.userData.hue)*0.6;
      r.material.color.setHSL(((r.userData.hue+t*30)%360)/360,0.95,0.6);
    }
    for(const s of this.eyeSprites){
      const blink=Math.max(0.08,Math.abs(Math.sin(t*0.5+s.userData.ph)));
      s.scale.y=s.userData.base*0.7*blink;
      s.material.opacity=0.35+0.3*Math.sin(t*0.8+s.userData.ph)*G.trip;
    }
    // uniforms
    this.skyMat.uniforms.uT.value=t; this.skyMat.uniforms.uTrip.value=G.trip;
    this.compMat.uniforms.uT.value=t; this.compMat.uniforms.uTrip.value=G.trip;
    this.compMat.uniforms.uFeed.value=0.34+0.28*G.trip;
    if(world.pipeGlowMat) world.pipeGlowMat.color.setHSL(((t*45+180)%360)/360,0.95,0.65);
    if(world.lipMat){
      const lh=((t*22+this.themeHue*360)%360)/360;
      world.lipMat.color.setHSL(lh,0.85,0.55);
      world.lipMat.emissive.setHSL(lh,0.9,0.4);
      world.lipMat.emissiveIntensity=1.1+0.5*Math.sin(t*2)+G.trip;
    }
    for(const pm of world.padMats) pm.emissiveIntensity=1.0+0.6*Math.sin(t*3)+G.trip*0.6;
    if(world.qMat) world.qMat.emissiveIntensity=0.7+0.4*Math.sin(t*4);
    if(world.bloomMat) world.bloomMat.emissiveIntensity=1.1+0.6*Math.sin(t*5);
    if(world.bloomMeshes) for(const g of world.bloomMeshes){
      g.userData.pad.scale.y=1+0.25*Math.sin(t*6+g.userData.ph);
      g.rotation.y=t*0.8+g.userData.ph;
    }
    if(world.ballMeshes) for(const g of world.ballMeshes){
      const bl=g.userData.bl;
      g.visible=!bl.taken;
      if(!bl.taken){
        g.position.set(bl.x,-(bl.y+Math.sin(t*2.2+bl.t)*4),8);
        g.rotation.z=t*2+bl.t;
        g.rotation.y=t*1.3;
      }
    }
    // block bounce (timer decremented in logic)
    for(const key in G.bounceAnim){
      const mesh=world.qMeshes[key];
      if(mesh){
        const b=G.bounceAnim[key]||0;
        mesh.position.y=mesh.userData.baseY+(b>0?Math.sin((10-b)/10*Math.PI)*8:0);
      }
    }
    // bones
    if(this.bonesMesh){
      for(let i=0;i<G.bonesArr.length;i++){
        const b=G.bonesArr[i];
        if(b.taken){ this._m.makeScale(0,0,0); this.bonesMesh.setMatrixAt(i,this._m); continue; }
        this._e.set(Math.sin(t*1.6+b.t)*0.4,t*1.5+b.t,0);
        this._q.setFromEuler(this._e);
        this._v.set(b.x,-(b.y+Math.sin(t*2.4+b.t)*3),6);
        this._s.setScalar(1);
        this._m.compose(this._v,this._q,this._s);
        this.bonesMesh.setMatrixAt(i,this._m);
      }
      this.bonesMesh.instanceMatrix.needsUpdate=true;
    }
    // checkpoint
    if(world.cpCrystal){
      world.cpCrystal.rotation.y=t*(G.checkpointHit?2.4:0.5);
      if(G.checkpointHit){
        world.cpCrystal.material.emissive.setHSL(((t*80)%360)/360,0.9,0.5);
        world.cpCrystal.material.emissiveIntensity=1.6;
      }
    }
    // gate
    if(world.gate){
      const e=world.gate, open=G.state==='win'?Math.min(1,G.winT*1.5):0.55+0.1*Math.sin(t*1.2);
      e.scale.setScalar(1+0.05*Math.sin(t*2));
      e.userData.irisMat.color.setHSL(((t*40)%360)/360,0.9,0.55);
      e.userData.pupil.scale.setScalar(G.state==='win'?1.6*open+0.4:open);
      e.userData.rayGr.rotation.z=t*0.3;
      e.userData.ringMats.forEach((rm,i)=>rm.color.setHSL(((t*50+i*60)%360)/360,0.95,0.6));
      for(const ch of e.children) if(ch.userData&&ch.userData.sp) ch.rotation.z+=ch.userData.sp/60;
      this.gateLight.color.setHSL(((t*40)%360)/360,0.9,0.6);
      this.gateLight.intensity=3+2*open+(G.state==='win'?4:0);
    }
    // enemies
    for(const e of G.enemies){
      if(!e._rig&&(e.alive||e.dying)){
        e._rig=e.type==='shroom'?this.buildShroomRig(e):this.buildJellyRig(e);
        this.actorGroup.add(e._rig);
      }
      if(!e._rig) continue;
      e._rig.position.set(e.x+e.w/2,-(e.y+e.h),8);
      if(e.type==='jelly') e._rig.position.y=-(e.y+e.h/2)-13;
      if(e.dying){
        e._rig.scale.set(1.3,Math.max(0.05,e.squash),1.3);
      } else if(e.type==='shroom'){
        e._rig.userData.cap.rotation.z=Math.sin(t*8+e.hueOff)*0.12;
        e._rig.position.y+=-Math.abs(Math.sin(t*9+e.hueOff))*1.5;
        e._rig.rotation.y=e.vx>0?0.35:-0.35;
      } else {
        e._rig.rotation.z=Math.sin(t*2+e.ph)*0.15;
        e._rig.userData.tents.forEach((tn,i)=>{ tn.rotation.x=Math.sin(t*5+i)*0.4; });
        e._rig.rotation.y=clamp((P.x-e.x)*0.004,-0.5,0.5);
      }
    }
    // items
    for(const it of G.items){
      if(!it._rig){ it._rig=this.buildItemRig(it); this.actorGroup.add(it._rig); }
      it._rig.position.set(it.x+it.w/2,-(it.y+it.h),6);
      it._rig.rotation.y+=it._rig.userData.spin||0.03;
      if(it.type==='star'&&it._rig.userData.starM){
        it._rig.userData.starM.emissive.setHSL((it.hue%360)/360,1,0.55);
        it._rig.userData.star.rotation.x+=0.07;
      }
    }
    this.syncDog(t);
    this.syncParticles();
    this.dogLight.position.set(P.x+P.w/2,-(P.y+P.h/2),70);
    this.dogLight.color.setHSL(((t*40)%360)/360,0.8,0.6);
    this.dogLight.intensity=2.6+G.trip*2.5+(P.star>0?4:0);
  },
  syncDog(t){
    const dog=this.dog, P=G.P;
    if(!dog) return;
    if(this.lastChar!==G.char.id) this.buildDog();
    const feetX=P.x+P.w/2, feetY=-(P.y+P.h);
    dog.root.position.set(feetX,feetY,10);
    const blink=P.inv>0&&Math.floor(G.gt*18)%2===0&&G.state==='play';
    dog.root.visible=!blink;
    const targetYaw=P.dir>0?0:Math.PI;
    dog.yaw.rotation.y+=(targetYaw-dog.yaw.rotation.y)*0.35;
    if(P.spinning) dog.rig.rotation.y=P.spinA;
    else dog.rig.rotation.y*=0.6;
    const targetS=P.big?1.22:1;
    dog.root.scale.setScalar(lerp(dog.root.scale.x,targetS,0.15));
    dog.thirdEye.visible=P.big;
    const spd=Math.abs(P.vx);
    const air=!P.grounded;
    const sitting=(P.idleT>4||G.state==='win');
    let pitch=0, bob=0;
    if(air) pitch=clamp(-P.vy*0.035,-0.3,0.4);
    else if(spd>0.2) bob=Math.abs(Math.sin(P.runPhase*Math.PI*2))*1.4;
    if(sitting) pitch=0.95;
    dog.rig.rotation.z+=(pitch-dog.rig.rotation.z)*0.2;
    dog.rig.position.y=bob+(sitting?2:0);
    dog.rig.position.x=sitting?-6:0;
    const br=1+0.015*Math.sin(t*2.2);
    dog.rig.scale.set(1,br,1);
    dog.headG.rotation.z=sitting?-0.75:(P.idleT>1.5?Math.sin(t*0.7)*0.14:0);
    dog.tongue.visible=spd>3.4&&P.grounded;
    for(const piv of dog.ears){
      const s=piv.userData.s;
      let tx=piv.userData.rose?s*1.1:s*1.45, tz=piv.userData.rose?0.5:-0.2;
      if(air&&P.vy<-0.5){ tx=s*0.4; tz=0.15; }
      else if(air){ tx=s*0.7; tz=0.35; }
      piv.rotation.x+=(tx-piv.rotation.x)*0.25;
      piv.rotation.z+=(tz-piv.rotation.z)*0.25;
      piv.rotation.x+=Math.sin(t*7+s)*0.02*(spd>0.5?1:0.3);
    }
    for(const piv of dog.legs){
      const u=piv.userData;
      let target;
      if(sitting) target=u.front?0.55:-0.5;
      else if(air&&P.vy<-0.5) target=u.front?-0.85:0.7;
      else if(air) target=u.front?0.45:-0.45;
      else if(spd>0.2) target=Math.sin(P.runPhase*Math.PI*2+u.phase)*0.75;
      else target=0;
      piv.rotation.z+=(target-piv.rotation.z)*0.3;
    }
    const wagSpd=spd>0.3?14:(sitting?9:6);
    dog.tail.rotation.x=Math.sin(t*wagSpd)*(sitting?0.3:0.55);
    const tailZ=sitting?-1.5:0.7;
    dog.tail.rotation.z+=(tailZ+Math.sin(t*wagSpd*0.5)*0.1-dog.tail.rotation.z)*0.2;
    if(P.star>0){
      dog.mats.forEach((m,i)=>{
        m.emissive.setHSL(((t*400+i*40)%360)/360,0.9,0.4);
        m.emissiveIntensity=0.9;
      });
    } else {
      dog.mats.forEach((m,i)=>{
        m.emissive.setHex(dog.baseEm[i].e);
        m.emissiveIntensity=dog.baseEm[i].i;
      });
    }
  },

  // ---------------- render ----------------
  render(){
    if(!this.built||!this.active||!G.level) return;
    this.sync();
    const r=this.renderer;
    r.setRenderTarget(this.rtScene);
    r.render(this.scene,this.camera);
    this.brightMat.uniforms.tex.value=this.rtScene.texture;
    this.runPass(this.brightMat,this.rtBloomA);
    for(let i=0;i<2;i++){
      this.blurMat.uniforms.tex.value=this.rtBloomA.texture; this.blurMat.uniforms.dir.value.set(1,0);
      this.runPass(this.blurMat,this.rtBloomB);
      this.blurMat.uniforms.tex.value=this.rtBloomB.texture; this.blurMat.uniforms.dir.value.set(0,1);
      this.runPass(this.blurMat,this.rtBloomA);
    }
    this.compMat.uniforms.tScene.value=this.rtScene.texture;
    this.compMat.uniforms.tBloom.value=this.rtBloomA.texture;
    this.compMat.uniforms.tPrev.value=this.rtPrev.texture;
    this.runPass(this.compMat,this.rtOut);
    this.copyMat.uniforms.tex.value=this.rtOut.texture;
    this.runPass(this.copyMat,null);
    const sw=this.rtPrev; this.rtPrev=this.rtOut; this.rtOut=sw;
  },
};
