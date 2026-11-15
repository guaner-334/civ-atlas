// 乱世:大国崩解时碎成几家、互相攻伐;改朝换代时远处的州拥兵自立,同族的邻国兴兵勤王;无主的富庶之地立国;不接壤的两国结盟,对付夹在中间的强国
// 每年出手一次,上次出手以后的大崩解、改朝换代当场就办;「乱后立国」每 10 年、「远交」每 20 年看一回。四个滑条各管一件,拨到 0 就不做。
// 命令要到下一刻才办,办没办成下一回合才知道:立国的半年后认出新国再记编年史,宣战、结盟的下一回合看 turn.refused 再记

const CHAOS = {
  /** 崩成几家:挑 1 + 滑条 个州立国,最多几个 */
  shatterMost: 4,
  /** 乱中自立:中央管得到不到几成、离国都几州以上的州才起事;每州起事的几成、一回最多立几国;同族邻国勤王的几成(几成都乘滑条)。同族的邻国不多,勤王的几成小了几千年里一次都不见 */
  riseControl: 0.4,
  riseFar: 4,
  rise: 0.15,
  riseMost: 3,
  loyal: 0.5,
  /** 乱后立国:每几年看一回;乡村人口、宜居都要在前几成;每州立国的几率(乘滑条)、一回最多立几国。开局几百年遍地无主的富州,几率大了立国太多 */
  reviveEvery: 10,
  reviveTop: 0.3,
  revive: 0.002,
  reviveMost: 2,
  /** 远交:每几年看一回;中间那国的国力至少是两国里强的那个的几倍;结盟的几成(乘滑条)、盟约几年、一回最多几对 */
  distantEvery: 20,
  distantRatio: 1.5,
  distant: 0.2,
  distantYears: 30,
  distantMost: 4,
  /** 下令立国以后隔多久认出新国 */
  wait: 0.5,
  /** 一回合最多下几条 */
  most: { found: 4, declare: 6, ally: 4 },
  /** 一个世界里最多下几条命令、写几句编年史,用完就不再下、不再写(网站的上限:所有推演插件一共 10000 条,一个插件 2000 句) */
  budget: { commands: 4000, lines: 1500 },
};

/** 四件事的事号:掷随机数时分开同一回合里的几件事,也是约事的种类、小本子里记的「哪件事」 */
const SHATTER = 1;
const RISE = 2;
const REVIVE = 3;
const DISTANT = 4;
const LOYAL = 5;

/** 从州 from 走到各州要几步(邻州含海峡、航线;走不到 = 州数) */
function hops(nb, R, from) {
  const d = new Int32Array(R).fill(R);
  const queue = new Int32Array(R);
  let n = 0;
  d[from] = 0;
  queue[n++] = from;
  for (let h = 0; h < n; h++) {
    const r = queue[h];
    for (let e = nb.start[r]; e < nb.start[r + 1]; e++) {
      const j = nb.list[e];
      if (d[j] < R) continue;
      d[j] = d[r] + 1;
      queue[n++] = j;
    }
  }
  return d;
}

/** 排在前几成的门槛 */
function topCut(values, top) {
  const v = Array.from(values).sort((x, y) => y - x);
  return v[Math.min(v.length - 1, Math.floor(top * v.length))];
}

/** 编年史里列几个国或州:{国:n0}、{国:n1}…… */
const list = (kind, tag, ids, refs) => ids.map((id, i) => ((refs[`${tag}${i}`] = id), `{${kind}:${tag}${i}}`)).join('、');

