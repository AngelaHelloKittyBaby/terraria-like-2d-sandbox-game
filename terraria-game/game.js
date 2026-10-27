"use strict";
// ============================================================
//  Terraria-Like 2D Sandbox Game  (可被 Node 检查/测试的模块)
// ============================================================
// ---------- Node 环境 DOM 兼容层 ----------
const IS_NODE = typeof window === 'undefined';
if (IS_NODE) {
  // 链式 mock: 任意方法调用返回自身, 任意属性读取返回函数
  const chainMock = new Proxy({}, { get: () => ((...a) => chainMock) });
  const mockEl = { style: {}, innerHTML: '', textContent: '', getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const mockCanvas = { width: 1280, height: 720, getBoundingClientRect: () => ({ left: 0, top: 0 }), addEventListener() {}, getContext: () => chainMock };
  globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {}, craftAndRefresh: null, restartGame: null };
  globalThis.document = { getElementById: (id) => id === 'game' ? mockCanvas : mockEl };
  globalThis.requestAnimationFrame = () => 0;
}

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0;            // 视口像素尺寸
function resize(){
  VW = canvas.width = window.innerWidth;
  VH = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ---------- 常量 ----------
const TS = 20;                 // 方块像素大小
const WORLD_W = 256;           // 世界宽度(方块)
const WORLD_H = 160;           // 世界高度(方块)
const GRAV = 0.55;             // 重力
const DAY_LEN = 120*60;        // 一天总帧数 (约120秒)
const REACH = 5*TS;            // 玩家交互距离(像素)

// ---------- 方块定义 ----------
const B = {
  AIR:0,GRASS:1,DIRT:2,STONE:3,WOOD:4,LEAF:5,SAND:6,COAL:7,IRON:8,GOLD:9,DIAM:10,
  PLANK:11,BENCH:12,TORCH:13,DOOR:14,WATER:15,SBRICK:16,GLASS:17,SNOW:18,ICE:19,BRICK:20,OBSID:21
};
const BLOCKS = {
  [B.GRASS]:{name:'草方块',hard:1,drop:B.DIRT,solid:true},
  [B.DIRT]:{name:'泥土',hard:1,drop:B.DIRT,solid:true},
  [B.STONE]:{name:'石头',hard:3,drop:B.STONE,solid:true},
  [B.WOOD]:{name:'木头',hard:2,drop:B.WOOD,solid:true},
  [B.LEAF]:{name:'树叶',hard:1,drop:0,solid:false},
  [B.SAND]:{name:'沙子',hard:1,drop:B.SAND,solid:true},
  [B.COAL]:{name:'煤矿',hard:3,drop:B.COAL,solid:true},
  [B.IRON]:{name:'铁矿',hard:4,drop:B.IRON,solid:true},
  [B.GOLD]:{name:'金矿',hard:5,drop:B.GOLD,solid:true},
  [B.DIAM]:{name:'钻石矿',hard:6,drop:B.DIAM,solid:true},
  [B.PLANK]:{name:'木板',hard:2,drop:B.PLANK,solid:true},
  [B.BENCH]:{name:'工作台',hard:2,drop:B.BENCH,solid:true},
  [B.TORCH]:{name:'火把',hard:0,drop:B.TORCH,solid:false,light:8},
  [B.DOOR]:{name:'门',hard:2,drop:B.DOOR,solid:false},
  [B.WATER]:{name:'水',hard:0,drop:0,solid:false,liquid:true},
  [B.SBRICK]:{name:'沙砖',hard:3,drop:B.SBRICK,solid:true},
  [B.GLASS]:{name:'玻璃',hard:1,drop:B.GLASS,solid:true},
  [B.SNOW]:{name:'雪',hard:1,drop:B.SNOW,solid:true},
  [B.ICE]:{name:'冰',hard:2,drop:B.ICE,solid:true},
  [B.BRICK]:{name:'砖块',hard:4,drop:B.BRICK,solid:true},
  [B.OBSID]:{name:'黑曜石',hard:8,drop:B.OBSID,solid:true},
};
function bname(id){ return id===0?'空气':(BLOCKS[id]?BLOCKS[id].name:'?'); }
function isSolid(id){ return BLOCKS[id]&&BLOCKS[id].solid; }
function isLiquid(id){ return id===B.WATER; }

// ---------- 简易噪声 ----------
let _seed = 12345;
function setSeed(s){ _seed=s>>>0; }
function rand(){ _seed=(_seed*1664525+1013904223)>>>0; return _seed/4294967296; }
function noise1(x){
  const xi=Math.floor(x), xf=x-xi;
  function h(i){ let s=(i*374761393+_seed)>>>0; s=(s*1274126177)>>>0; return s/4294967296; }
  const a=h(xi), b=h(xi+1);
  const t=xf*xf*(3-2*xf);
  return a*(1-t)+b*t;
}
function fbm(x){
  let v=0,amp=1,freq=1,sum=0;
  for(let i=0;i<4;i++){ v+=amp*noise1(x*freq); sum+=amp; amp*=0.5; freq*=2; }
  return v/sum;
}

// ---------- 世界 ----------
let world = new Uint8Array(WORLD_W*WORLD_H);
let lightMap = new Float32Array(WORLD_W*WORLD_H);
function W(x,y){ if(x<0||x>=WORLD_W||y<0||y>=WORLD_H) return B.STONE; return world[y*WORLD_W+x]; }
function setW(x,y,v){ if(x<0||x>=WORLD_W||y<0||y>=WORLD_H) return; world[y*WORLD_W+x]=v; }

function generateWorld(seed){
  setSeed(seed);
  const baseY = Math.floor(WORLD_H*0.45);
  for(let x=0;x<WORLD_W;x++){
    const h = Math.floor(fbm(x*0.05)*22 - 11);
    const surface = baseY + h;
    const biome = noise1(x*0.01+1000);
    for(let y=0;y<WORLD_H;y++){
      let id=B.AIR;
      if(y===surface){ id = biome<0.3?B.SAND:(biome>0.8?B.SNOW:B.GRASS); }
      else if(y>surface && y<surface+5){ id = biome<0.3?B.SAND:(biome>0.8?B.SNOW:B.DIRT); }
      else if(y>=surface+5){ id = B.STONE; }
      if(id===B.STONE){
        const depth = y-surface;
        const r = rand();
        if(depth>3 && r<0.04) id=B.COAL;
        else if(depth>8 && r<0.04+0.03) id=B.IRON;
        else if(depth>20 && r<0.07+0.02) id=B.GOLD;
        else if(depth>35 && r<0.09+0.015) id=B.DIAM;
        else if(depth>50 && r<0.105+0.01) id=B.OBSID;
      }
      setW(x,y,id);
    }
    if(biome>=0.3 && biome<=0.8 && rand()<0.08){
      const s = surface-1;
      const th = 4+Math.floor(rand()*4);
      for(let i=1;i<=th;i++) setW(x,s-i,B.WOOD);
      const cy=s-th;
      for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=1;dy++){
        if(Math.abs(dx)+Math.abs(dy)<=3 && W(x+dx,cy+dy)===B.AIR) setW(x+dx,cy+dy,B.LEAF);
      }
    }
  }
  for(let i=0;i<400;i++){
    let cx=Math.floor(rand()*WORLD_W);
    let cy=Math.floor(baseY+10+rand()*(WORLD_H-baseY-15));
    const len=20+Math.floor(rand()*60);
    let dir=rand()*Math.PI*2;
    for(let j=0;j<len;j++){
      const r=2+Math.floor(rand()*3);
      for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++){
        if(dx*dx+dy*dy<=r*r){
          const x=cx+dx,y=cy+dy;
          if(y>baseY+5 && W(x,y)!==B.AIR && rand()<0.9) setW(x,y,B.AIR);
        }
      }
      cx+=Math.cos(dir); cy+=Math.sin(dir)*0.5;
      dir+=(rand()-0.5)*0.4;
      if(cx<2||cx>=WORLD_W-2||cy>=WORLD_H-2) break;
    }
  }
}

