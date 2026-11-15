// 灾异:大灾之后接着闹瘟疫;到了工业、信息时代会有经济危机、技术失控;偶尔天变;隔几百年来一段冷期;沿海闹大潮
// 每年出手一次,听饥荒、洗劫、毁城;每 10 年掷一回后世之灾、天变、潮灾;冷期按约好的年份来去。
// 正在生效的几段效果记在小本子里(到哪年为止),有效果开始或结束,就照小本子把五个影响口整栏重算一遍交回

const P = civAtlas.params;

const OMEN = {
  /** 灾后疫:几年;每次大灾,那州的城在这几年里闹一场瘟疫的几成(× 滑条) */
  afterYears: 10,
  afterStrike: 0.005,
  /** 后世之灾:每回每国掷几成(× 滑条);经济危机动荡加多少、发展速度乘几、几年;技术失控城的人口上限乘几、几年 */
  modernOdds: 0.02,
  crisisUnrest: 0.15,
  crisisDev: 0.5,
  crisisYears: 10,
  runawayCap: 0.5,
  runawayYears: 30,
  /** 时代数值到几算「工业」「信息」(和网站一样:生产、运输、信息、行政按这几成加权的调和平均) */
  industrial: 5,
  information: 7,
  eraWeight: [0.35, 0.2, 0.25, 0.2],
  /** 天变:全世界平均几年一次(÷ 滑条);头 50 年人口上限、发展速度压到几成,后 50 年几成 */
  skyYears: 5000,
  skyHard: 0.25,
  skySoft: 0.5,
  skyHalf: 50,
  skyEnd: 100,
  /** 冷暖:冷期隔几年来一次、一次几年(最少几年 + 随机多出的几年);乡村人口上限每拨 1 格少几成 */
  coldGap: [300, 300],
  coldLen: [100, 100],
  coldCut: 0.15,
  /** 潮灾:每回每个临海州掷几成(× 滑条);城的人口上限乘几、几年;一回最多几州 */
  tideOdds: 0.002,
  tideCap: 0.6,
  tideYears: 20,
  tideMost: 4,
  /** 一个插件在一个世界里最多写 2000 句编年史,超了推演停下:写到这么多就不再写 */
  lines: 1900,
};

/** 约的事:一段效果到期(到时重算)、入冷、出冷、灾后那州闹瘟疫 */
const END = 1;
const COLD = 2;
const WARM = 3;
const STRIKE = 4;
/** 随机数的头一个键:哪一件事 */
const R_CRISIS = 1;
const R_RUNAWAY = 2;
const R_RUNAWAY_AT = 3;
const R_SKY = 4;
const R_SKY_AT = 5;
const R_COLD_GAP = 6;
const R_COLD_LEN = 7;
const R_TIDE = 8;
const R_AFTER = 9;
const R_AFTER_AT = 10;

const DEV = /** @type {const} */ (['dev.production', 'dev.transport', 'dev.information', 'dev.administration']);

/** 州 r 的时代数值:整数部分是第几个时代(0 石器 … 5 工业、6 电气、7 信息、8 未来) */
function eraAt(lv, r) {
  let s = 0;
  for (let c = 0; c < 4; c++) s += OMEN.eraWeight[c] / (lv[c][r] + 1);
  return 1 / s - 1;
}

/** 从州 r0 起按邻接一圈圈往外数到一半的州,同一圈里编号小的先 */
function halfFrom(regions, r0) {
  const { start, list } = regions.neighbors;
  const want = Math.floor(regions.count / 2);
  const seen = new Uint8Array(regions.count);
  const out = [];
  let ring = [r0];
  seen[r0] = 1;
  while (ring.length && out.length < want) {
    for (const r of ring) if (out.length < want) out.push(r);
    const next = [];
    for (const r of ring) {
      for (let e = start[r]; e < start[r + 1]; e++) {
        if (!seen[list[e]]) (seen[list[e]] = 1), next.push(list[e]);
      }
    }
    ring = next.sort((a, b) => a - b);
  }
  return out;
}

/** 第 n 段冷期离上一段开头几年、这一段冷几年 */
const coldGap = (turn, n) => OMEN.coldGap[0] + Math.floor(OMEN.coldGap[1] * turn.rand(R_COLD_GAP, n));
const coldLen = (turn, n) => OMEN.coldLen[0] + Math.floor(OMEN.coldLen[1] * turn.rand(R_COLD_LEN, n));

