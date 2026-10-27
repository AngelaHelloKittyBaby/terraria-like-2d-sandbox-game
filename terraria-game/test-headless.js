"use strict";
// ============================================================
//  无头冒烟测试: 模拟 600 秒游戏逻辑, 验证核心系统稳定性
//  运行: node terraria-game/test-headless.js
// ============================================================
const G = require('./game.js');
const fs = require('fs');
const lines = [];
function log(s){ console.log(s); lines.push(s); }
process.on('uncaughtException', (e) => {
  log('\n[异常] ' + e.message + '\n' + (e.stack||''));
  log('\n========================================');
  log('  通过: ' + pass + '  失败: ' + (fail+1) + ' (异常退出)');
  log('========================================');
  fs.writeFileSync('terraria-game/test-result.txt', lines.join('\n'), 'utf8');
  process.exit(1);
});

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; log('  ✓ ' + msg); }
  else { fail++; log('  ✗ ' + msg); }
}
function section(name) { log('\n[' + name + ']'); }

// ---------- 1. 初始化 ----------
section('初始化世界');
G.init();
assert(G.player.hp === 100, '玩家初始 HP=100');
assert(G.player.inv.length === 10, '物品栏 10 格');
assert(G.gold === 0, '初始金币=0');
assert(G.dayCount === 1, '初始天数=1');
assert(G.gameOver === false, '游戏未结束');
assert(G.VW > 0 && G.VH > 0, '视口尺寸已设置 (' + G.VW + 'x' + G.VH + ')');

// ---------- 2. 世界生成 ----------
section('世界生成');
let solidCount = 0, airCount = 0, oreCount = 0, treeCount = 0;
for (let x = 0; x < G.WORLD_W; x++) {
  for (let y = 0; y < G.WORLD_H; y++) {
    const id = G.W(x, y);
    if (id === G.B.AIR) airCount++;
    else { solidCount++; if (id >= G.B.COAL && id <= G.B.OBSID) oreCount++; if (id === G.B.WOOD) treeCount++; }
  }
}
assert(solidCount > 0, '世界含固体方块 (' + solidCount + ')');
assert(airCount > 0, '世界含空气 (' + airCount + ')');
assert(oreCount > 0, '世界含矿物 (' + oreCount + ')');
assert(treeCount > 0, '世界含树木/木头 (' + treeCount + ')');

// 地表起伏: 不同 x 列的表面高度应有差异
const surfaces = [];
for (let x = 0; x < G.WORLD_W; x += 4) {
  for (let y = 0; y < G.WORLD_H; y++) {
    if (G.W(x, y) !== G.B.AIR) { surfaces.push(y); break; }
  }
}
const sMin = Math.min(...surfaces), sMax = Math.max(...surfaces);
assert(sMax - sMin > 3, '地表有高低起伏 (Δ=' + (sMax - sMin) + ')');

// ---------- 3. 昼夜推进 ----------
section('昼夜推进');
const startDayTime = G.dayTime;
// 模拟 600 秒 = 600*60 帧 (dt=1)
const TOTAL_SECONDS = 600;
const FRAMES = TOTAL_SECONDS * 60;
let nightSpawned = false, dayRolled = false;
const dayCountStart = G.dayCount;
let maxZombies = 0, goldEarned = false;

for (let i = 0; i < FRAMES; i++) {
  G.update(1);
  if (G.zombies.length > 0) { nightSpawned = true; maxZombies = Math.max(maxZombies, G.zombies.length); }
  if (G.dayCount > dayCountStart) dayRolled = true;
  if (G.gold > 0) goldEarned = true;
  // 玩家死亡则停止
  if (G.gameOver) break;
}

assert(G.time > 0, '游戏时间推进 (time=' + G.time + ')');
assert(G.dayTime !== startDayTime || G.dayCount > dayCountStart, 'dayTime/天数发生变化');
assert(dayRolled, '至少经历了一次天亮 (天数=' + G.dayCount + ')');
assert(nightSpawned, '夜晚生成了僵尸 (峰值=' + maxZombies + ')');