// ---------- 玩家 ----------
const player = {
  x:0, y:0, vx:0, vy:0, w:TS*0.8, h:TS*1.8,
  onGround:false, hp:100, maxHp:100, facing:1,
  inv:[], sel:0, attackCD:0, mineCD:0, hurtCD:0,
  mode:'mine',
};
function initInv(){
  player.inv = [];
  for(let i=0;i<10;i++) player.inv.push({id:0,n:0});
  player.inv[0]={id:B.DIRT,n:50};
  player.inv[1]={id:B.STONE,n:30};
  player.inv[2]={id:B.WOOD,n:20};
  player.inv[3]={id:B.TORCH,n:10};
}
function addItem(id,n){
  if(id===0) return true;
  for(const it of player.inv){ if(it.id===id && it.n<99){ const add=Math.min(n,99-it.n); it.n+=add; n-=add; if(n<=0) return true; } }
  for(const it of player.inv){ if(it.id===0){ it.id=id; it.n=Math.min(n,99); n-=it.n; if(n<=0) return true; } }
  return n<=0;
}
function countItem(id){ let c=0; for(const it of player.inv) if(it.id===id) c+=it.n; return c; }
function removeItem(id,n){ for(const it of player.inv){ if(it.id===id){ const t=Math.min(n,it.n); it.n-=t; n-=t; if(it.n<=0){it.id=0;it.n=0;} if(n<=0) return; } } }

// ---------- 工具/武器 ----------
const TOOLS = {
  wood_pick:{name:'木镐',type:'pick',tier:1,power:2,dmg:1,mineMul:1.5},
  stone_pick:{name:'石镐',type:'pick',tier:2,power:4,dmg:2,mineMul:2.5},
  iron_pick:{name:'铁镐',type:'pick',tier:3,power:6,dmg:3,mineMul:4},
  wood_sword:{name:'木剑',type:'sword',tier:1,power:0,dmg:8},
  stone_sword:{name:'石剑',type:'sword',tier:2,power:0,dmg:14},
  iron_sword:{name:'铁剑',type:'sword',tier:3,power:0,dmg:22},
  wood_axe:{name:'木斧',type:'axe',tier:1,power:3,dmg:2,mineMul:1.2},
  stone_axe:{name:'石斧',type:'axe',tier:2,power:5,dmg:3,mineMul:1.8},
};
function toolKey(t){ return 'tool:'+t; }
function getSelTool(){
  const it = player.inv[player.sel];
  if(it && it.tool) return TOOLS[it.id.slice(5)];
  return null;
}