civAtlas.sim({
  act(turn) {
    const k = civAtlas.params;
    // 出手都在整年、半年上:年份 × 2 当随机数的键
    const key = Math.round(turn.year * 2);
    // 小本子:p 远交结的盟 [甲, 乙, 到哪年, 0 已下令 / 1 成了];ask 上回下的宣战、结盟 [回话里第几条, 事号, 国, 国, 国];
    // n 写了几句编年史,c 下了几条命令
    const had = /** @type {{ p?: number[][], ask?: number[][], n?: number, c?: number } | undefined} */ (turn.note);
    const note = { p: (had?.p ?? []).map((x) => x.slice()), ask: /** @type {number[][]} */ ([]), n: had?.n ?? 0, c: had?.c ?? 0 };
    /** @type {{ text: string, refs: Record<string, number> }[]} */
    const chronicle = [];
    const write = (text, refs) => {
      if (note.n >= CHAOS.budget.lines) return;
      note.n++;
      chronicle.push({ text, refs });
    };

    // 上回下的宣战、结盟:被作者的干预挡下的(turn.refused 里有)不记,远交的盟约删掉;别的算办了,记一句
    const no = new Set((turn.refused ?? []).map((x) => x.index));
    for (const [i, what, x, y, z] of had?.ask ?? []) {
      const done = !no.has(i);
      if (what === DISTANT) {
        const at = note.p.findIndex((u) => u[0] === x && u[1] === y && u[3] === 0);
        if (at >= 0 && done) note.p[at][3] = 1;
        else if (at >= 0) note.p.splice(at, 1);
        if (done) write('{国:a}与{国:b}远交,共制{国:z}', { a: x, b: y, z });
      } else if (done) {
        write('{国:q}以勤王为名,兴兵伐{国:a}', { q: x, a: y });
      }
    }

    const collapses = k.shatter > 0 ? turn.heard.filter((e) => e.kind === 'collapse') : [];
    const dynasties = k.rise > 0 ? turn.heard.filter((e) => e.kind === 'dynasty') : [];
    const reviving = k.revive > 0 && turn.tick && turn.year % CHAOS.reviveEvery === 0;
    const allying = k.distant > 0 && turn.tick && turn.year % CHAOS.distantEvery === 0;
    if (!collapses.length && !dynasties.length && !turn.events.length && !reviving && !allying) return { note, ...(chronicle.length ? { chronicle } : {}) };

    const read = turn.read;
    const ps = read.polities();
    const owner = read.owners('polity');
    const regions = read.regions();
    const nb = regions.neighbors;
    const R = owner.length;
    const alive = (p) => p >= 0 && !!ps[p] && ps[p].ended === undefined && ps[p].size > 0;
    /** @type {Set<number>[] | undefined} */
    let nearMemo;
    /** 各国和哪几国接壤 */
    const near = () => {
      if (nearMemo) return nearMemo;
      const sets = ps.map(() => /** @type {Set<number>} */ (new Set()));
      for (let r = 0; r < R; r++) {
        const a = owner[r];
        if (a < 0) continue;
        for (let e = nb.start[r]; e < nb.start[r + 1]; e++) {
          const b = owner[nb.list[e]];
          if (b >= 0 && b !== a) sets[a].add(b);
        }
      }
      return (nearMemo = sets);
    };
    /** @type {Uint8Array | undefined} */
    let cityMemo;
    /** 州里有没有城(1 = 有) */
    const city = () => {
      if (cityMemo) return cityMemo;
      cityMemo = new Uint8Array(R);
      for (const s of read.settlements()) if (s.ended === undefined && s.region < R) cityMemo[s.region] = 1;
      return cityMemo;
    };
    const capRegion = (p) => read.settlements()[ps[p].capital]?.region ?? -1;

    const commands = [];
    const at = [];
    const left = { ...CHAOS.most };
    /** 这一回合已下令立国的州 */
    const used = new Set();
    /** 下一条命令;下不了(这一回合的、这个世界的条数用完了)= false */
    const order = (c) => {
      if (left[c.kind] <= 0 || note.c >= CHAOS.budget.commands) return false;
      left[c.kind]--;
      note.c++;
      commands.push(c);
      if (c.kind === 'found') used.add(c.region);
      return true;
    };
    const fight = (a, b) => alive(a) && alive(b) && near()[a].has(b) && !ps[a].wars.includes(b) && order({ kind: 'declare', a, b });
    /** 下令在这几州立国,半年后认出新国 */
    const found = (what, a, rs) => {
      const done = rs.filter((r) => order({ kind: 'found', region: r }));
      if (done.length) at.push({ year: turn.year + CHAOS.wait, kind: what, data: [a, turn.year, ...done] });
      return done.length;
    };

    // 半年前下令立的国:认出那几州上立起来的新国(从原来那国分出来、那以后才立的),记一句;崩成几家的,接壤的两两相攻、再攻原来那国
    for (const e of turn.events) {
      const [a, since, ...rs] = e.data;
      const born = [];
      const where = [];
      for (const r of rs) {
        const p = owner[r];
        if (alive(p) && p !== a && (ps[p].parent ?? -1) === a && ps[p].founded >= since && !born.includes(p)) born.push(p), where.push(r);
      }
      if (!born.length) continue;
      if (e.kind === SHATTER) {
        const refs = { a };
        write(`{国:a}崩解之际,${list('国', 'n', born, refs)}趁乱自立`, refs);
        for (let i = 0; i < born.length; i++) for (let j = i + 1; j < born.length; j++) fight(born[i], born[j]);
        for (const p of born) fight(p, a);
      } else if (e.kind === RISE) {
        const refs = { a };
        write(`{国:a}易代之际,${list('国', 'n', born, refs)}拥兵自立`, refs);
      } else {
        born.forEach((n, i) => write('{州:r}久无所属,当地豪族据地立{国:n}', { r: where[i], n }));
      }
    }

    // 崩成几家:那国剩下的有城的州里,离国都和已挑的州最远的先挑,下令立国
    for (const e of collapses) {
      const a = e.a;
      const capR = alive(a) ? capRegion(a) : -1;
      if (capR < 0) continue;
      const want = Math.min(CHAOS.shatterMost, Math.floor(1 + k.shatter) + (turn.rand(SHATTER, key, a) < (1 + k.shatter) % 1 ? 1 : 0));
      const cands = [];
      for (let r = 0; r < R; r++) if (owner[r] === a && r !== capR && city()[r] && !used.has(r)) cands.push(r);
      const d = hops(nb, R, capR);
      const picked = [];
      while (picked.length < want && cands.length) {
        let best = 0;
        for (let i = 1; i < cands.length; i++) if (d[cands[i]] > d[cands[best]]) best = i;
        const r = cands.splice(best, 1)[0];
        picked.push(r);
        const dr = hops(nb, R, r);
        for (let j = 0; j < R; j++) if (dr[j] < d[j]) d[j] = dr[j];
      }
      found(SHATTER, a, picked);
    }

    // 乱中自立:改朝换代的国里,中央管不到、离国都远的州拥兵自立;同族的邻国兴兵勤王
    for (const e of dynasties) {
      const a = e.a;
      const capR = alive(a) ? capRegion(a) : -1;
      if (capR < 0) continue;
      const control = read.official('control');
      const d = hops(nb, R, capR);
      const cands = [];
      for (let r = 0; r < R; r++) if (owner[r] === a && control[r] < CHAOS.riseControl && d[r] >= CHAOS.riseFar && !used.has(r)) cands.push(r);
      cands.sort((x, y) => control[x] - control[y] || x - y);
      found(RISE, a, cands.filter((r) => turn.rand(RISE, key, r) < CHAOS.rise * k.rise).slice(0, CHAOS.riseMost));
      for (const q of [...near()[a]].sort((x, y) => x - y)) {
        if (!alive(q) || ps[q].culture !== ps[a].culture || ps[q].allies.includes(a)) continue;
        if (turn.rand(LOYAL, key, q, a) < CHAOS.loyal * k.rise && fight(q, a)) note.ask.push([commands.length - 1, LOYAL, q, a, -1]);
      }
    }

    // 乱后立国:没有主、有城或乡村人口在前几成、宜居在前几成的州,当地豪族据地立国
    if (reviving) {
      const rural = read.official('rural');
      const hab = regions.habitability;
      const ruralCut = topCut(rural, CHAOS.reviveTop);
      const habCut = topCut(hab, CHAOS.reviveTop);
      const cands = [];
      for (let r = 0; r < R; r++) if (owner[r] < 0 && !used.has(r) && hab[r] >= habCut && (city()[r] || (rural[r] > 0 && rural[r] >= ruralCut))) cands.push(r);
      cands.sort((x, y) => rural[y] - rural[x] || x - y);
      found(REVIVE, -1, cands.filter((r) => turn.rand(REVIVE, key, r) < CHAOS.revive * k.revive).slice(0, CHAOS.reviveMost));
    }

    // 远交:不接壤的两国,都挨着一个强过它俩不少的邻国,结盟对付它;中间那国越强的先看,一对只掷一次
    if (allying) {
      note.p = note.p.filter((x) => turn.year < x[2] && alive(x[0]) && alive(x[1]));
      const pacted = new Set(note.p.map((x) => `${x[0]}:${x[1]}`));
      const nr = near();
      const cands = [];
      for (let z = 0; z < ps.length; z++) {
        if (!alive(z)) continue;
        const around = [...nr[z]].filter((p) => alive(p) && ps[p].power > 0 && ps[z].power >= CHAOS.distantRatio * ps[p].power).sort((x, y) => x - y);
        for (let i = 0; i < around.length; i++) {
          for (let j = i + 1; j < around.length; j++) {
            const x = around[i];
            const y = around[j];
            if (nr[x].has(y) || ps[x].wars.includes(y) || ps[x].allies.includes(y)) continue;
            cands.push([ps[z].power / Math.max(ps[x].power, ps[y].power), x, y, z]);
          }
        }
      }
      cands.sort((u, v) => v[0] - u[0] || u[1] - v[1] || u[2] - v[2]);
      let n = 0;
      for (const [, x, y, z] of cands) {
        if (n >= CHAOS.distantMost) break;
        if (pacted.has(`${x}:${y}`)) continue;
        pacted.add(`${x}:${y}`);
        if (turn.rand(DISTANT, key, x, y) >= CHAOS.distant * k.distant) continue;
        const until = Math.floor(turn.year) + CHAOS.distantYears;
        if (!order({ kind: 'ally', a: x, b: y, until })) break;
        note.p.push([x, y, until, 0]);
        note.ask.push([commands.length - 1, DISTANT, x, y, z]);
        n++;
      }
    }

    return {
      note,
      ...(commands.length ? { commands } : {}),
      ...(at.length ? { at } : {}),
      ...(chronicle.length ? { chronicle } : {}),
    };
  },
});