// ---------- 4. 玩家存活 ----------
section('玩家状态');
assert(G.player.hp > 0 || G.gameOver, '玩家 HP 状态有效 (hp=' + Math.max(0, G.player.hp) + ', gameOver=' + G.gameOver + ')');
assert(G.player.x > 0 && G.player.y > 0, '玩家有坐标 (' + G.player.x.toFixed(0) + ',' + G.player.y.toFixed(0) + ')');
assert(!Number.isNaN(G.player.x) && !Number.isNaN(G.player.y), '玩家坐标非 NaN');

// ---------- 5. 合成系统 ----------
section('合成系统');
// 重新 init 给足资源测试合成
G.init();
// 给足资源
G.addItem(G.B.WOOD, 50);
G.addItem(G.B.STONE, 50);
G.addItem(G.B.COAL, 20);
// 合成木板 (无需工作台)
const plankRecipe = G.RECIPES.find(r => r.out.id === G.B.PLANK);
const woodBefore = G.countItem(G.B.WOOD);
G.craft(plankRecipe);
assert(G.countItem(G.B.PLANK) >= 4, '合成木板成功 (木板x' + G.countItem(G.B.PLANK) + ')');
assert(G.countItem(G.B.WOOD) < woodBefore, '消耗木头');

// 合成工作台
const benchRecipe = G.RECIPES.find(r => r.out.id === G.B.BENCH);
G.craft(benchRecipe);
assert(G.countItem(G.B.BENCH) >= 1, '合成工作台成功');

// 在玩家旁放置工作台以测试近工作台合成
const px = Math.floor((G.player.x + G.player.w / 2) / G.TS);
const py = Math.floor((G.player.y + G.player.h / 2) / G.TS);
G.setW(px + 2, py, G.B.BENCH);
assert(G.nearBench(), '检测到附近工作台');
// 石镐需要工作台
const stonePickRecipe = G.RECIPES.find(r => r.out.id === 'stone_pick');
assert(G.canCraft(stonePickRecipe), '近工作台可合成石镐');
G.craft(stonePickRecipe);
assert(G.player.inv.some(it => it.tool && it.id === 'tool:stone_pick'), '石镐已加入物品栏');

// 远离工作台则不可合成
G.setW(px + 2, py, G.B.AIR);
assert(!G.nearBench(), '移走工作台后不再近工作台');
const ironPickRecipe = G.RECIPES.find(r => r.out.id === 'iron_pick');
assert(!G.canCraft(ironPickRecipe) || G.countItem(G.B.IRON) < 3, '无工作台时铁镐不可合成或材料不足');

// ---------- 6. 挖掘与放置 ----------
section('挖掘与放置');
G.init();
// 在玩家面前放一个土块
const tx = Math.floor((G.player.x + G.player.w / 2) / G.TS) + 1;
const ty = Math.floor((G.player.y + G.player.h / 2) / G.TS);
G.setW(tx, ty, G.B.DIRT);
// 模拟鼠标指向该方块并挖掘
G.mouseSX = tx * G.TS + G.TS / 2 - G.camX;
G.mouseSY = ty * G.TS + G.TS / 2 - G.camY;
G.mouseDown = true;
const dirtBefore = G.countItem(G.B.DIRT);
for (let i = 0; i < 60; i++) G.update(1);
G.mouseDown = false;
assert(G.W(tx, ty) === G.B.AIR || G.countItem(G.B.DIRT) > dirtBefore, '挖掘土块生效 (该格=' + G.bname(G.W(tx, ty)) + ')');