// ---------- 合成配方 ----------
const RECIPES = [
  {out:{id:B.PLANK,n:4}, need:[[B.WOOD,1]], bench:false},
  {out:{id:B.BENCH,n:1}, need:[[B.PLANK,4]], bench:false},
  {out:{id:B.TORCH,n:4}, need:[[B.WOOD,1],[B.COAL,1]], bench:false},
  {out:{id:B.SBRICK,n:1}, need:[[B.SAND,2]], bench:true},
  {out:{id:B.GLASS,n:1}, need:[[B.SAND,1],[B.COAL,1]], bench:true},
  {out:{id:B.BRICK,n:1}, need:[[B.STONE,2]], bench:true},
  {out:{id:B.DOOR,n:1}, need:[[B.PLANK,6]], bench:true},
  {out:{id:'wood_pick',n:1,tool:true}, need:[[B.PLANK,3],[B.WOOD,2]], bench:true},
  {out:{id:'stone_pick',n:1,tool:true}, need:[[B.STONE,3],[B.WOOD,2]], bench:true},
  {out:{id:'iron_pick',n:1,tool:true}, need:[[B.IRON,3],[B.WOOD,2]], bench:true},
  {out:{id:'wood_sword',n:1,tool:true}, need:[[B.PLANK,2],[B.WOOD,1]], bench:true},
  {out:{id:'stone_sword',n:1,tool:true}, need:[[B.STONE,2],[B.WOOD,1]], bench:true},
  {out:{id:'iron_sword',n:1,tool:true}, need:[[B.IRON,2],[B.WOOD,1]], bench:true},
  {out:{id:'wood_axe',n:1,tool:true}, need:[[B.PLANK,3],[B.WOOD,2]], bench:true},
  {out:{id:'stone_axe',n:1,tool:true}, need:[[B.STONE,3],[B.WOOD,2]], bench:true},
];
function nearBench(){
  const px=Math.floor((player.x+player.w/2)/TS), py=Math.floor((player.y+player.h/2)/TS);
  for(let dx=-3;dx<=3;dx++) for(let dy=-3;dy<=3;dy++){ if(W(px+dx,py+dy)===B.BENCH) return true; }
  return false;
}
function canCraft(r){
  if(r.bench && !nearBench()) return false;
  for(const [id,n] of r.need) if(countItem(id)<n) return false;
  return true;
}
function craft(r){
  if(!canCraft(r)) return;
  for(const [id,n] of r.need) removeItem(id,n);
  if(r.out.tool){ addTool(r.out.id, r.out.n); }
  else addItem(r.out.id, r.out.n);
}
// 添加工具(带 tool 标志)
function addTool(key,n){
  const tid = toolKey(key);
  for(const it of player.inv){ if(it.id===tid && it.n<99){ const add=Math.min(n,99-it.n); it.n+=add; n-=add; if(n<=0) return; } }
  for(const it of player.inv){ if(it.id===0){ it.id=tid; it.n=Math.min(n,99); it.tool=true; n-=it.n; if(n<=0) return; } }
}

// ---------- 僵尸 ----------
const zombies = [];
function spawnZombie(){
  const px=player.x;
  const side = Math.random()<0.5?-1:1;
  const sx = px + side*(VW/2+TS*2);
  const gx = Math.floor(sx/TS);
  let gy=2;
  while(gy<WORLD_H-1 && W(gx,gy)===B.AIR) gy++;
  gy--;
  if(gy<0||gy>=WORLD_H) return;
  zombies.push({x:gx*TS, y:gy*TS, vx:0, vy:0, w:TS*0.8, h:TS*1.6, hp:30, maxHp:30, hurtCD:0, atkCD:0, burning:false, burnT:0});
}

// ---------- 粒子 ----------
const particles = [];
function addParticle(x,y,color,vx,vy,life){ particles.push({x,y,vx,vy,life,maxLife:life,color}); }

// ---------- 游戏状态 ----------
let time = 0;
let dayTime = 0;
let camX=0, camY=0;
let mouseSX=0, mouseSY=0, mouseDown=false, rmouseDown=false;
let craftOpen=false;
let gameOver=false;
let keys={};
let gold = 0;
let dayCount = 1;
let wasNight = false;

if (!IS_NODE) {
  window.addEventListener('keydown',e=>{
    keys[e.key.toLowerCase()]=true;
    if(e.key.toLowerCase()==='e'){ craftOpen=!craftOpen; updateCraftMenu(); }
    if(e.key.toLowerCase()==='f'){ player.mode = player.mode==='mine'?'fight':'mine'; }
    if(e.key>='1'&&e.key<='9'){ player.sel=parseInt(e.key)-1; }
  });
  window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });
  canvas.addEventListener('mousemove',e=>{ const r=canvas.getBoundingClientRect(); mouseSX=e.clientX-r.left; mouseSY=e.clientY-r.top; });
  canvas.addEventListener('mousedown',e=>{ if(e.button===0)mouseDown=true; if(e.button===2)rmouseDown=true; });
  canvas.addEventListener('mouseup',e=>{ if(e.button===0)mouseDown=false; if(e.button===2)rmouseDown=false; });
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{ player.sel=(player.sel+(e.deltaY>0?1:-1)+10)%10; e.preventDefault(); });
}

// ---------- 光照 ----------
function computeLight(){
  for(let x=0;x<WORLD_W;x++){
    let l=1.0;
    for(let y=0;y<WORLD_H;y++){
      const id=W(x,y);
      if(id!==B.AIR && id!==B.LEAF && id!==B.TORCH && !isLiquid(id)) l=Math.max(0,l-0.12);
      else l=Math.max(0,l-0.02);
      lightMap[y*WORLD_W+x]=l;
    }
  }
  for(let x=0;x<WORLD_W;x++) for(let y=0;y<WORLD_H;y++){
    if(W(x,y)===B.TORCH){
      for(let dx=-8;dx<=8;dx++) for(let dy=-8;dy<=8;dy++){
        const d=Math.sqrt(dx*dx+dy*dy);
        if(d<8){ const nx=x+dx,ny=y+dy; if(nx>=0&&nx<WORLD_W&&ny>=0&&ny<WORLD_H){ lightMap[ny*WORLD_W+nx]=Math.max(lightMap[ny*WORLD_W+nx],1-d/8); } }
      }
    }
  }
}

