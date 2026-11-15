// 国力与疆域:国用不足伤国、管不住的地方调不来兵、难走的地和早年管不远、飞地划给邻国、游牧国家的国都随王帐走
// 每 5 年出手一次交影响口;每 30 年整一次飞地;王帐随行靠自己约的事,隔 round(40 / 滑条) 年一次

const S = civAtlas.params;

const REALM = {
  /** 每几年出手一次(和清单的 sim.every 一样) */
  every: 5,
  /** 亏空伤国:国用不足到这么多算亏;亏满 start 年起按 min(年数 / full, 1) 加重 */
  broke: 0.5,
  start: 20,
  full: 50,
  /** 亏到头、滑条 1 时:各州动荡加几、国力打几折、分裂几率加几成 */
  unrest: 0.05,
  power: 0.2,
  split: 0.5,
  /** 管辖难易:难走的地全占满、滑条 1 时,管得到的远近打几折 */
  terrain: 0.3,
  /** 早期扩张难:还在石器时代开头、滑条 1 时,宣战几率、管得到的远近各打几折 */
  earlyWar: 0.4,
  earlyReach: 0.3,
  /** 飞地整形:多少年整一次、几州以内算小片、挨着几州别国算死胡同、每片划出去的几成、一回最多几条 */
  tidyEvery: 30,
  tidySmall: 3,
  tidyDeadEnd: 3,
  tidyOdds: 0.3,
  tidyMost: 8,
  /** 王帐随行:滑条 1 时隔几年迁一次、一回最多几国 */
  nomadYears: 40,
  nomadMost: 8,
};

/** 难走的地貌:冰原、苔原、三种荒漠、热带雨林、湿地(和地图的地貌编号同一套) */
const HARD = new Set([3, 4, 6, 7, 11, 14, 15]);
/** 时代数值:生产、运输、信息、行政四样能力加 1 后的加权调和平均再减 1;整数部分 0 是石器、1 青铜、2 铁器 */
const ERA_WEIGHT = [0.35, 0.2, 0.25, 0.2];
const IRON = 2;
/** 约事的种类、随机数的事号 */
const NOMAD = 1;
const ROLL_PIECE = 1;
const ROLL_DEAD_END = 2;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** 国 p 的国土(lands 是它的州,升序)按邻接分成几片(每片的州按编号升序,片按最小的州排) */
function pieces(own, p, lands, start, list) {
  const seen = new Set();
  const out = [];
  for (const r of lands) {
    if (own[r] !== p || seen.has(r)) continue;
    const piece = [r];
    seen.add(r);
    for (let i = 0; i < piece.length; i++) {
      const q = piece[i];
      for (let e = start[q]; e < start[q + 1]; e++) {
        const n = list[e];
        if (own[n] === p && !seen.has(n)) seen.add(n), piece.push(n);
      }
    }
    out.push(piece.sort((a, b) => a - b));
  }
  return out;
}

/** 从州 from 出发、不经过 skip,走得到国 p 的几州 */
function reach(own, p, from, skip, start, list) {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) {
    const q = todo.pop();
    for (let e = start[q]; e < start[q + 1]; e++) {
      const n = list[e];
      if (n !== skip && own[n] === p && !seen.has(n)) seen.add(n), todo.push(n);
    }
  }
  return seen.size;
}

/** 和这几州接壤的别国里挨得最多的(按接壤的州数,一样多取编号小的);没有 = −1 */
function bestNeighbor(own, p, regions, alive, start, list) {
  const touch = new Map();
  for (const q of regions) {
    const seen = new Set();
    for (let e = start[q]; e < start[q + 1]; e++) {
      const n = list[e];
      const o = own[n];
      if (o === p || !alive(o) || seen.has(n)) continue;
      seen.add(n);
      touch.set(o, (touch.get(o) ?? 0) + 1);
    }
  }
  let best = -1;
  for (const [o, k] of touch) if (best < 0 || k > touch.get(best) || (k === touch.get(best) && o < best)) best = o;
  return best;
}

