// 民生与时代:粮多的地方人多;技术跟不上的州发展慢;工业时代以后城更大,挨着的荒漠、苔原、冰原有人去占
// 每 5 年出手一次;技术积累怎么涨写在 plugin.json 的表里(公式由网站算)。
// 发展度每 20 年才算一步,影响口跟着每 20 年交一次;拓荒每 25 年一回

/** 时代 = 生产、运输、信息、行政四样发展度的加权调和平均(偏向短板),整数部分是第几个时代;和网站定时代的算法一样 */
const ERA_WEIGHT = [0.35, 0.2, 0.25, 0.2];
/** 第几个时代是「工业」:石器 0、青铜 1、铁器 2、中古 3、火药 4、工业 5、电气 6、信息 7、未来 8 */
const INDUSTRY = 5;
/**
 * 各个时代该有多少技术(按时代的整数部分取;技术表怎么涨见 plugin.json)。
 * 照不装插件时各时代头一批州到这一档时大约攒到的数定的;电气以后推 6000 年也没有州到,往后每档加 10
 */
const TECH_NEED = [0, 1, 2, 4, 7, 20, 30, 40, 50];
/** 荒地:冰原、苔原、寒漠、温带荒漠、热带荒漠(主导地貌的编号,和地图的群落编号同一套) */
const WASTE = [3, 4, 6, 7, 11];
/** 拓荒一回最多划几州 */
const FRONTIER_MAX = 6;
/** turn.rand 的事号 */
const ROLL_FRONTIER = 1;

/** 各州此刻的时代数值 */
function eras(read) {
  const p = read.official('dev.production');
  const t = read.official('dev.transport');
  const i = read.official('dev.information');
  const a = read.official('dev.administration');
  const out = new Float64Array(p.length);
  for (let r = 0; r < p.length; r++) {
    const s = ERA_WEIGHT[0] / (p[r] + 1) + ERA_WEIGHT[1] / (t[r] + 1) + ERA_WEIGHT[2] / (i[r] + 1) + ERA_WEIGHT[3] / (a[r] + 1);
    out[r] = 1 / s - 1;
  }
  return out;
}

/** 粮养人、后世大城、技术门槛:交给三个影响口 */
function influences(turn, era) {
  const { grain, metro, tech } = civAtlas.params;
  const read = turn.read;
  const g = read.official('res.grain');
  const l = read.official('res.livestock');
  const f = read.official('res.fish');
  const have = turn.table('tech');
  const city = turn.influence('city.capacity');
  const rural = turn.influence('rural.capacity');
  const rate = turn.influence('dev.rate');
  const cols = rate.length / city.length;
  for (let r = 0; r < city.length; r++) {
    // 食 = 粮 + 牲畜 / 2 + 渔获 / 2(各 0–3 档):食 2 是原样,食 0 剩六成,食 6 是 1.8 倍(滑条 1)
    const food = g[r] + l[r] / 2 + f[r] / 2;
    const fed = Math.pow(0.6 + 0.2 * food, grain);
    // 工业时代算高一档,往后每个时代再高一档
    const above = Math.max(0, Math.floor(era[r]) - INDUSTRY + 1);
    // 两样都乘在城的上限上:先乘好再交,网站最后压到 4 倍以内
    city[r] = fed * Math.pow(1 + 0.5 * metro, above);
    rural[r] = fed;
    const need = TECH_NEED[Math.max(0, Math.min(TECH_NEED.length - 1, Math.floor(era[r])))];
    const slow = have[r] < need ? 1 - 0.25 * tech : 1;
    for (let c = 0; c < cols; c++) rate[r * cols + c] = slow;
  }
  return { 'city.capacity': city, 'rural.capacity': rural, 'dev.rate': rate };
}

/** 近现代拓荒:国都到了工业时代的国,挨着的没有主、有人住的荒地,每州掷一次 */
function frontier(turn, era) {
  const odds = 0.2 * civAtlas.params.frontier;
  if (odds <= 0) return [];
  const read = turn.read;
  const ps = read.polities();
  const towns = read.settlements();
  const owner = read.owners('polity');
  const folk = read.owners('culture');
  const { biome, neighbors } = read.regions();
  const { start, list } = neighbors;
  const ready = new Uint8Array(ps.length);
  let any = false;
  for (const p of ps) {
    if (p.ended !== undefined || p.size <= 0 || p.capital < 0) continue;
    if (era[towns[p.capital].region] < INDUSTRY) continue;
    ready[p.id] = 1;
    any = true;
  }
  if (!any) return [];
  const rural = read.official('rural');
  const year = Math.round(turn.year);
  const picks = [];
  for (let r = 0; r < owner.length; r++) {
    // 没人住的荒地占不了(网站划州要州里有人)
    if (owner[r] >= 0 || folk[r] < 0 || !WASTE.includes(biome[r])) continue;
    // 挨着几个工业国的,归国力最强的(一样强取编号小的)
    let a = -1;
    for (let e = start[r]; e < start[r + 1]; e++) {
      const q = owner[list[e]];
      if (q >= 0 && ready[q] && (a < 0 || ps[q].power > ps[a].power || (ps[q].power === ps[a].power && q < a))) a = q;
    }
    if (a >= 0 && turn.rand(ROLL_FRONTIER, year, r) < odds) picks.push({ r, a, people: rural[r] });
  }
  // 人多的先占,一样多取编号小的
  picks.sort((x, y) => y.people - x.people || x.r - y.r);
  return picks.slice(0, FRONTIER_MAX).map(({ r, a }) => ({ kind: 'cede', a, region: r }));
}

civAtlas.sim({
  act(turn) {
    const year = Math.round(turn.year);
    const devStep = year % 20 === 0;
    const frontierStep = year > 0 && year % 25 === 0;
    if (!devStep && !frontierStep) return;
    const era = eras(turn.read);
    const reply = {};
    if (devStep) reply.influences = influences(turn, era);
    if (frontierStep) {
      const commands = frontier(turn, era);
      if (commands.length) reply.commands = commands;
    }
    return reply;
  },
});