// ---------- 主循环 ----------
function init(){
  generateWorld(20261027);
  const sx=Math.floor(WORLD_W/2);
  let sy=2; while(sy<WORLD_H-1 && W(sx,sy)===B.AIR) sy++;
  player.x=sx*TS; player.y=(sy-3)*TS;
  initInv();
  time=0; dayTime=0; gameOver=false;
  gold=0; dayCount=1; wasNight=false;
  zombies.length=0; particles.length=0;
  computeLight();
  updateCraftMenu();
  if (!IS_NODE) document.getElementById('deathScreen').style.display='none';
}

let lastT=0;
function loop(t){
  const dt = Math.min(2, (t-lastT)/16.67);
  lastT=t;
  if(!gameOver) update(dt);
  render();
  requestAnimationFrame(loop);
}
function start(){ lastT=0; requestAnimationFrame(loop); }

function update(dt){
  time++;
  dayTime=(dayTime+dt)%DAY_LEN;
  const dayPhase = dayTime/DAY_LEN;
  const isNight = dayPhase>0.5;

  let ax=0;
  if(keys['a']||keys['arrowleft']){ ax=-1; player.facing=-1; }
  if(keys['d']||keys['arrowright']){ ax=1; player.facing=1; }
  const speed=3.2;
  player.vx = ax*speed;
  if((keys[' ']||keys['w']||keys['arrowup']) && player.onGround){ player.vy=-9.5; player.onGround=false; }
  player.vy += GRAV*dt;
  if(player.vy>14) player.vy=14;

  const pcy = Math.floor((player.y+player.h/2)/TS);
  const pcx = Math.floor((player.x+player.w/2)/TS);
  const inWater = W(pcx,pcy)===B.WATER;
  if(inWater){ player.vy*=0.6; player.vx*=0.6; }

  movePlayer(dt);

  camX = player.x + player.w/2 - VW/2;
  camY = player.y + player.h/2 - VH/2;
  camX = Math.max(0, Math.min(WORLD_W*TS-VW, camX));
  camY = Math.max(0, Math.min(WORLD_H*TS-VH, camY));

  if(mouseDown) doMineOrAttack(dt);
  if(rmouseDown) doPlace();

  if(isNight && time%60===0 && zombies.length<12){ spawnZombie(); }
  if(wasNight && !isNight){
    dayCount++;
    for(const z of zombies){ z.burning=true; z.burnT=60; }
  }
  wasNight = isNight;
  for(const z of zombies){
    if(z.burning){
      z.burnT-=dt;
      if(time%3===0) addParticle(z.x+z.w/2,z.y+Math.random()*z.h,'#ff6020',(Math.random()-0.5)*2,-1.5,18);
      if(time%4===0) addParticle(z.x+z.w/2,z.y+Math.random()*z.h,'#ffd040',(Math.random()-0.5)*1.5,-2,14);
      if(z.burnT<=0) z.hp=0;
    }
  }
  updateZombies(dt);

  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=0.2*dt; p.life-=dt;
    if(p.life<=0) particles.splice(i,1);
  }

  if(player.attackCD>0) player.attackCD-=dt;
  if(player.mineCD>0) player.mineCD-=dt;
  if(player.hurtCD>0) player.hurtCD-=dt;

  updateInfo(dayPhase);
  if(craftOpen) updateCraftMenu();

  if(player.hp<=0){
    gameOver=true;
    if (!IS_NODE) { document.getElementById('deathScreen').style.display='flex'; document.getElementById('deathInfo').textContent='存活时间: '+Math.floor(time/60)+'秒'; }
  }
}

function movePlayer(dt){
  let nx = player.x + player.vx*dt;
  if(!collide(nx, player.y, player.w, player.h)) player.x=nx;
  else player.vx=0;
  let ny = player.y + player.vy*dt;
  if(!collide(player.x, ny, player.w, player.h)){ player.y=ny; player.onGround=false; }
  else { if(player.vy>0) player.onGround=true; player.vy=0; }
}
function collide(x,y,w,h){
  const x0=Math.floor(x/TS), x1=Math.floor((x+w-1)/TS);
  const y0=Math.floor(y/TS), y1=Math.floor((y+h-1)/TS);
  for(let ix=x0;ix<=x1;ix++) for(let iy=y0;iy<=y1;iy++) if(isSolid(W(ix,iy))) return true;
  return false;
}

let miningTile={x:-1,y:-1,prog:0};
function doMineOrAttack(dt){
  const wx = mouseSX+camX, wy = mouseSY+camY;
  const gx = Math.floor(wx/TS), gy = Math.floor(wy/TS);
  const px=player.x+player.w/2, py=player.y+player.h/2;
  if(Math.hypot(gx*TS+TS/2-px, gy*TS+TS/2-py) > REACH+TS) return;

  const tool = getSelTool();
  for(const z of zombies){
    if(Math.hypot(z.x+z.w/2-px, z.y+z.h/2-py) < REACH){
      if(player.attackCD<=0){
        const dmg = tool&&tool.type==='sword'?tool.dmg:5;
        z.hp-=dmg; z.hurtCD=10;
        z.vx += (z.x<px?-1:1)*3;
        player.attackCD=20;
        addParticle(z.x+z.w/2,z.y+z.h/2,'#f00',(Math.random()-0.5)*4,-2,15);
        if(z.hp<=0){
          for(let i=0;i<8;i++) addParticle(z.x+z.w/2,z.y+z.h/2,'#5a2a2a',(Math.random()-0.5)*5,(Math.random()-0.5)*5-2,30);
          const reward = 1+Math.floor(Math.random()*3);
          gold += reward;
          for(let i=0;i<reward;i++) addParticle(z.x+z.w/2,z.y+z.h/2,'#ffd700',(Math.random()-0.5)*4,-3-Math.random()*2,40);
          zombies.splice(zombies.indexOf(z),1);
        }
      }
      return;
    }
  }

  const id=W(gx,gy);
  if(id===B.AIR) return;
  const def=BLOCKS[id]; if(!def) return;
  if(player.mineCD>0) return;
  player.mineCD=4;
  if(miningTile.x!==gx||miningTile.y!==gy){ miningTile={x:gx,y:gy,prog:0}; }
  let speed=1;
  if(tool && tool.type==='pick') speed=tool.mineMul||1;
  if(tool && tool.type==='axe' && (id===B.WOOD||id===B.PLANK)) speed=tool.mineMul||1;
  miningTile.prog += speed*dt/def.hard;
  if(time%6===0) addParticle(gx*TS+TS/2,gy*TS+TS/2,blockColor(id,0),(Math.random()-0.5)*2,-1,12);
  if(miningTile.prog>=1){
    const drop=def.drop;
    if(drop) addItem(drop,1);
    setW(gx,gy,B.AIR);
    if(id===B.LEAF && Math.random()<0.1) addItem(B.WOOD,1);
    miningTile={x:-1,y:-1,prog:0};
    computeLight();
  }
}