/** 飞地整形:一回最多 tidyMost 条划州 */
function tidy(turn, r, ps, alive, capRegion) {
  const odds = REALM.tidyOdds * S.tidy;
  if (odds <= 0) return [];
  const { start, list } = r.regions().neighbors;
  const own = Int32Array.from(r.owners('polity'));
  const folk = r.owners('culture');
  const year = Math.round(turn.year);
  const lands = ps.map(() => []);
  for (let q = 0; q < own.length; q++) if (own[q] >= 0 && own[q] < ps.length) lands[own[q]].push(q);
  const cmds = [];
  const cede = (rs, to) => {
    for (const q of rs) {
      cmds.push({ kind: 'cede', a: to, region: q });
      own[q] = to;
    }
  };
  for (let p = 0; p < ps.length && cmds.length < REALM.tidyMost; p++) {
    if (!alive(p)) continue;
    const cap = capRegion(p);
    if (cap < 0 || own[cap] !== p) continue;
    // ① 不连本土的小片,整片划给挨得最多的邻国
    for (const piece of pieces(own, p, lands[p], start, list)) {
      if (piece.includes(cap) || piece.length > REALM.tidySmall || cmds.length + piece.length > REALM.tidyMost) continue;
      if (piece.some((q) => folk[q] < 0)) continue;
      const to = bestNeighbor(own, p, piece, alive, start, list);
      if (to < 0 || turn.rand(ROLL_PIECE, year, p, piece[0]) >= odds) continue;
      cede(piece, to);
    }
    // ② 本土上只连本国一州、却挨着好几州别国的死胡同:划了以后本土其余的州还连着才划;划一州重看一遍
    const tried = new Set();
    for (;;) {
      if (cmds.length >= REALM.tidyMost) break;
      const home = reach(own, p, cap, -1, start, list);
      let pick = -1;
      let pickForeign = 0;
      for (const q of lands[p]) {
        if (own[q] !== p || q === cap || tried.has(q) || folk[q] < 0) continue;
        let mine = 0;
        const foreign = new Set();
        for (let e = start[q]; e < start[q + 1]; e++) {
          const n = list[e];
          if (own[n] === p) mine++;
          else if (alive(own[n])) foreign.add(n);
        }
        if (mine !== 1 || foreign.size < REALM.tidyDeadEnd) continue;
        if (foreign.size > pickForeign) (pick = q), (pickForeign = foreign.size);
      }
      if (pick < 0) break;
      tried.add(pick);
      if (reach(own, p, cap, pick, start, list) !== home - 1) continue;
      const to = bestNeighbor(own, p, [pick], alive, start, list);
      if (to < 0 || turn.rand(ROLL_DEAD_END, year, pick) >= odds) continue;
      cede([pick], to);
    }
  }
  return cmds;
}

/** 王帐随行:游牧民族的国把国都迁到本国人口最多的另一座城。够格的国超过 nomadMost 个时,第 k 回从第 k × nomadMost 个起轮着挑 */
function nomads(r, ps, alive, k) {
  const folk = r.cultures();
  const ss = r.settlements();
  const owner = r.owners('polity');
  const best = new Map();
  for (const s of ss) {
    if (s.ended !== undefined) continue;
    const p = owner[s.region];
    if (!alive(p) || s.id === ps[p].capital || folk[ps[p].culture]?.kind !== 'nomad') continue;
    const b = best.get(p);
    if (b === undefined || s.population > ss[b].population) best.set(p, s.id);
  }
  const all = [...best].sort((x, y) => x[0] - y[0]);
  const most = Math.min(REALM.nomadMost, all.length);
  const from = all.length > most ? (k * most) % all.length : 0;
  const cmds = [];
  for (let i = 0; i < most; i++) {
    const [a, city] = all[(from + i) % all.length];
    cmds.push({ kind: 'move', a, city });
  }
  return cmds;
}