/** 按小本子把五个影响口整栏算一遍:同一个口上的几样效果乘在一起(动荡是加) */
function influencesOf(turn, note) {
  const y = turn.year;
  const plague = turn.influence('plague.odds').fill(1);
  const unrest = turn.influence('unrest.add').fill(0);
  const dev = turn.influence('dev.rate').fill(1);
  const city = turn.influence('city.capacity').fill(1);
  const rural = turn.influence('rural.capacity').fill(1);
  const R = city.length;
  const slow = (r, k) => {
    for (let c = 0; c < 5; c++) dev[r * 5 + c] *= k;
  };
  for (const k in note.after) if (+k < R) plague[+k] = 1 + P.aftermath;
  if (Object.keys(note.crisis).length) {
    // 经济危机跟着国走:此刻归这国的州都算
    const owner = turn.read.owners('polity');
    for (let r = 0; r < R; r++) {
      if (owner[r] < 0 || note.crisis[owner[r]] === undefined) continue;
      unrest[r] += OMEN.crisisUnrest;
      slow(r, OMEN.crisisDev);
    }
  }
  for (const k in note.runaway) if (+k < R) city[+k] *= OMEN.runawayCap;
  for (const k in note.tide) if (+k < R) city[+k] *= OMEN.tideCap;
  if (note.cold) rural.fill(1 - OMEN.coldCut * P.climate);
  if (note.sky.length) {
    const k = y - note.sky[0] < OMEN.skyHalf ? OMEN.skyHard : OMEN.skySoft;
    for (const r of halfFrom(turn.read.regions(), note.sky[1])) {
      if (r >= R) continue;
      city[r] *= k;
      rural[r] *= k;
      slow(r, k);
    }
  }
  return { 'plague.odds': plague, 'unrest.add': unrest, 'dev.rate': dev, 'city.capacity': city, 'rural.capacity': rural };
}