function doPlace(){
  const it=player.inv[player.sel];
  if(!it||it.n<=0||it.id===0||it.tool) return;
  const wx=mouseSX+camX, wy=mouseSY+camY;
  const gx=Math.floor(wx/TS), gy=Math.floor(wy/TS);
  const px=player.x+player.w/2, py=player.y+player.h/2;
  if(Math.hypot(gx*TS+TS/2-px, gy*TS+TS/2-py) > REACH+TS) return;
  if(W(gx,gy)!==B.AIR) return;
  const bx=gx*TS, by=gy*TS;
  if(bx<player.x+player.w && bx+TS>player.x && by<player.y+player.h && by+TS>player.y && isSolid(it.id)) return;
  if(it.id!==B.TORCH){
    let sup = isSolid(W(gx-1,gy))||isSolid(W(gx+1,gy))||isSolid(W(gx,gy-1))||isSolid(W(gx,gy+1));
    if(!sup) return;
  }
  setW(gx,gy,it.id);
  it.n--;
  if(it.n<=0){ it.id=0; it.n=0; }
  computeLight();
}

function updateZombies(dt){
  const px=player.x+player.w/2;
  for(const z of zombies){
    if(z.hurtCD>0) z.hurtCD-=dt;
    if(z.atkCD>0) z.atkCD-=dt;
    const dx = px-(z.x+z.w/2);
    z.vx = Math.sign(dx)*1.6;
    const fx = Math.floor((z.x+z.w/2+Math.sign(dx)*z.w)/TS);
    const fy = Math.floor((z.y+z.h-2)/TS);
    if(isSolid(W(fx,fy)) && z.vy===0) z.vy=-8;
    z.vy += GRAV*dt; if(z.vy>14) z.vy=14;
    let nx=z.x+z.vx*dt;
    if(!zcollide(nx,z.y,z.w,z.h)) z.x=nx;
    let ny=z.y+z.vy*dt;
    if(!zcollide(z.x,ny,z.w,z.h)) z.y=ny; else z.vy=0;
    if(Math.abs(z.x+z.w/2-px)<z.w && Math.abs(z.y+z.h/2-(player.y+player.h/2))<z.h){
      if(z.atkCD<=0 && player.hurtCD<=0){
        player.hp-=8; player.hurtCD=30; z.atkCD=40;
        player.vx += Math.sign(dx)*4; player.vy=-5;
      }
    }
    if(z.y>WORLD_H*TS) z.hp=0;
  }
  for(let i=zombies.length-1;i>=0;i--) if(zombies[i].hp<=0) zombies.splice(i,1);
}
function zcollide(x,y,w,h){
  const x0=Math.floor(x/TS), x1=Math.floor((x+w-1)/TS);
  const y0=Math.floor(y/TS), y1=Math.floor((y+h-1)/TS);
  for(let ix=x0;ix<=x1;ix++) for(let iy=y0;iy<=y1;iy++) if(isSolid(W(ix,iy))) return true;
  return false;
}

