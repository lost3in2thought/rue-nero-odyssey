/* ============================================================
   PAWS ENGINE — FREE ROAM (Dreamland 64)
   An open-world SM64-style playground: heightfield dream island,
   camera-relative analog movement, orbit camera, 7 Zoomie Stars,
   wandering shroomies, floating jellies, bounce blooms, lotus
   stairways, a dream lake, and the Great Eye on the summit.
   Borrows dog/enemy rigs + sky shader from the odyssey renderer.
   ============================================================ */
import * as THREE from 'three';
import {TAU,clamp,lerp,isMobile,Save,Sound,Input,CHARS} from './shared.js';
import {Render3D,stdM,SKY_FSH} from './render3d.js';

const QUAD=`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;
const GRAV=0.34, ISLAND=1900;

function angLerp(a,b,t){
  let d=(b-a)%TAU;
  if(d>Math.PI) d-=TAU;
  if(d<-Math.PI) d+=TAU;
  return a+d*t;
}

// ---------------- terrain (analytic — same fn drives mesh & physics) ----------------
function terrainH(x,z){
  let h=40*Math.sin(x*0.002)*Math.cos(z*0.0023)
       +22*Math.sin(x*0.0051+1.7)*Math.sin(z*0.0047+0.6)
       +10*Math.sin((x+z)*0.011);
  // the spiral mountain (north)
  const mdx=x-300, mdz=z+700, md=Math.hypot(mdx,mdz);
  h+=540*Math.exp(-(md*md)/(2*470*470));
  // the dream lake (south-west)
  const ldx=x+900, ldz=z-900, ld=Math.hypot(ldx,ldz);
  h-=150*Math.exp(-(ld*ld)/(2*360*360));
  // spawn plaza flattening (south)
  const pdx=x, pdz=z-1200, pd=Math.hypot(pdx,pdz);
  const pw=Math.exp(-(pd*pd)/(2*260*260));
  h=h*(1-pw)+24*pw;
  // island rim → deep dream tide
  const rd=Math.hypot(x,z);
  if(rd>ISLAND-320) h-=(rd-(ISLAND-320))*1.4;
  return h;
}

export const World3D={
  built:false, active:false, paused:false, state:'play',
  view:null, renderer:null, scene:null, camera:null,
  p:null, dog:null, charId:'rue',
  camYaw:Math.PI, camDist:250, camH:130,
  bones:[], balls:[], stars:[], crystals:[], enemies:[], blooms:[], pads:[],
  toasts:[], gt:0, playT:0, winT:0, trip:0.4, tripPulse:0,
  respawn:new THREE.Vector3(0,60,1300),
  _v:new THREE.Vector3(), _v2:new THREE.Vector3(),

  toast(t){ this.toasts.push({txt:t,t:3.4}); if(this.toasts.length>3) this.toasts.shift(); },
  addTrip(v){ this.tripPulse=Math.min(1,this.tripPulse+v); },

  groundH(x,z){
    let h=terrainH(x,z);
    for(const pl of this.pads){
      const d=Math.hypot(x-pl.x,z-pl.z);
      if(d<pl.r&&pl.y>h&&this.p&&this.p.pos.y>=pl.y-16) h=Math.max(h,pl.y);
    }
    return h;
  },

  // ---------------- construction ----------------
  ensure(){
    if(this.built) return;
    this.built=true;
    this.view=document.getElementById('viewRoam');
    const renderer=this.renderer=new THREE.WebGLRenderer({canvas:this.view,antialias:false,alpha:false,powerPreference:'high-performance'});
    renderer.toneMapping=THREE.NoToneMapping;
    renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
    const scene=this.scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x0b0518,0.00030);
    this.camera=new THREE.PerspectiveCamera(60,16/9,10,7000);
    scene.add(new THREE.AmbientLight(0x9080b8,0.9));
    this.dirL=new THREE.DirectionalLight(0xfff2e0,1.5);
    this.dirL.position.set(600,900,400);
    scene.add(this.dirL);
    this.dogLight=new THREE.PointLight(0xff88ff,3.0,700,0.9);
    scene.add(this.dogLight);
    // sky
    this.skyMat=new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false,fog:false,
      uniforms:{uT:{value:0},uTrip:{value:0.4},uHue:{value:0},uDark:{value:0}},
      vertexShader:`varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:SKY_FSH,
    });
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(5200,48,32),this.skyMat);
    scene.add(this.sky);
    this.buildTerrain();
    this.buildFeatures();
    this.initParticles();
    this.initPost();
    this.resize();
  },
  buildTerrain(){
    const N=128, S=(ISLAND*2+600)/N;
    const geo=new THREE.PlaneGeometry(N*S,N*S,N,N);
    geo.rotateX(-Math.PI/2);
    const pos=geo.attributes.position;
    const cols=new Float32Array(pos.count*3);
    const c=new THREE.Color();
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i), z=pos.getZ(i);
      const h=terrainH(x,z);
      pos.setY(i,h);
      // zone coloring: meadow → rock → glowing summit; sandy shores
      let hue,sat,lig;
      if(h>330){ hue=0.78; sat=0.55; lig=0.34+((h-330)/300)*0.35; }
      else if(h>140){ hue=0.74; sat=0.42; lig=0.26; }
      else if(h<-8){ hue=0.09; sat=0.45; lig=0.30; }
      else { hue=0.36+0.06*Math.sin(x*0.004+z*0.003); sat=0.45; lig=0.24+0.05*Math.sin(x*0.02)*Math.sin(z*0.02); }
      c.setHSL(hue,sat,lig);
      cols[i*3]=c.r; cols[i*3+1]=c.g; cols[i*3+2]=c.b;
    }
    geo.setAttribute('color',new THREE.BufferAttribute(cols,3));
    geo.computeVertexNormals();
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.9,metalness:0.02});
    this.scene.add(new THREE.Mesh(geo,mat));
    // dream water
    this.waterMat=new THREE.MeshStandardMaterial({color:0x3a76c8,transparent:true,opacity:0.72,roughness:0.15,metalness:0.3,emissive:0x1a4a9a,emissiveIntensity:0.6});
    const water=new THREE.Mesh(new THREE.CircleGeometry(ISLAND+900,64),this.waterMat);
    water.rotation.x=-Math.PI/2; water.position.y=-12;
    this.scene.add(water);
  },
  prop(mesh,x,z,dy=0){ mesh.position.set(x,terrainH(x,z)+dy,z); this.scene.add(mesh); return mesh; },
  buildFeatures(){
    const scene=this.scene;
    // spawn plaza pillars
    const pil=new THREE.MeshPhysicalMaterial({color:0xcc55ff,roughness:0.2,metalness:0.3,iridescence:1,iridescenceIOR:1.7,emissive:0x5511aa,emissiveIntensity:0.5});
    for(const a of [0,1,2,3,4,5]){
      const x=Math.sin(a/6*TAU)*200, z=1200+Math.cos(a/6*TAU)*200;
      this.prop(new THREE.Mesh(new THREE.CylinderGeometry(16,20,170,12),pil),x,z,80);
    }
    // mushroom trees
    const stemM=stdM(0xe8dccc,0.7), capM=stdM(0xffffff,0.5,{emissiveIntensity:0.5});
    const treeAt=(x,z,s,hueOff)=>{
      const g=new THREE.Group();
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(14*s,20*s,150*s,10),stemM);
      stem.position.y=75*s; g.add(stem);
      const cm=capM.clone();
      cm.color.setHSL((hueOff%360)/360,0.8,0.55); cm.emissive.setHSL((hueOff%360)/360,0.8,0.3);
      const cap=new THREE.Mesh(new THREE.SphereGeometry(85*s,16,12,0,TAU,0,Math.PI/2),cm);
      cap.scale.set(1,0.6,1); cap.position.y=150*s; g.add(cap);
      this.prop(g,x,z);
    };
    [[500,900,1,40],[-420,660,1.3,150],[820,300,0.8,260],[-250,-200,1.1,320],[1100,-350,1.2,80],
     [-1050,-100,0.9,200],[240,330,0.7,10],[-700,1500,1.15,120],[900,1300,0.95,300],[1350,600,1.05,180],
     [-1350,500,0.85,60],[80,-1350,1.25,230]].forEach(([x,z,s,h])=>treeAt(x,z,s,h));
    // crystals scattered
    const cryM=stdM(0xffffff,0.15,{emissive:0xffffff,emissiveIntensity:0.8});
    for(let i=0;i<26;i++){
      const a=i*2.39996, r=300+((i*467)%1300);
      const x=Math.sin(a)*r, z=Math.cos(a)*r;
      if(terrainH(x,z)<-6) continue;
      const m=new THREE.Mesh(new THREE.OctahedronGeometry(10+((i*7)%14)),cryM.clone());
      m.material.color.setHSL(((i*47)%360)/360,0.9,0.62);
      m.material.emissive.setHSL(((i*47)%360)/360,0.9,0.4);
      m.rotation.set(i,i*2,i*0.5);
      this.prop(m,x,z,12);
    }
    // ring arches over the meadow
    this.rings=[];
    const ringM=new THREE.MeshBasicMaterial({transparent:true,opacity:0.6,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
    for(let i=0;i<5;i++){
      const x=-200-i*160, z=400-i*230;
      const ring=new THREE.Mesh(new THREE.TorusGeometry(70,4,10,48),ringM.clone());
      ring.position.set(x,terrainH(x,z)+110+i*24,z);
      ring.userData={hue:(i*60)%360};
      scene.add(ring); this.rings.push(ring);
    }
    // floating lotus stairway (east, spirals up)
    const padM=stdM(0x7be8c8,0.4,{emissive:0x3ddc9c,emissiveIntensity:1.2});
    const padM2=stdM(0xf08cc8,0.4,{emissive:0xe860ae,emissiveIntensity:1.2});
    this.padMats=[padM,padM2];
    for(let i=0;i<8;i++){
      const a=i*0.55, x=1250+Math.sin(a)*170, z=520-i*120;
      const y=terrainH(1250,520)+80+i*85;
      const mesh=new THREE.Mesh(new THREE.CylinderGeometry(55,62,16,12),i%2?padM:padM2);
      mesh.position.set(x,y,z);
      scene.add(mesh);
      this.pads.push({x,z,r:58,y:y+8,mesh});
    }
    // bounce bloom field (west) + cloud platform
    this.bloomMat=stdM(0xd6ff5e,0.35,{emissive:0x9fdd22,emissiveIntensity:1.4});
    this.bloomMeshes=[];
    for(const [x,z] of [[-1250,200],[-1100,420],[-1380,480]]){
      const g=new THREE.Group();
      const coil=new THREE.Mesh(new THREE.CylinderGeometry(18,26,50,10),stdM(0x55cc66,0.5,{emissive:0x228833,emissiveIntensity:0.4}));
      coil.position.y=25; g.add(coil);
      const padT=new THREE.Mesh(new THREE.CylinderGeometry(46,40,16,14),this.bloomMat);
      padT.position.y=58; g.add(padT);
      this.prop(g,x,z);
      this.blooms.push({x,z,r:52,y:terrainH(x,z)+66,g});
      this.pads.push({x,z,r:52,y:terrainH(x,z)+66});   // the flower top is standable → landing launches
      this.bloomMeshes.push(g);
    }
    const cloud=new THREE.Mesh(new THREE.CylinderGeometry(150,170,26,18),stdM(0xf4f0ff,0.6,{emissive:0xbbaaff,emissiveIntensity:0.5}));
    cloud.position.set(-1240,terrainH(-1240,360)+430,360);
    scene.add(cloud);
    this.pads.push({x:-1240,z:360,r:155,y:cloud.position.y+13});
    // lake island
    // (terrain dips; a small rock island poking through the water)
    const isl=new THREE.Mesh(new THREE.SphereGeometry(90,16,12),stdM(0x8877aa,0.8));
    isl.position.set(-900,-40,900); isl.scale.y=0.55; scene.add(isl);
    this.pads.push({x:-900,z:900,r:80,y:8});
    // checkpoint crystals
    this.crystalMeshes=[];
    const mkCrystal=(x,z,label)=>{
      const m=new THREE.Mesh(new THREE.OctahedronGeometry(26),stdM(0x9988bb,0.2,{emissive:0x442266,emissiveIntensity:0.6}));
      this.prop(m,x,z,44);
      this.crystals.push({x,z,y:terrainH(x,z),m,label,active:false});
      this.crystalMeshes.push(m);
    };
    mkCrystal(0,1200,'plaza');
    mkCrystal(-620,760,'lake shore');
    mkCrystal(260,-160,'mountain gate');
    // the Great Eye at the summit
    const sumX=300,sumZ=-700, sumY=terrainH(sumX,sumZ);
    const eye=this.eye=new THREE.Group();
    eye.position.set(sumX,sumY+150,sumZ);
    const sclera=new THREE.Mesh(new THREE.SphereGeometry(1,24,18),stdM(0xf5efe2,0.35,{emissive:0xfff8ea,emissiveIntensity:0.3}));
    sclera.scale.set(90,62,26);
    this.eyeIris=new THREE.MeshBasicMaterial({color:0xff44aa,fog:false});
    const iris=new THREE.Mesh(new THREE.SphereGeometry(30,20,16),this.eyeIris);
    iris.position.z=10;
    this.eyePupil=new THREE.Mesh(new THREE.SphereGeometry(14,16,12),new THREE.MeshBasicMaterial({color:0x0d0612}));
    this.eyePupil.position.z=24;
    eye.add(sclera,iris,this.eyePupil);
    this.eyeRingMats=[];
    for(let i=0;i<4;i++){
      const rm=new THREE.MeshBasicMaterial({transparent:true,opacity:0.4-i*0.07,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
      this.eyeRingMats.push(rm);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(115+i*26,3,8,64),rm);
      eye.add(ring);
    }
    scene.add(eye);
    // ---------------- collectibles ----------------
    // bones: rings, trails and spirals (~90)
    const bonesGeo=Render3D.mergeGeoms.call(Render3D,[
      Render3D.xform.call(Render3D,new THREE.CylinderGeometry(4.5,4.5,18,8),0,0,0,0,0,Math.PI/2),
      Render3D.xform.call(Render3D,new THREE.SphereGeometry(6,8,6),-10,5,0),
      Render3D.xform.call(Render3D,new THREE.SphereGeometry(6,8,6),-10,-5,0),
      Render3D.xform.call(Render3D,new THREE.SphereGeometry(6,8,6),10,5,0),
      Render3D.xform.call(Render3D,new THREE.SphereGeometry(6,8,6),10,-5,0),
    ]);
    const addBone=(x,y,z)=>{ this.bones.push({x,y,z,taken:false,t:this.bones.length*0.4}); };
    for(let i=0;i<14;i++){ const a=i/14*TAU; addBone(Math.sin(a)*320,terrainH(Math.sin(a)*320,1200+Math.cos(a)*320)+34,1200+Math.cos(a)*320); }
    for(let i=0;i<16;i++){ const t=i/16; const x=lerp(0,300,t), z=lerp(900,-450,t); addBone(x,terrainH(x,z)+36,z); }              // road to the mountain
    for(let i=0;i<14;i++){ const a=i*0.62; const r=430-i*24; const x=300+Math.sin(a)*r, z=-700+Math.cos(a)*r; addBone(x,terrainH(x,z)+40,z); }  // mountain spiral
    for(let i=0;i<10;i++){ const t=i/10; const x=lerp(-300,-1150,t), z=lerp(600,300,t); addBone(x,terrainH(x,z)+34,z); }         // to the bloom field
    for(let i=0;i<8;i++){ const p=this.pads[Math.min(i,7)]; addBone(p.x,p.y+40,p.z); }                                            // lotus stairway
    for(let i=0;i<10;i++){ const a=i/10*TAU; addBone(-900+Math.sin(a)*160,4+((i%2)*22),900+Math.cos(a)*160); }                    // lake ring
    for(let i=0;i<10;i++){ const t=i/10; const x=lerp(200,900,t), z=lerp(1000,300,t); addBone(x,terrainH(x,z)+34,z); }            // east trail
    for(const r of this.rings){ addBone(r.position.x,r.position.y,r.position.z); }
    this.totalBones=this.bones.length;
    this.bonesMesh=new THREE.InstancedMesh(bonesGeo,stdM(0xfdf8ee,0.3,{emissive:0xfff6d8,emissiveIntensity:0.55}),this.bones.length);
    scene.add(this.bonesMesh);
    // 5 tennis balls (hidden-ish)
    const ballAt=(x,z,dy)=>{ this.balls.push({x,y:terrainH(x,z)+dy,z,taken:false,t:this.balls.length}); };
    ballAt(660,1560,40);        // behind the plaza treeline
    ballAt(-1120,-760,44);      // far north-west wilds
    this.balls.push({x:-900,y:60,z:900,taken:false,t:2});   // above the lake island
    ballAt(1500,-300,46);       // eastern cliffs
    this.balls.push({x:this.pads[4].x,y:this.pads[4].y+50,z:this.pads[4].z,taken:false,t:4});  // mid lotus climb
    this.ballMeshes=this.balls.map(bl=>{
      const g=new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(16,16,12),stdM(0xd7f74a,0.3,{emissive:0xa8d824,emissiveIntensity:1.0})));
      const seam=new THREE.Mesh(new THREE.TorusGeometry(15,1.6,6,32),stdM(0xffffff,0.4,{emissive:0xffffff,emissiveIntensity:0.45}));
      seam.rotation.x=0.9; g.add(seam);
      scene.add(g); return g;
    });
    // 7 zoomie stars
    const starAt=(x,y,z,hint)=>{ this.stars.push({x,y,z,taken:false,hint,special:false}); };
    starAt(sumX,sumY+70,sumZ-140,'at the summit beside the Great Eye');
    const lp=this.pads[7]; starAt(lp.x,lp.y+70,lp.z,'atop the lotus stairway');
    starAt(-1240,terrainH(-1240,360)+500,360,'on the cloud — ride a bounce bloom');
    starAt(-900,90,900,'over the lake island');
    starAt(300,terrainH(300,-1250)+60,-1250,'on the wild north ledge');
    const r4=this.rings[4]; starAt(r4.position.x,r4.position.y+10,r4.position.z,'through the last dream ring');
    this.stars.push({x:0,y:terrainH(0,1200)+70,z:1200,taken:false,special:true,hint:'gather 60 cosmic bones'});
    this.starMeshes=this.stars.map(st=>{
      const g=new THREE.Group();
      const m=new THREE.Mesh(new THREE.IcosahedronGeometry(26,0),stdM(0xffee66,0.25,{emissive:0xffcc00,emissiveIntensity:2.4}));
      g.add(m);
      const glow=new THREE.Mesh(new THREE.SphereGeometry(40,12,10),new THREE.MeshBasicMaterial({color:0xffe27a,transparent:true,opacity:0.15,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
      g.add(glow);
      g.position.set(st.x,st.y,st.z);
      g.visible=!st.special;
      this.scene.add(g); return g;
    });
    // ---------------- enemies ----------------
    const mkShroom=(x,z)=>{
      const e={type:'shroom',x,z,y:0,home:{x,z},heading:(x*0.01)%TAU,speed:1.1,alive:true,squash:1,hueOff:(Math.abs(x*7+z*3))%360};
      e.rig=Render3D.buildShroomRig(e);
      e.rig.scale.setScalar(1.6);
      this.scene.add(e.rig);
      this.enemies.push(e);
    };
    const mkJelly=(x,z,hover)=>{
      const e={type:'jelly',x,z,hover,ph:(x*0.01)%TAU,alive:true,squash:1,hueOff:(Math.abs(x*3+z*7))%360};
      e.rig=Render3D.buildJellyRig(e);
      e.rig.scale.setScalar(1.7);
      this.scene.add(e.rig);
      this.enemies.push(e);
    };
    [[380,760],[-260,420],[640,140],[-640,-60],[150,-40],[980,820]].forEach(([x,z])=>mkShroom(x,z));
    [[300,-260,120],[520,-560,140],[-880,660,110],[-1180,320,130]].forEach(([x,z,h])=>mkJelly(x,z,h));
  },

  // ---------------- particles ----------------
  initParticles(){
    const MAXP=500;
    this.MAXP=MAXP; this.parts=[];
    this.pGeo=new THREE.BufferGeometry();
    this.pPos=new Float32Array(MAXP*3); this.pCol=new Float32Array(MAXP*3);
    this.pSize=new Float32Array(MAXP); this.pAlp=new Float32Array(MAXP);
    this.pGeo.setAttribute('position',new THREE.BufferAttribute(this.pPos,3));
    this.pGeo.setAttribute('aCol',new THREE.BufferAttribute(this.pCol,3));
    this.pGeo.setAttribute('aSize',new THREE.BufferAttribute(this.pSize,1));
    this.pGeo.setAttribute('aAlp',new THREE.BufferAttribute(this.pAlp,1));
    const mat=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false,
      vertexShader:`attribute vec3 aCol; attribute float aSize; attribute float aAlp; varying vec3 vC; varying float vA;
        void main(){ vC=aCol; vA=aAlp; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=aSize*(620.0/max(1.0,-mv.z)); gl_Position=projectionMatrix*mv; }`,
      fragmentShader:`varying vec3 vC; varying float vA;
        void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(vC*1.7,smoothstep(0.5,0.12,d)*vA); }`,
    });
    const pts=new THREE.Points(this.pGeo,mat);
    pts.frustumCulled=false;
    this.scene.add(pts);
  },
  part(x,y,z,vx,vy,vz,life,h,s,l,size){
    if(this.parts.length>this.MAXP-1) this.parts.shift();
    this.parts.push({x,y,z,vx,vy,vz,l:life,l0:life,h,s,ll:l,sz:size});
  },
  burst(x,y,z,n,hue){
    for(let i=0;i<n;i++){
      const a=Math.random()*TAU, b=Math.random()*Math.PI;
      const sp=2+Math.random()*3;
      this.part(x,y,z,Math.sin(a)*Math.cos(b)*sp,Math.abs(Math.sin(b))*sp,Math.cos(a)*Math.cos(b)*sp,1.2,(hue+Math.random()*60)%360,0.95,0.68,7);
    }
  },
  syncParticles(){
    const c=new THREE.Color();
    const n=Math.min(this.parts.length,this.MAXP);
    for(let i=0;i<n;i++){
      const p=this.parts[i];
      this.pPos[i*3]=p.x; this.pPos[i*3+1]=p.y; this.pPos[i*3+2]=p.z;
      c.setHSL((p.h%360)/360,p.s,p.ll);
      this.pCol[i*3]=c.r; this.pCol[i*3+1]=c.g; this.pCol[i*3+2]=c.b;
      this.pSize[i]=p.sz; this.pAlp[i]=Math.max(0,p.l/p.l0);
    }
    this.pGeo.setDrawRange(0,n);
    this.pGeo.attributes.position.needsUpdate=true;
    this.pGeo.attributes.aCol.needsUpdate=true;
    this.pGeo.attributes.aSize.needsUpdate=true;
    this.pGeo.attributes.aAlp.needsUpdate=true;
  },

  // ---------------- post pipeline (compact copy of the odyssey chain) ----------------
  initPost(){
    this.postCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.postScene=new THREE.Scene();
    this.postQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),null);
    this.postScene.add(this.postQuad);
    this.brightMat=new THREE.ShaderMaterial({uniforms:{tex:{value:null}},vertexShader:QUAD,
      fragmentShader:`uniform sampler2D tex; varying vec2 vUv;
        void main(){ vec3 c=texture2D(tex,vUv).rgb; float l=dot(c,vec3(0.299,0.587,0.114));
        gl_FragColor=vec4(c*smoothstep(0.9,1.5,l),1.0); }`});
    this.blurMat=new THREE.ShaderMaterial({uniforms:{tex:{value:null},dir:{value:new THREE.Vector2(1,0)},texel:{value:new THREE.Vector2(1/640,1/360)}},vertexShader:QUAD,
      fragmentShader:`uniform sampler2D tex; uniform vec2 dir; uniform vec2 texel; varying vec2 vUv;
        void main(){ vec2 o=dir*texel; vec3 c=texture2D(tex,vUv).rgb*0.227;
        c+=(texture2D(tex,vUv+o*1.384).rgb+texture2D(tex,vUv-o*1.384).rgb)*0.316;
        c+=(texture2D(tex,vUv+o*3.230).rgb+texture2D(tex,vUv-o*3.230).rgb)*0.070;
        gl_FragColor=vec4(c,1.0); }`});
    this.compMat=new THREE.ShaderMaterial({uniforms:{tScene:{value:null},tBloom:{value:null},tPrev:{value:null},uT:{value:0},uTrip:{value:0.4},uFeed:{value:0.5}},vertexShader:QUAD,
      fragmentShader:`precision highp float;
        uniform sampler2D tScene,tBloom,tPrev; uniform float uT,uTrip,uFeed; varying vec2 vUv;
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
        vec3 hueShift(vec3 c,float a){ const vec3 k=vec3(0.57735); float ca=cos(a),sa=sin(a);
          return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.0-ca); }
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
          gl_FragColor=vec4(col,1.0);
        }`});
    this.copyMat=new THREE.ShaderMaterial({uniforms:{tex:{value:null}},vertexShader:QUAD,
      fragmentShader:`uniform sampler2D tex; varying vec2 vUv; void main(){ gl_FragColor=texture2D(tex,vUv); }`});
  },
  runPass(mat,target){
    this.postQuad.material=mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.postScene,this.postCam);
  },
  allocRTs(w,h){
    for(const rt of [this.rtScene,this.rtA,this.rtB,this.rtOut,this.rtPrev]) if(rt) rt.dispose();
    const samples=isMobile?0:4;
    this.rtScene=new THREE.WebGLRenderTarget(w,h,{type:THREE.HalfFloatType,samples,depthBuffer:true});
    const bw=Math.max(2,w>>1), bh=Math.max(2,h>>1);
    this.rtA=new THREE.WebGLRenderTarget(bw,bh,{type:THREE.HalfFloatType});
    this.rtB=new THREE.WebGLRenderTarget(bw,bh,{type:THREE.HalfFloatType});
    this.rtOut=new THREE.WebGLRenderTarget(w,h,{});
    this.rtPrev=new THREE.WebGLRenderTarget(w,h,{});
    this.blurMat.uniforms.texel.value.set(1/bw,1/bh);
  },
  resize(fw,fh){
    if(!this.built) return;
    const scale=Save.settings.quality==='low'?0.5:Save.settings.quality==='medium'?0.75:(isMobile?0.6:1);
    const dpr=Math.min(window.devicePixelRatio||1,isMobile?1.5:1.75)*scale;
    let cw=fw||Math.floor((innerWidth||1280)*dpr), ch=fh||Math.floor((innerHeight||720)*dpr);
    if(cw<8||ch<8){ cw=1280; ch=720; }
    this.renderer.setSize(cw,ch,false);
    this.camera.aspect=cw/ch;
    this.camera.updateProjectionMatrix();
    this.allocRTs(cw,ch);
  },
  forceSize(w,h){ this.ensure(); this.resize(w,h); },

  // ---------------- session ----------------
  start(charId){
    this.ensure();
    this.charId=charId;
    if(this.dog){ this.scene.remove(this.dog.root); }
    this.dog=Render3D.buildDogFor.call({scene:this.scene},CHARS[charId]||CHARS.rue);
    this.dog.root.scale.setScalar(1.7);
    this.p={pos:new THREE.Vector3(0,terrainH(0,1300)+4,1300),vel:new THREE.Vector3(),
      yaw:Math.PI, grounded:true, spinning:false, spinA:0, coyote:0,
      hearts:3, bones:0, balls:0, stars:0, inv:0, runPhase:0, idleT:0, big:false, star:0};
    this.respawn.set(0,terrainH(0,1300)+4,1300);
    this.camYaw=0;   // camera south of the pup, gazing north at the mountain
    this.gt=0; this.playT=0; this.winT=0; this.state='play'; this.paused=false;
    this.toasts.length=0;
    for(const b of this.bones) b.taken=false;
    for(const b of this.balls) b.taken=false;
    this.stars.forEach((s,i)=>{ s.taken=false; this.starMeshes[i].visible=!s.special; });
    this.enemies.forEach(e=>{ e.alive=true; e.squash=1; e.rig.visible=true; });
    this.crystals.forEach(c=>c.active=false);
    this.active=true;
    document.getElementById('stageRoam').classList.remove('hidden');
    this.toast('✧ find the 7 zoomie stars ✧');
    this.resize();
  },
  hide(){ this.active=false; document.getElementById('stageRoam').classList.add('hidden'); },

  // ---------------- update ----------------
  update(){
    if(!this.active||this.paused) return;
    this.gt+=1/60;
    const p=this.p, In=Input;
    if(this.state==='play') this.playT+=1/60;
    // camera yaw control
    let camMoved=false;
    if(In.rstick&&Math.abs(In.rstick.x)>0.05){ this.camYaw-=In.rstick.x*0.045; camMoved=true; }
    if(In.camL){ this.camYaw+=0.035; camMoved=true; }
    if(In.camR){ this.camYaw-=0.035; camMoved=true; }
    // movement (camera-relative)
    const st=(CHARS[this.charId]||CHARS.rue).stats;
    const sp=In.stick||{x:0,y:0};
    const fwd=this._v.set(-Math.sin(this.camYaw),0,-Math.cos(this.camYaw));
    const right=this._v2.set(Math.cos(this.camYaw),0,-Math.sin(this.camYaw));
    let wx=right.x*sp.x+fwd.x*(-sp.y);
    let wz=right.z*sp.x+fwd.z*(-sp.y);
    const wishMag=Math.hypot(wx,wz);
    const maxSpd=(In.run?st.run:st.walk)*1.35;
    if(this.state!=='play'){ wx=0; wz=0; }
    if(wishMag>0.05){
      const inv=1/wishMag;
      p.vel.x+=wx*inv*Math.min(wishMag,1)*st.accel*1.4;
      p.vel.z+=wz*inv*Math.min(wishMag,1)*st.accel*1.4;
      p.yaw=angLerp(p.yaw,Math.atan2(wx,wz),0.3);
      if(!camMoved) this.camYaw=angLerp(this.camYaw,Math.atan2(-wx,-wz),0.015);
      p.idleT=0;
    } else if(p.grounded){
      p.vel.x*=st.fric; p.vel.z*=st.fric;
      p.idleT+=1/60;
    }
    const hs=Math.hypot(p.vel.x,p.vel.z);
    if(hs>maxSpd){ p.vel.x*=maxSpd/hs; p.vel.z*=maxSpd/hs; }
    // jumping
    if(p.grounded) p.coyote=6; else if(p.coyote>0) p.coyote--;
    if((In.jumpP||In.spinP)&&p.coyote>0&&this.state==='play'){
      p.coyote=0; p.grounded=false;
      p.spinning=In.spinP&&!In.jumpP; p.spinA=0;
      p.vel.y=(p.spinning?st.jump*0.92:st.jump)*1.05+hs*0.12;
      p.canCut=true;
      if(p.spinning) Sound.spinS(); else Sound.jump();
      this.burst(p.pos.x,p.pos.y,p.pos.z,6,(this.gt*80)%360);
    }
    if(p.canCut&&!In.jump&&!In.spin&&p.vel.y>3.8){ p.vel.y=3.8; p.canCut=false; }
    p.vel.y-=GRAV;
    // spin float
    if(p.spinning){
      p.spinA+=0.45;
      if(p.vel.y<-2.2&&(In.spin||In.jump)) p.vel.y=-2.2;
    }
    if(p.vel.y<-12) p.vel.y=-12;
    // integrate
    p.pos.x+=p.vel.x; p.pos.z+=p.vel.z; p.pos.y+=p.vel.y;
    // water wading slows you
    const inWater=p.pos.y<-4&&terrainH(p.pos.x,p.pos.z)<-8;
    if(inWater){ p.vel.x*=0.9; p.vel.z*=0.9; if(Math.random()<0.3) this.part(p.pos.x,p.pos.y+4,p.pos.z,(Math.random()-0.5)*2,1.5,(Math.random()-0.5)*2,0.6,205,0.8,0.7,5); }
    // ground
    const gh=this.groundH(p.pos.x,p.pos.z);
    if(p.pos.y<=gh+2&&p.vel.y<=0.01){
      p.pos.y=gh; p.vel.y=0;
      if(!p.grounded&&p.spinning) p.spinning=false;
      p.grounded=true;
      // bounce blooms
      for(const b of this.blooms){
        if(Math.hypot(p.pos.x-b.x,p.pos.z-b.z)<b.r&&Math.abs(p.pos.y-b.y)<26){
          p.vel.y=(In.jump||In.spin)?19.5:16.5;
          p.grounded=false; p.canCut=false;   // a bloom launch is never jump-cut
          Sound.boing(); this.addTrip(0.15);
          this.burst(b.x,b.y,b.z,10,120);
        }
      }
    } else p.grounded=false;
    // dream tide (fell off the island edge)
    if(p.pos.y<-160){
      p.pos.copy(this.respawn); p.vel.set(0,0,0); p.inv=140;
      this.toast('the dream tide carries you back…');
    }
    if(p.inv>0)p.inv--;
    if(p.runPhase!==undefined&&p.grounded&&hs>0.4) p.runPhase+=hs*0.045;
    // checkpoints
    for(const c of this.crystals){
      if(!c.active&&Math.hypot(p.pos.x-c.x,p.pos.z-c.z)<70&&Math.abs(p.pos.y-c.y)<90){
        this.crystals.forEach(o=>o.active=false);
        c.active=true;
        this.respawn.set(c.x,c.y+4,c.z);
        Sound.heartS(); this.toast(`checkpoint attuned — ${c.label} ✧`); this.addTrip(0.3);
        this.burst(c.x,c.y+50,c.z,16,Math.random()*360);
      }
    }
    this.updatePickups();
    this.updateEnemies();
    if(this.state==='win') this.winT+=1/60;
    // trip
    let base=0.32+0.06*Math.sin(this.gt*0.23);
    if(this.state==='win') base=1;
    const scale=Save.settings.trip;
    this.trip+=(clamp((base+this.tripPulse)*scale,0,1.2)-this.trip)*0.04;
    this.tripPulse*=0.97;
    for(let i=this.parts.length-1;i>=0;i--){
      const q=this.parts[i];
      q.vy-=0.06; q.x+=q.vx; q.y+=q.vy; q.z+=q.vz; q.l-=1/60;
      if(q.l<=0) this.parts.splice(i,1);
    }
    for(let i=this.toasts.length-1;i>=0;i--){ this.toasts[i].t-=1/60; if(this.toasts[i].t<=0) this.toasts.splice(i,1); }
  },
  updatePickups(){
    const p=this.p;
    for(const b of this.bones){
      if(b.taken) continue;
      if(Math.hypot(p.pos.x-b.x,p.pos.z-b.z)<32&&Math.abs(p.pos.y+16-b.y)<44){
        b.taken=true; p.bones++;
        Sound.bone(); this.addTrip(0.1);
        this.burst(b.x,b.y,b.z,5,55);
        if(p.bones===60){
          const st7=this.stars[6];
          if(!st7.taken){ this.starMeshes[6].visible=true; this.toast('★ a zoomie star appears at the plaza!'); Sound.power(); }
        }
      }
    }
    for(let i=0;i<this.balls.length;i++){
      const bl=this.balls[i];
      if(bl.taken) continue;
      if(Math.hypot(p.pos.x-bl.x,p.pos.z-bl.z)<40&&Math.abs(p.pos.y+16-bl.y)<52){
        bl.taken=true; p.balls++;
        Sound.squeak(); this.addTrip(0.3);
        this.burst(bl.x,bl.y,bl.z,14,80);
        this.toast(`🎾 tennis ball ${p.balls}/5!`);
      }
    }
    for(let i=0;i<this.stars.length;i++){
      const st=this.stars[i];
      if(st.taken||(st.special&&!this.starMeshes[i].visible)) continue;
      if(Math.hypot(p.pos.x-st.x,p.pos.z-st.z)<60&&Math.abs(p.pos.y+20-st.y)<80){
        st.taken=true; p.stars++;
        this.starMeshes[i].visible=false;
        Sound.starJ(); this.addTrip(0.8);
        this.burst(st.x,st.y,st.z,26,45);
        this.toast(`★ zoomie star ${p.stars}/7!`);
        if(p.stars>=7){
          this.state='win'; this.winT=0;
          Sound.winS();
          Save.recordWin('roam1',p.bones*100+p.balls*1000+p.stars*2000+Math.max(0,Math.round(600-this.playT))*10,p.bones,this.playT,p.balls);
          this.burst(this.eye.position.x,this.eye.position.y,this.eye.position.z,40,300);
        }
      }
    }
  },
  updateEnemies(){
    const p=this.p;
    for(const e of this.enemies){
      if(!e.alive){
        e.squash=Math.max(0,e.squash-0.05);
        e.rig.scale.set(2.0,Math.max(0.05,e.squash)*1.6,2.0);
        if(e.squash<=0) e.rig.visible=false;
        continue;
      }
      if(e.type==='shroom'){
        e.heading+=(Math.sin(this.gt*0.7+e.hueOff)*0.02);
        const hd=Math.hypot(e.x-e.home.x,e.z-e.home.z);
        if(hd>260) e.heading=Math.atan2(e.home.x-e.x,e.home.z-e.z);
        e.x+=Math.sin(e.heading)*e.speed;
        e.z+=Math.cos(e.heading)*e.speed;
        e.y=terrainH(e.x,e.z);
        e.rig.position.set(e.x,e.y,e.z);
        e.rig.rotation.y=e.heading+Math.PI;
        e.rig.position.y+=-Math.abs(Math.sin(this.gt*9+e.hueOff))*2;
      } else {
        e.ph+=0.012;
        const ex=e.x+Math.sin(e.ph)*90, ez=e.z+Math.cos(e.ph*0.7)*90;
        e.cy=terrainH(ex,ez)+e.hover+Math.sin(this.gt*2+e.hueOff)*24;
        e.rig.position.set(ex,e.cy,ez);
        e.rig.userData.tents.forEach((tn,i)=>{ tn.rotation.x=Math.sin(this.gt*5+i)*0.4; });
        e.cx=ex; e.cz=ez;
      }
      if(this.state!=='play'||p.inv>0) continue;
      const ex=e.type==='shroom'?e.x:e.cx, ez=e.type==='shroom'?e.z:e.cz;
      const ey=e.type==='shroom'?e.y+24:e.cy;
      if(Math.hypot(p.pos.x-ex,p.pos.z-ez)<44&&Math.abs(p.pos.y+16-ey)<52){
        const stomp=p.vel.y<-1&&p.pos.y>ey+8;
        if(stomp&&(e.type==='shroom'||p.spinning)){
          e.alive=false;
          p.vel.y=In2Jump()?11:8;
          Sound.stomp(); this.addTrip(0.2);
          this.burst(ex,ey+20,ez,12,(e.hueOff+this.gt*120)%360);
        } else {
          p.hearts--; p.inv=140;
          Sound.hurtS();
          p.vel.x=(p.pos.x-ex)*0.2; p.vel.z=(p.pos.z-ez)*0.2; p.vel.y=5;
          if(p.hearts<=0){
            p.hearts=3;
            this.toast(`${(CHARS[this.charId]||CHARS.rue).name} took a quick nap — back to the zoomies!`);
            p.pos.copy(this.respawn); p.vel.set(0,0,0); p.inv=160;
          }
        }
      }
    }
    function In2Jump(){ return Input.jump; }
  },

  // ---------------- render ----------------
  render(){
    if(!this.built||!this.active) return;
    const t=this.gt, p=this.p;
    // camera
    const tx=p.pos.x, ty=p.pos.y+46, tz=p.pos.z;
    const cx=tx+Math.sin(this.camYaw)*this.camDist;
    const cz=tz+Math.cos(this.camYaw)*this.camDist;
    let cy=ty+this.camH;
    const camGround=terrainH(cx,cz)+26;
    if(cy<camGround) cy=camGround;
    this.camera.position.lerp(this._v.set(cx,cy,cz),0.16);
    this.camera.lookAt(tx,ty+16,tz);
    this.sky.position.copy(this.camera.position);
    this.skyMat.uniforms.uT.value=t;
    this.skyMat.uniforms.uTrip.value=this.trip;
    this.compMat.uniforms.uT.value=t;
    this.compMat.uniforms.uTrip.value=this.trip;
    this.compMat.uniforms.uFeed.value=0.30+0.26*this.trip;
    // dog
    const dog=this.dog;
    dog.root.position.copy(p.pos);
    dog.root.rotation.y=p.yaw-Math.PI/2;   // rig's local +x faces the heading
    const hs=Math.hypot(p.vel.x,p.vel.z);
    const air=!p.grounded;
    const sitting=p.idleT>4||this.state==='win';
    let pitch=0,bob=0;
    if(air) pitch=clamp(p.vel.y*0.035,-0.3,0.4);
    else if(hs>0.4) bob=Math.abs(Math.sin(p.runPhase*Math.PI*2))*1.4;
    if(sitting) pitch=0.95;
    dog.rig.rotation.z+=(pitch-dog.rig.rotation.z)*0.2;
    dog.rig.position.y=bob+(sitting?2:0);
    if(p.spinning) dog.rig.rotation.y=p.spinA; else dog.rig.rotation.y*=0.6;
    dog.root.visible=!(p.inv>0&&Math.floor(t*18)%2===0&&this.state==='play');
    dog.tongue.visible=hs>5&&p.grounded;
    for(const piv of dog.ears){
      const s=piv.userData.s;
      let txr=piv.userData.rose?s*1.1:s*1.45, tzr=piv.userData.rose?0.5:-0.2;
      if(air&&p.vel.y>0.5){ txr=s*0.4; tzr=0.15; }
      else if(air){ txr=s*0.7; tzr=0.35; }
      piv.rotation.x+=(txr-piv.rotation.x)*0.25;
      piv.rotation.z+=(tzr-piv.rotation.z)*0.25;
    }
    for(const piv of dog.legs){
      const u=piv.userData;
      let target;
      if(sitting) target=u.front?0.55:-0.5;
      else if(air&&p.vel.y>0.5) target=u.front?-0.85:0.7;
      else if(air) target=u.front?0.45:-0.45;
      else if(hs>0.4) target=Math.sin(p.runPhase*Math.PI*2+u.phase)*0.75;
      else target=0;
      piv.rotation.z+=(target-piv.rotation.z)*0.3;
    }
    dog.tail.rotation.x=Math.sin(t*(hs>0.5?14:6))*0.55;
    this.dogLight.position.set(p.pos.x,p.pos.y+60,p.pos.z);
    this.dogLight.color.setHSL(((t*40)%360)/360,0.8,0.6);
    this.dogLight.intensity=2.6+this.trip*2.5;
    // world anims
    this.rings.forEach((r,i)=>{
      r.rotation.z=t*0.4+i;
      r.material.color.setHSL(((r.userData.hue+t*40)%360)/360,0.95,0.6);
    });
    for(const pm of this.padMats) pm.emissiveIntensity=1.0+0.6*Math.sin(t*3);
    if(this.bloomMat) this.bloomMat.emissiveIntensity=1.2+0.6*Math.sin(t*5);
    this.pads.forEach((pl,i)=>{ if(pl.mesh) pl.mesh.position.y=pl.y-8+Math.sin(t*1.2+i)*4; });
    this.crystals.forEach(c=>{
      c.m.rotation.y=t*(c.active?2.4:0.5);
      if(c.active){ c.m.material.emissive.setHSL(((t*80)%360)/360,0.9,0.5); c.m.material.emissiveIntensity=1.6; }
    });
    // eye
    const open=this.state==='win'?Math.min(1,this.winT):0.55+0.1*Math.sin(t*1.2);
    this.eye.scale.setScalar(1+0.05*Math.sin(t*2));
    this.eye.lookAt(p.pos.x,p.pos.y+40,p.pos.z);
    this.eyeIris.color.setHSL(((t*40)%360)/360,0.9,0.55);
    this.eyePupil.scale.setScalar(this.state==='win'?1.7*open+0.4:open);
    this.eyeRingMats.forEach((rm,i)=>rm.color.setHSL(((t*50+i*60)%360)/360,0.95,0.6));
    // collectibles anim
    const m4=new THREE.Matrix4(), q=new THREE.Quaternion(), e=new THREE.Euler(), v=new THREE.Vector3(), s=new THREE.Vector3(1,1,1);
    for(let i=0;i<this.bones.length;i++){
      const b=this.bones[i];
      if(b.taken){ m4.makeScale(0,0,0); this.bonesMesh.setMatrixAt(i,m4); continue; }
      e.set(0,t*1.5+b.t,Math.sin(t*1.6+b.t)*0.3);
      q.setFromEuler(e);
      v.set(b.x,b.y+Math.sin(t*2+b.t)*5,b.z);
      m4.compose(v,q,s);
      this.bonesMesh.setMatrixAt(i,m4);
    }
    this.bonesMesh.instanceMatrix.needsUpdate=true;
    this.balls.forEach((bl,i)=>{
      const g=this.ballMeshes[i];
      g.visible=!bl.taken;
      if(!bl.taken){ g.position.set(bl.x,bl.y+Math.sin(t*2.2+bl.t)*6,bl.z); g.rotation.y=t*1.5+bl.t; g.rotation.z=t; }
    });
    this.starMeshes.forEach((g,i)=>{
      if(!g.visible) return;
      g.position.y=this.stars[i].y+Math.sin(t*1.6+i)*8;
      g.rotation.y=t*1.2+i;
      g.children[0].rotation.x=t*0.9;
    });
    this.waterMat.emissiveIntensity=0.5+0.25*Math.sin(t*0.9);
    this.syncParticles();
    // post chain
    const r=this.renderer;
    r.setRenderTarget(this.rtScene);
    r.render(this.scene,this.camera);
    this.brightMat.uniforms.tex.value=this.rtScene.texture;
    this.runPass(this.brightMat,this.rtA);
    for(let i=0;i<2;i++){
      this.blurMat.uniforms.tex.value=this.rtA.texture; this.blurMat.uniforms.dir.value.set(1,0);
      this.runPass(this.blurMat,this.rtB);
      this.blurMat.uniforms.tex.value=this.rtB.texture; this.blurMat.uniforms.dir.value.set(0,1);
      this.runPass(this.blurMat,this.rtA);
    }
    this.compMat.uniforms.tScene.value=this.rtScene.texture;
    this.compMat.uniforms.tBloom.value=this.rtA.texture;
    this.compMat.uniforms.tPrev.value=this.rtPrev.texture;
    this.runPass(this.compMat,this.rtOut);
    this.copyMat.uniforms.tex.value=this.rtOut.texture;
    this.runPass(this.copyMat,null);
    const sw=this.rtPrev; this.rtPrev=this.rtOut; this.rtOut=sw;
  },
};