civAtlas.sim({
  act(turn) {
    const r = turn.read;
    const ps = r.polities();
    const alive = (p) => p >= 0 && !!ps[p] && ps[p].ended === undefined && ps[p].size > 0;
    const reply = {};
    const commands = [];
    const gap = S.nomad > 0 ? Math.max(1, Math.round(REALM.nomadYears / S.nomad)) : 0;
    if (turn.year === 0 && gap) reply.at = [{ year: gap, kind: NOMAD, data: [0] }];
    // 这一刻要迁都的国 → 新国都;同一刻整飞地按新国都算本土,不把刚迁去的那州划走
    const moving = new Map();
    for (const e of turn.events) {
      if (e.kind !== NOMAD) continue;
      const k = e.data[0] ?? 0;
      for (const c of nomads(r, ps, alive, k)) {
        commands.push(c);
        moving.set(c.a, c.city);
      }
      reply.at = [{ year: turn.year + gap, kind: NOMAD, data: [k + 1] }];
    }
    if (turn.tick) {
      const ss = r.settlements();
      const regionOf = (sid) => {
        const s = ss[sid];
        return s && s.ended === undefined ? s.region : -1;
      };
      const capRegion = (p) => regionOf(ps[p].capital);
      const owner = r.owners('polity');
      const { area, biome } = r.regions();
      const control = r.official('control');
      const lv = /** @type {const} */ (['dev.production', 'dev.transport', 'dev.information', 'dev.administration']).map((n) => r.official(n));
      const n = ps.length;

      // 亏空伤国:小本子里记各国连着亏了几年
      const had = /** @type {{ broke?: Record<string, number> } | undefined} */ (turn.note);
      const broke = /** @type {Record<string, number>} */ ({});
      const hurt = new Float64Array(n);
      for (let p = 0; p < n; p++) {
        if (!alive(p) || ps[p].broke < REALM.broke) continue;
        const years = (had?.broke?.[p] ?? 0) + REALM.every;
        broke[p] = years;
        if (years >= REALM.start) hurt[p] = Math.min(years / REALM.full, 1);
      }
      reply.note = { broke };

      // 各国的州数、管得到几成的合计、面积、难走的面积
      const size = new Float64Array(n);
      const ctrl = new Float64Array(n);
      const land = new Float64Array(n);
      const hard = new Float64Array(n);
      for (let q = 0; q < owner.length; q++) {
        const p = owner[q];
        if (p < 0 || p >= n) continue;
        size[p]++;
        ctrl[p] += control[q];
        land[p] += area[q];
        if (HARD.has(biome[q])) hard[p] += area[q];
      }
      /** 国都那州离铁器时代还差几成:1 = 石器时代开头,0 = 到了铁器 */
      const early = (p) => {
        const c = capRegion(p);
        if (c < 0) return 0;
        let s = 0;
        for (let k = 0; k < 4; k++) s += ERA_WEIGHT[k] / (lv[k][c] + 1);
        return clamp01(1 - (1 / s - 1) / IRON);
      };

      const unrest = turn.influence('unrest.add');
      const power = turn.influence('war.power');
      const split = turn.influence('split.odds');
      const odds = turn.influence('war.odds');
      const reachF = turn.influence('control.reach');
      for (let p = 0; p < n; p++) {
        if (!alive(p) || !size[p]) {
          power[p] = split[p] = odds[p] = reachF[p] = 1;
          continue;
        }
        const f = hurt[p];
        const e = early(p);
        const h = land[p] > 0 ? hard[p] / land[p] : 0;
        power[p] = Math.max(0, 1 - REALM.power * S.deficit * f) * Math.pow(0.5 + 0.5 * (ctrl[p] / size[p]), S.levy);
        split[p] = 1 + REALM.split * S.deficit * f;
        odds[p] = Math.max(0, 1 - REALM.earlyWar * S.early * e);
        reachF[p] = Math.max(0, 1 - REALM.terrain * S.terrain * h * e) * Math.max(0, 1 - REALM.earlyReach * S.early * e);
      }
      for (let q = 0; q < owner.length; q++) {
        const p = owner[q];
        unrest[q] = p >= 0 && p < n ? REALM.unrest * S.deficit * hurt[p] : 0;
      }
      reply.influences = { 'unrest.add': unrest, 'war.power': power, 'split.odds': split, 'war.odds': odds, 'control.reach': reachF };

      if (turn.year > 0 && turn.year % REALM.tidyEvery === 0) commands.push(...tidy(turn, r, ps, alive, (p) => regionOf(moving.get(p) ?? ps[p].capital)));
    }
    if (commands.length) reply.commands = commands;
    return reply;
  },
});