// ---------- 渲染 ----------
function blockColor(id,shade){
  const c = {
    [B.GRASS]:'#4a9b3a',[B.DIRT]:'#8b5a2b',[B.STONE]:'#7a7a7a',[B.WOOD]:'#6b4a2a',
    [B.LEAF]:'#3a7a2a',[B.SAND]:'#e0d090',[B.COAL]:'#3a3a3a',[B.IRON]:'#c8a878',
    [B.GOLD]:'#e8c830',[B.DIAM]:'#5af0e0',[B.PLANK]:'#b88a4a',[B.BENCH]:'#a06a3a',
    [B.TORCH]:'#ffaa30',[B.DOOR]:'#8b5a2b',[B.WATER]:'#3a6ae0',[B.SBRICK]:'#d8c880',
    [B.GLASS]:'#aaccdd',[B.SNOW]:'#f0f0f0',[B.ICE]:'#a0d0f0',[B.BRICK]:'#a04040',[B.OBSID]:'#1a0a2a',
  };
  let base=c[id]||'#000';
  if(shade){
    const m = base.match(/#(..)(..)(..)/);
    if(m){
      let r=parseInt(m[1],16),g=parseInt(m[2],16),b=parseInt(m[3],16);
      r=Math.max(0,Math.min(255,r*shade)); g=Math.max(0,Math.min(255,g*shade)); b=Math.max(0,Math.min(255,b*shade));
      return `rgb(${r|0},${g|0},${b|0})`;
    }
  }
  return base;
}

function render(){
  const dayPhase=dayTime/DAY_LEN;
  const sunHeight = Math.cos(dayPhase*Math.PI*2);
  let skyTop, skyBot;
  if(sunHeight>0){
    const t=sunHeight;
    skyTop=lerpColor([10,10,40],[100,170,230],t);
    skyBot=lerpColor([30,30,60],[170,220,240],t);
  } else {
    const t=-sunHeight;
    skyTop=lerpColor([10,10,40],[5,5,20],t);
    skyBot=lerpColor([30,30,60],[10,10,30],t);
  }
  const grad=ctx.createLinearGradient(0,0,0,VH);
  grad.addColorStop(0,`rgb(${skyTop[0]},${skyTop[1]},${skyTop[2]})`);
  grad.addColorStop(1,`rgb(${skyBot[0]},${skyBot[1]},${skyBot[2]})`);
  ctx.fillStyle=grad; ctx.fillRect(0,0,VW,VH);

  const sunX = VW*(dayPhase*2);
  const sx = (sunX%VW);
  const sy = VH*0.3 - Math.sin(dayPhase*Math.PI*2)*VH*0.25;
  if(sunHeight>-0.1){
    ctx.fillStyle='#fff8c0'; ctx.beginPath(); ctx.arc(sx,sy,28,0,Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle='#e0e0e0'; ctx.beginPath(); ctx.arc(sx,sy,22,0,Math.PI*2); ctx.fill();
  }
  if(sunHeight<0){
    ctx.fillStyle=`rgba(255,255,255,${-sunHeight*0.8})`;
    for(let i=0;i<60;i++){
      const stx=(i*97.13)%VW, sty=(i*53.7)%(VH*0.6);
      ctx.fillRect(stx,sty,2,2);
    }
  }

  ctx.fillStyle=`rgba(${Math.floor(skyBot[0]*0.7)},${Math.floor(skyBot[1]*0.7)},${Math.floor(skyBot[2]*0.7)},0.6)`;
  ctx.beginPath(); ctx.moveTo(0,VH);
  for(let x=0;x<=VW;x+=40){ const wx=(x+camX*0.3); const y=VH*0.55+Math.sin(wx*0.01)*30+Math.sin(wx*0.005)*50; ctx.lineTo(x,y); }
  ctx.lineTo(VW,VH); ctx.fill();

  const x0=Math.max(0,Math.floor(camX/TS)), x1=Math.min(WORLD_W-1,Math.floor((camX+VW)/TS));
  const y0=Math.max(0,Math.floor(camY/TS)), y1=Math.min(WORLD_H-1,Math.floor((camY+VH)/TS));
  const ambient = sunHeight>0 ? Math.max(0.25,sunHeight) : 0.12;
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++){
    const id=W(x,y);
    if(id===B.AIR) continue;
    const sx=x*TS-camX, sy=y*TS-camY;
    if(id===B.WATER){
      ctx.fillStyle='rgba(58,106,224,0.55)'; ctx.fillRect(sx,sy,TS,TS);
      continue;
    }
    let col=blockColor(id);
    let l=lightMap[y*WORLD_W+x];
    const finalL = Math.max(ambient, l);
    col=applyShade(col, finalL);
    ctx.fillStyle=col;
    ctx.fillRect(sx,sy,TS,TS);
    drawBlockDetail(id,sx,sy);
    if(miningTile.x===x && miningTile.y===y && miningTile.prog>0){
      ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.lineWidth=1;
      const p=miningTile.prog;
      if(p>0.25){ ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+TS,sy+TS); ctx.stroke(); }
      if(p>0.5){ ctx.beginPath(); ctx.moveTo(sx+TS,sy); ctx.lineTo(sx,sy+TS); ctx.stroke(); }
      if(p>0.75){ ctx.beginPath(); ctx.moveTo(sx,sy+TS/2); ctx.lineTo(sx+TS,sy+TS/2); ctx.stroke(); }
    }
  }

  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++){
    if(W(x,y)===B.TORCH){
      const sx=x*TS-camX, sy=y*TS-camY;
      ctx.fillStyle='#ffcc40'; ctx.fillRect(sx+TS/2-2,sy+2,4,TS-4);
      ctx.fillStyle='#ff6020'; ctx.fillRect(sx+TS/2-3,sy+1,6,5);
      const flick=Math.sin(time*0.3+x)*2;
      ctx.fillStyle='rgba(255,200,80,0.5)'; ctx.beginPath(); ctx.arc(sx+TS/2+flick,sy,8,0,Math.PI*2); ctx.fill();
    }
  }

  drawPlayer();
  for(const z of zombies) drawZombie(z);

  for(const p of particles){
    ctx.globalAlpha=Math.max(0,p.life/p.maxLife);
    ctx.fillStyle=p.color;
    ctx.fillRect(p.x-camX-2,p.y-camY-2,4,4);
  }
  ctx.globalAlpha=1;

  const wx=mouseSX+camX, wy=mouseSY+camY;
  const gx=Math.floor(wx/TS), gy=Math.floor(wy/TS);
  const px=player.x+player.w/2, py=player.y+player.h/2;
  if(Math.hypot(gx*TS+TS/2-px, gy*TS+TS/2-py) <= REACH+TS){
    ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=2;
    ctx.strokeRect(gx*TS-camX,gy*TS-camY,TS,TS);
  }

  drawHotbar();
  if(sunHeight<0){
    ctx.fillStyle=`rgba(0,0,20,${Math.min(0.35,-sunHeight*0.4)})`;
    ctx.fillRect(0,0,VW,VH);
  }
  if(player.hurtCD>0){
    ctx.fillStyle=`rgba(180,0,0,${player.hurtCD/30*0.3})`;
    ctx.fillRect(0,0,VW,VH);
  }
}