// 放置方块: 选中泥土, 鼠标右键指向空气格
G.player.sel = 0;
G.player.inv[0] = { id: G.B.DIRT, n: 10 };
const px2 = Math.floor((G.player.x + G.player.w / 2) / G.TS);
const py2 = Math.floor((G.player.y + G.player.h / 2) / G.TS);
const placeX = px2 + 1, placeY = py2;
G.setW(placeX, placeY, G.B.AIR);
G.setW(placeX, placeY + 1, G.B.STONE); // 提供支撑
G.mouseSX = placeX * G.TS + G.TS / 2 - G.camX;
G.mouseSY = placeY * G.TS + G.TS / 2 - G.camY;
G.rmouseDown = true;
for (let i = 0; i < 5; i++) G.update(1);
G.rmouseDown = false;
assert(G.W(placeX, placeY) === G.B.DIRT, '放置土块成功');

// ---------- 7. 火把光照 ----------
section('火把光照');
G.init();
const lx = Math.floor(G.player.x / G.TS), ly = Math.floor(G.player.y / G.TS);
G.setW(lx + 1, ly, G.B.TORCH);
G.computeLight();
const torchLight = G.lightMap ? null : null; // lightMap 不导出, 用 W 验证火把存在
assert(G.W(lx + 1, ly) === G.B.TORCH, '火把已放置');

// ---------- 8. 僵尸与金币 ----------
section('僵尸与金币');
G.init();
// 强制进入夜晚并生成僵尸
G.dayTime = G.DAY_LEN * 0.6; // 夜晚
for (let i = 0; i < 200 && G.zombies.length === 0; i++) G.update(1);
assert(G.zombies.length > 0, '夜晚生成僵尸 (x' + G.zombies.length + ')');
// 用剑击杀: 给玩家一把石剑并选中
G.addTool('stone_sword', 1);
const swordSlot = G.player.inv.findIndex(it => it.tool && it.id === 'tool:stone_sword');
G.player.sel = swordSlot;
// 把僵尸移到玩家附近以便攻击
if (G.zombies.length > 0) {
  G.zombies[0].x = G.player.x + G.player.w;
  G.zombies[0].y = G.player.y;
  G.mouseSX = G.zombies[0].x + G.zombies[0].w / 2 - G.camX;
  G.mouseSY = G.zombies[0].y + G.zombies[0].h / 2 - G.camY;
  G.mouseDown = true;
  const goldBefore = G.gold;
  for (let i = 0; i < 200 && G.zombies.length > 0; i++) G.update(1);
  G.mouseDown = false;
  assert(G.gold > goldBefore, '击杀僵尸获得金币 (+' + (G.gold - goldBefore) + ', 总=' + G.gold + ')');
}

// ---------- 9. 天亮自燃 ----------
section('天亮自燃');
G.init();
G.dayTime = G.DAY_LEN * 0.6;
for (let i = 0; i < 200 && G.zombies.length === 0; i++) G.update(1);
const zCount = G.zombies.length;
assert(zCount > 0, '夜晚有僵尸 (x' + zCount + ')');
// 推进到天亮
const dayBefore = G.dayCount;
for (let i = 0; i < G.DAY_LEN && G.dayCount === dayBefore; i++) G.update(1);
assert(G.dayCount > dayBefore, '天亮后天数+1 (天数=' + G.dayCount + ')');
// 僵尸应自燃消失 (burnT=60 帧后)
for (let i = 0; i < 100 && G.zombies.length > 0; i++) G.update(1);
assert(G.zombies.length === 0, '天亮后僵尸自燃消失');

// ---------- 10. 长时间稳定性 ----------
section('长时间稳定性 (再跑 300 秒)');
let crashed = false;
try {
  for (let i = 0; i < 300 * 60; i++) {
    G.update(1);
    if (G.gameOver) { G.init(); } // 死了就重生继续
  }
} catch (e) { crashed = true; console.error('  异常: ' + e.message); }
assert(!crashed, '300 秒无异常');
assert(!Number.isNaN(G.player.x) && !Number.isNaN(G.player.hp), '玩家状态未 NaN');

// ---------- 汇总 ----------
log('\n========================================');
log('  通过: ' + pass + '  失败: ' + fail);
log('========================================');
fs.writeFileSync('terraria-game/test-result.txt', lines.join('\n'), 'utf8');
process.exit(fail > 0 ? 1 : 0);