civAtlas.sim({
  act(turn) {
    const y = turn.year;
    const had = /** @type {any} */ (turn.note);
    const note = {
      after: had?.after ?? {},
      crisis: had?.crisis ?? {},
      runaway: had?.runaway ?? {},
      tide: had?.tide ?? {},
      sky: had?.sky ?? [],
      cold: had?.cold ?? 0,
      lines: had?.lines ?? 0,
    };
    const at = [];
    const commands = [];
    const chronicle = [];
    const say = (text, refs) => {
      if (note.lines >= OMEN.lines) return;
      note.lines++;
      chronicle.push(refs ? { text, refs } : { text });
    };
    /** 记一段效果:同一处又来一次,把结束往后推,不叠加 */
    const ends = new Set();
    const last = (map, key, years) => {
      map[key] = Math.max(map[key] ?? 0, y + years);
      ends.add(y + years);
    };
    let dirty = turn.events.length > 0 || Object.keys(note.crisis).length > 0;

    // 冷暖:第 0 年约好第一段冷期,之后每入一次冷约好出冷和下一段
    if (y === 0 && P.climate > 0) at.push({ year: coldGap(turn, 0), kind: COLD, data: [0] });
    /** 到了日子要闹瘟疫的州(灾后疫) */
    const strike = [];
    for (const e of turn.events) {
      if (e.kind === STRIKE) {
        strike.push(e.data[0]);
      } else if (e.kind === COLD) {
        const n = e.data[0];
        note.cold = 1;
        at.push({ year: y + coldLen(turn, n), kind: WARM }, { year: y + coldGap(turn, n + 1), kind: COLD, data: [n + 1] });
        say('天气转寒,四方乡野收成大减');
      } else if (e.kind === WARM) {
        note.cold = 0;
        say('天气回暖,乡野渐复旧观');
      }
    }

    // 灾后疫:饥荒、洗劫、毁城的那一州,之后几年起瘟疫的几率高;另掷一回,中了就约好哪年在那州闹一场
    if (P.aftermath > 0) {
      for (const e of turn.heard) {
        if (e.region < 0) continue;
        last(note.after, e.region, OMEN.afterYears);
        dirty = true;
        if (turn.rand(R_AFTER, y, e.region) >= OMEN.afterStrike * P.aftermath) continue;
        const when = y + 1 + Math.floor((OMEN.afterYears - 1) * turn.rand(R_AFTER_AT, y, e.region));
        if (!at.some((x) => x.kind === STRIKE && x.data[0] === e.region)) at.push({ year: when, kind: STRIKE, data: [e.region] });
      }
    }

    if (turn.tick && y > 0 && y % 10 === 0 && (P.modern > 0 || P.cosmic > 0 || P.tide > 0)) {
      const read = turn.read;
      const ss = read.settlements();
      /** 各州还在的城里一共多少人(千人);0 = 没有城 */
      const townPop = new Float64Array(read.regions().count);
      for (const s of ss) if (s.ended === undefined && s.region < townPop.length) townPop[s.region] += s.population;

      // 后世之灾:国都那州到了工业时代的国,掷经济危机;到了信息时代的再掷技术失控
      if (P.modern > 0) {
        const lv = DEV.map((n) => read.official(n));
        const owner = read.owners('polity');
        for (const p of read.polities()) {
          const cap = ss[p.capital];
          if (p.ended !== undefined || p.size === 0 || !cap || cap.ended !== undefined) continue;
          const era = eraAt(lv, cap.region);
          if (era < OMEN.industrial) continue;
          if (turn.rand(R_CRISIS, y, p.id) < OMEN.modernOdds * P.modern) {
            last(note.crisis, p.id, OMEN.crisisYears);
            say('{国:a}市面崩坏,百业萧条,举国骚然', { a: p.id });
            dirty = true;
          }
          if (era < OMEN.information || turn.rand(R_RUNAWAY, y, p.id) >= OMEN.modernOdds * P.modern) continue;
          const mine = [];
          for (let r = 0; r < owner.length; r++) if (owner[r] === p.id && townPop[r] > 0) mine.push(r);
          if (!mine.length) continue;
          const r = mine[Math.floor(turn.rand(R_RUNAWAY_AT, y, p.id) * mine.length)];
          last(note.runaway, r, OMEN.runawayYears);
          say('{国:a}的{州:r}新造之物失控,城中百姓四散', { a: p.id, r });
          dirty = true;
        }
      }

      // 天变:一回只有一场;从随机一州起压住半个天下,最大的那座城闹一场大疫
      if (P.cosmic > 0 && !note.sky.length && turn.rand(R_SKY, y) < (10 * P.cosmic) / OMEN.skyYears) {
        const regions = read.regions();
        const r0 = Math.floor(turn.rand(R_SKY_AT, y) * regions.count);
        const half = new Set(halfFrom(regions, r0));
        let big = -1;
        for (const s of ss) {
          if (s.ended !== undefined || !half.has(s.region)) continue;
          if (big < 0 || s.population > ss[big].population) big = s.id;
        }
        note.sky = [y, r0];
        ends.add(y + OMEN.skyHalf);
        ends.add(y + OMEN.skyEnd);
        if (big >= 0) {
          commands.push({ kind: 'disaster', type: 'plague', level: 3, city: big });
          say('天象大变,自{州:r}起半个天下寒暗无光,城乡凋敝,{城:s}大疫', { r: r0, s: big });
        } else {
          say('天象大变,自{州:r}起半个天下寒暗无光,城乡凋敝', { r: r0 });
        }
        dirty = true;
      }

      // 潮灾:临海有城的州各掷一回,城里人多的先,一回最多几州
      if (P.tide > 0) {
        const { coastal } = read.regions();
        const hit = [];
        for (let r = 0; r < coastal.length; r++) {
          if (coastal[r] && townPop[r] > 0 && turn.rand(R_TIDE, y, r) < OMEN.tideOdds * P.tide) hit.push(r);
        }
        hit.sort((a, b) => townPop[b] - townPop[a] || a - b);
        const refs = {};
        const names = [];
        for (const r of hit.slice(0, OMEN.tideMost)) {
          last(note.tide, r, OMEN.tideYears);
          refs[`r${names.length}`] = r;
          names.push(`{州:r${names.length}}`);
        }
        if (names.length) {
          say(`大潮漫过${names.join('、')}沿岸,城邑受淹`, refs);
          dirty = true;
        }
      }
    }

    // 灾后疫到了日子:那州还有城就闹一场小疫(一回合只下一条天灾,天变占了就算了)
    for (const r of strike) {
      if (commands.length) break;
      const ss = turn.read.settlements();
      let s = -1;
      for (const x of ss) if (x.ended === undefined && x.region === r && (s < 0 || x.population > ss[s].population)) s = x.id;
      if (s < 0) continue;
      commands.push({ kind: 'disaster', type: 'plague', level: 1, city: s });
      say('{州:r}大灾之后,{城:s}又起疫病', { r, s });
    }

    for (const year of ends) at.push({ year, kind: END });
    const reply = {};
    if (dirty) {
      // 到期的划掉,再整栏重算
      for (const map of [note.after, note.crisis, note.runaway, note.tide]) {
        for (const k of Object.keys(map)) if (map[k] <= y) delete map[k];
      }
      if (note.sky.length && y >= note.sky[0] + OMEN.skyEnd) note.sky = [];
      reply.influences = influencesOf(turn, note);
      reply.note = note;
    }
    if (at.length) reply.at = at;
    if (commands.length) reply.commands = commands;
    if (chronicle.length) reply.chronicle = chronicle;
    return reply;
  },
});