function drawBlockDetail(id,sx,sy){
  ctx.fillStyle='rgba(0,0,0,0.12)';
  if(id===B.GRASS){ ctx.fillRect(sx,sy,TS,3); }
  else if(id===B.STONE||id===B.COAL||id===B.IRON||id===B.GOLD||id===B.DIAM||id===B.OBSID){
    ctx.fillRect(sx+2,sy+3,3,2); ctx.fillRect(sx+10,sy+8,4,3); ctx.fillRect(sx+5,sy+13,3,2);
  }
  if(id===B.COAL){ ctx.fillStyle='#000'; ctx.fillRect(sx+5,sy+6,4,4); ctx.fillRect(sx+11,sy+10,3,3); }
  if(id===B.IRON){ ctx.fillStyle='#a08050'; ctx.fillRect(sx+5,sy+6,4,3); ctx.fillRect(sx+11,sy+11,3,2); }
  if(id===B.GOLD){ ctx.fillStyle='#fff080'; ctx.fillRect(sx+5,sy+6,4,3); ctx.fillRect(sx+11,sy+11,3,2); }
  if(id===B.DIAM){ ctx.fillStyle='#a0ffff'; ctx.fillRect(sx+6,sy+7,3,3); ctx.fillRect(sx+11,sy+12,2,2); }
  if(id===B.WOOD){ ctx.fillStyle='rgba(0,0,0,0.2)'; ctx.fillRect(sx+4,sy,2,TS); ctx.fillRect(sx+13,sy,2,TS); }
  if(id===B.PLANK){ ctx.fillStyle='rgba(0,0,0,0.2)'; ctx.fillRect(sx,sy+6,TS,1); ctx.fillRect(sx,sy+13,TS,1); }
  if(id===B.BENCH){ ctx.fillStyle='#6b4a2a'; ctx.fillRect(sx+2,sy+4,TS-4,2); ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(sx,sy+TS-3,TS,3); }
  if(id===B.LEAF){ ctx.fillStyle='rgba(0,40,0,0.3)'; ctx.fillRect(sx+3,sy+3,3,3); ctx.fillRect(sx+12,sy+8,3,3); }
  if(id===B.BRICK){ ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(sx,sy+TS/2,TS,1); ctx.fillRect(sx+TS/2,sy,1,TS/2); ctx.fillRect(sx+TS/2,sy+TS/2,1,TS/2); }
  if(id===B.GLASS){ ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.fillRect(sx+2,sy+2,4,8); }
}

function drawPlayer(){
  const sx=player.x-camX, sy=player.y-camY;
  ctx.fillStyle='#d8a878'; ctx.fillRect(sx,sy+player.h*0.3,player.w,player.h*0.4);
  ctx.fillStyle='#e8b888'; ctx.fillRect(sx+player.w*0.1,sy,player.w*0.8,player.h*0.3);
  ctx.fillStyle='#5a3a1a'; ctx.fillRect(sx+player.w*0.1,sy,player.w*0.8,player.h*0.1);
  ctx.fillStyle='#3a4a8a'; ctx.fillRect(sx,sy+player.h*0.7,player.w*0.45,player.h*0.3);
  ctx.fillRect(sx+player.w*0.55,sy+player.h*0.7,player.w*0.45,player.h*0.3);
  ctx.fillStyle='#000';
  if(player.facing>0) ctx.fillRect(sx+player.w*0.55,sy+player.h*0.15,3,3);
  else ctx.fillRect(sx+player.w*0.25,sy+player.h*0.15,3,3);
  const tool=getSelTool();
  if(tool){
    ctx.fillStyle = tool.tier===1?'#b88a4a':tool.tier===2?'#7a7a7a':tool.tier===3?'#c8c8c8':'#fff';
    const hx = player.facing>0?sx+player.w:sx-8;
    ctx.fillRect(hx,sy+player.h*0.35,8,14);
    ctx.fillStyle='#6b4a2a'; ctx.fillRect(hx-1,sy+player.h*0.45,10,4);
  }
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(sx-2,sy-8,player.w+4,5);
  ctx.fillStyle='#f00'; ctx.fillRect(sx-1,sy-7,(player.w+2)*(player.hp/player.maxHp),3);
}

function drawZombie(z){
  const sx=z.x-camX, sy=z.y-camY;
  ctx.fillStyle='#3a5a3a'; ctx.fillRect(sx,sy+ z.h*0.3,z.w,z.h*0.4);
  ctx.fillStyle='#4a6a4a'; ctx.fillRect(sx+z.w*0.1,sy,z.w*0.8,z.h*0.3);
  ctx.fillStyle='#2a3a2a'; ctx.fillRect(sx,sy+z.h*0.7,z.w*0.45,z.h*0.3);
  ctx.fillRect(sx+z.w*0.55,sy+z.h*0.7,z.w*0.45,z.h*0.3);
  ctx.fillStyle='#f00'; ctx.fillRect(sx+z.w*0.25,sy+z.h*0.15,3,3); ctx.fillRect(sx+z.w*0.6,sy+z.h*0.15,3,3);
  if(z.hurtCD>0){ ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillRect(sx,sy,z.w,z.h); }
  if(z.burning){
    ctx.fillStyle='rgba(255,80,0,0.4)'; ctx.fillRect(sx,sy,z.w,z.h);
    ctx.fillStyle='#ffcc00';
    const f=Math.sin(time*0.5)*2;
    ctx.fillRect(sx+z.w*0.2,sy-6+f,4,6); ctx.fillRect(sx+z.w*0.5,sy-8-f,4,8); ctx.fillRect(sx+z.w*0.7,sy-5+f,4,5);
  }
  if(z.hp<z.maxHp){ ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(sx-1,sy-6,z.w+2,4); ctx.fillStyle='#f00'; ctx.fillRect(sx,sy-5,z.w*(z.hp/z.maxHp),2); }
}

function drawHotbar(){
  const slot=44, gap=4;
  const total=10*slot+9*gap;
  const ox=(VW-total)/2, oy=VH-slot-10;
  for(let i=0;i<10;i++){
    const x=ox+i*(slot+gap);
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x,oy,slot,slot);
    ctx.strokeStyle=i===player.sel?'#fff':'#888'; ctx.lineWidth=i===player.sel?3:1;
    ctx.strokeRect(x,oy,slot,slot);
    const it=player.inv[i];
    if(it&&it.id!==0){
      if(it.tool){
        const t=TOOLS[it.id.slice(5)];
        ctx.fillStyle = t.tier===1?'#b88a4a':t.tier===2?'#7a7a7a':t.tier===3?'#c8c8c8':'#fff';
        ctx.fillRect(x+slot/2-4,oy+8,8,18);
        ctx.fillStyle='#6b4a2a'; ctx.fillRect(x+slot/2-6,oy+12,12,5);
      } else {
        ctx.fillStyle=blockColor(it.id);
        ctx.fillRect(x+8,oy+8,slot-16,slot-16);
        drawBlockDetail(it.id,x+8,oy+8);
      }
      ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.textAlign='right';
      ctx.fillText(it.n, x+slot-3, oy+slot-3);
      ctx.textAlign='left';
    }
  }
  const it=player.inv[player.sel];
  if(it&&it.id!==0){
    const name = it.tool?TOOLS[it.id.slice(5)].name:bname(it.id);
    ctx.fillStyle='#fff'; ctx.font='14px sans-serif'; ctx.textAlign='center';
    ctx.fillText(name, VW/2, oy-6);
    ctx.textAlign='left';
  }
}

// ---------- UI ----------
function updateInfo(dayPhase){
  if (IS_NODE) return;
  const isNight=dayPhase>0.5;
  const tot=Math.floor(time/60);
  const h=Math.floor(tot/60), m=tot%60;
  const tStr = isNight ? `夜晚 ${Math.floor((dayPhase-0.5)*200)}%` : `白天 ${Math.floor(dayPhase*200)}%`;
  document.getElementById('info').innerHTML =
    `第 ${dayCount} 天<br>HP: ${Math.max(0,player.hp|0)}/${player.maxHp}<br>💰 金币: ${gold}<br>${tStr}<br>僵尸: ${zombies.length}<br>时间: ${h}m ${m}s<br>模式: ${player.mode==='mine'?'挖掘':'战斗'}<br>${nearBench()?'[近工作台]':''}`;
}
function updateCraftMenu(){
  if (IS_NODE) return;
  const list=document.getElementById('recipeList');
  const cm=document.getElementById('craftMenu');
  cm.style.display=craftOpen?'block':'none';
  if(!craftOpen) return;
  let html='';
  for(const r of RECIPES){
    const ok=canCraft(r);
    const outName = r.out.tool?TOOLS[r.out.id].name:bname(r.out.id);
    const costStr = r.need.map(([id,n])=>`${bname(id)}x${n}`).join(', ');
    html+=`<div class="recipe" ${ok?`onclick="craftAndRefresh(${RECIPES.indexOf(r)})"`:'style="opacity:0.4;cursor:not-allowed"'}>`+
      `<span class="name">${outName} x${r.out.n}${r.bench?' 🛠':''}</span>`+
      `<span class="cost">${costStr}</span></div>`;
  }
  list.innerHTML=html;
}
if (!IS_NODE) {
  window.craftAndRefresh=function(i){ craft(RECIPES[i]); updateCraftMenu(); };
  window.restartGame=function(){ init(); };
}

// ---------- 工具函数 ----------
function lerpColor(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
function applyShade(hex,shade){
  const m=hex.match(/#(..)(..)(..)/);
  if(!m) return hex;
  let r=parseInt(m[1],16),g=parseInt(m[2],16),b=parseInt(m[3],16);
  r=Math.max(0,Math.min(255,r*shade)); g=Math.max(0,Math.min(255,g*shade)); b=Math.max(0,Math.min(255,b*shade));
  return `rgb(${r|0},${g|0},${b|0})`;
}

// ---------- 导出 (供 Node 测试) / 浏览器自动启动 ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IS_NODE, TS, WORLD_W, WORLD_H, DAY_LEN, GRAV, REACH,
    B, BLOCKS, TOOLS, RECIPES,
    init, update, render, loop, start,
    generateWorld, computeLight, spawnZombie, craft, canCraft, nearBench,
    addItem, removeItem, countItem, getSelTool, addTool, bname, isSolid, isLiquid,
    W, setW, movePlayer, collide, doMineOrAttack, doPlace, updateZombies,
    player, zombies, particles, keys,
    get time(){return time;}, set time(v){time=v;},
    get dayTime(){return dayTime;}, set dayTime(v){dayTime=v;},
    get gold(){return gold;}, set gold(v){gold=v;},
    get dayCount(){return dayCount;}, set dayCount(v){dayCount=v;},
    get gameOver(){return gameOver;}, set gameOver(v){gameOver=v;},
    get wasNight(){return wasNight;}, set wasNight(v){wasNight=v;},
    get camX(){return camX;}, get camY(){return camY;}, get VW(){return VW;}, get VH(){return VH;},
    get mouseDown(){return mouseDown;}, set mouseDown(v){mouseDown=v;},
    get rmouseDown(){return rmouseDown;}, set rmouseDown(v){rmouseDown=v;},
    get mouseSX(){return mouseSX;}, set mouseSX(v){mouseSX=v;},
    get mouseSY(){return mouseSY;}, set mouseSY(v){mouseSY=v;},
    get craftOpen(){return craftOpen;}, set craftOpen(v){craftOpen=v;},
    get miningTile(){return miningTile;},
  };
}

if (!IS_NODE) { init(); start(); }
