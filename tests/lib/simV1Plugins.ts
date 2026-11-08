/**
 * 只照推演插件接口第 1 版(src/gen/civ/simApi.ts)写的两个插件,不引推演的代码:
 * 厌战(议会国开战先过议会、久战不决就罢兵)、宗教生效(异教难治、难融合,圣城在异教国手里就兴兵,同教联手拒强邻)。
 * 只当测试插件,规则写核心那几条;tests/sim-plugin-v1.test.ts 用
 */
import type { PluginChronicle, PluginNote, SimCommand, SimFaith, SimPlugin, SimPolity, SimRead } from '../../src/gen/civ/simApi';

/** 开战要议的国:设了议事会、议会的王国,共和国(海洋城邦共和也算,种子 7、2024 里立宪的国家太少);军政府不算 */
export const parliamentary = (p: Pick<SimPolity, 'regime' | 'charter'>): boolean => (p.regime === 'crown' && p.charter >= 1) || p.regime === 'republic';

export const WEARY = {
  /** 议会点头的几成(乘在宣战的赔率上) */
  vote: 0.45,
  /** 连着几年没打下一州就罢兵 */
  stall: 4,
  /** 一场仗最多打几年就罢兵 */
  years: 8,
  /** 罢兵立约几年 */
  term: 10,
};

/** 小本子里一场仗占几个数:编号、攻方、守方、开战那年、上回打下一州那年、遣使那年(−1 = 还没有) */
const W = 6;

/**
 * 厌战:每年出手。听宣战、攻占、议和记着在打的仗;议会国宣战的赔率乘 WEARY.vote;
 * 攻方是议会国的仗(打自己分出去的国不算),连着 WEARY.stall 年没打下一州、或打满 WEARY.years 年,下令和守方立约罢兵,编年史记一句
 */
export function weariness(id = 'weariness'): SimPlugin<SimRead> {
  return {
    id,
    every: 1,
    listen: ['war', 'conquer', 'peace'],
    influences: ['war.odds'],
    act(turn) {
      const w = ((turn.note as { w?: number[] } | undefined)?.w ?? []).slice();
      const at = (war: number) => {
        for (let i = 0; i < w.length; i += W) if (w[i] === war) return i;
        return -1;
      };
      for (const e of turn.heard) {
        const i = at(e.war);
        if (e.kind === 'war' && i < 0) w.push(e.war, e.a, e.b, e.year, e.year, -1);
        else if (e.kind === 'conquer' && i >= 0 && e.a === w[i + 1]) w[i + 4] = e.year;
        else if (e.kind === 'peace' && i >= 0) w.splice(i, W);
      }
      const ps = turn.read.polities();
      const odds = turn.influence('war.odds');
      for (let p = 0; p < odds.length; p++) odds[p] = ps[p].ended === undefined && parliamentary(ps[p]) ? WEARY.vote : 1;
      const commands: SimCommand[] = [];
      const chronicle: PluginChronicle[] = [];
      for (let i = 0; i < w.length; ) {
        const [, a, b, start, gain, asked] = w.slice(i, i + W);
        // 仗已经停了(亡国、别的缘故收了兵):不再记着
        if (!ps[a] || !ps[a].wars.includes(b)) {
          w.splice(i, W);
          continue;
        }
        const long = turn.year - start >= WEARY.years;
        const stuck = turn.year - gain >= WEARY.stall;
        if (asked < 0 && parliamentary(ps[a]) && ps[b].parent !== a && (long || stuck)) {
          commands.push({ kind: 'treaty', a, ps: [b], term: WEARY.term });
          const n = Math.round(turn.year - start);
          chronicle.push(
            gain > start
              ? { text: `{国:a}伐{国:b}久攻不下,议会厌战,遣使议和`, refs: { a, b } }
              : { text: `{国:a}伐{国:b},战${n}年不决,议会厌战,遣使议和`, refs: { a, b } },
          );
          w[i + 5] = turn.year;
        }
        i += W;
      }
      return { note: { w } as PluginNote, influences: { 'war.odds': odds }, ...(commands.length ? { commands, chronicle } : {}) };
    },
  };
}

export const FAITH = {
  /** 一州信的和本国国教不同(异教 1、同一大教的别派 0.5):本国动荡加 unrest × 这几成(异族州是 0.6,异教算一半) */
  unrest: 0.3,
  /** 同化的速率:异教 × 0.6(别派按一半折),同教 × 1.1 */
  assimFar: 0.6,
  assimSame: 1.1,
  /** 宣战的赔率:邻国全同教 × 0.85,全异教 × 1.3,按邻国里异教占几成折 */
  warSame: 0.85,
  warFar: 1.3,
  /** 圣城在接壤的异教国手里,每次出手兴兵的几成;打过一次隔几年才再为它打 */
  holy: 0.2,
  holyGap: 40,
  /** 同教的两国都和一个更强的异教国接壤:每次出手结盟的几成、盟约几年 */
  ally: 0.15,
  allyYears: 40,
  /** 一次出手最多下几条命令 */
  most: 8,
};

/** 两种信仰隔得多远:一样 0,同一大教的别派 0.5,别的 1;不知道(没人住、没有国教)= −1 */
export function faithGap(faiths: readonly SimFaith[], f: number, g: number): number {
  if (f < 0 || g < 0 || !faiths[f] || !faiths[g]) return -1;
  if (f === g) return 0;
  const root = (x: number) => (faiths[x].kind === 'sect' && faiths[x].parent !== undefined ? faiths[x].parent! : x);
  return root(f) === root(g) ? 0.5 : 1;
}

/**
 * 宗教生效:每 5 年出手(信仰也是每 5 年算一步)。按州交动荡、同化,按国交宣战的赔率;
 * 下两种命令:圣城在接壤的异教国手里,奉这个大教的国兴兵(复圣城);两个同教的邻国都挨着一个更强的异教国,结盟拒之。都在编年史记一句
 */
export function faithEffect(id = 'faith'): SimPlugin<SimRead> {
  return {
    id,
    every: 5,
    influences: ['unrest.add', 'assim.rate', 'war.odds'],
    act(turn) {
      const r = turn.read;
      const ps = r.polities();
      const faiths = r.faiths();
      const owner = r.owners('polity');
      const faith = r.owners('faith');
      const { start, list } = r.regions().neighbors;
      const R = owner.length;
      const unrest = turn.influence('unrest.add');
      const assim = turn.influence('assim.rate');
      const odds = turn.influence('war.odds');
      const stateOf = (p: number) => (p >= 0 && ps[p] ? ps[p].faith : -1);
      for (let q = 0; q < R; q++) {
        const gap = faithGap(faiths, stateOf(owner[q]), faith[q]);
        unrest[q] = gap > 0 ? FAITH.unrest * gap : 0;
        assim[q] = gap < 0 ? 1 : gap === 0 ? FAITH.assimSame : 1 - (1 - FAITH.assimFar) * gap;
      }
      // 接壤的国(按编号升序)
      const near: Set<number>[] = ps.map(() => new Set());
      for (let q = 0; q < R; q++) {
        const a = owner[q];
        if (a < 0) continue;
        for (let e = start[q]; e < start[q + 1]; e++) {
          const b = owner[list[e]];
          if (b >= 0 && b !== a) near[a].add(b);
        }
      }
      for (let p = 0; p < odds.length; p++) {
        let n = 0;
        let far = 0;
        for (const q of near[p]) {
          const gap = faithGap(faiths, stateOf(p), stateOf(q));
          if (gap < 0) continue;
          n++;
          far += gap;
        }
        odds[p] = n ? FAITH.warSame + (FAITH.warFar - FAITH.warSame) * (far / n) : 1;
      }

      // holy:国 → 上回为圣城兴兵那年;pact:「甲:乙」→ 下令结的盟到哪年
      const had = turn.note as { holy?: Record<string, number>; pact?: Record<string, number> } | undefined;
      const note = { holy: { ...(had?.holy ?? {}) }, pact: { ...(had?.pact ?? {}) } };
      for (const k of Object.keys(note.holy)) if (turn.year - note.holy[k] >= FAITH.holyGap) delete note.holy[k];
      for (const k of Object.keys(note.pact)) if (turn.year >= note.pact[k]) delete note.pact[k];
      const commands: SimCommand[] = [];
      const chronicle: PluginChronicle[] = [];
      const alive = (p: number) => p >= 0 && !!ps[p] && ps[p].ended === undefined && ps[p].size > 0;
      const busy = (a: number, b: number) => ps[a].wars.includes(b) || ps[a].allies.includes(b);
      const ss = r.settlements();
      // 复圣城
      for (const f of faiths) {
        if (f.kind !== 'great' || f.holy === undefined || commands.length >= FAITH.most) continue;
        const s = ss[f.holy];
        if (!s || s.ended !== undefined) continue;
        const b = owner[s.region];
        if (!alive(b) || faithGap(faiths, f.id, stateOf(b)) !== 1) continue;
        for (const a of [...near[b]].sort((x, y) => x - y)) {
          const mine = faithGap(faiths, f.id, stateOf(a));
          if (!alive(a) || busy(a, b) || note.holy[a] !== undefined || mine < 0 || mine > 0.5) continue;
          if (turn.rand(a, f.id, Math.round(turn.year), 1) >= FAITH.holy) continue;
          commands.push({ kind: 'declare', a, b });
          chronicle.push({ text: '{国:a}欲复圣城{城:s},兴兵伐{国:b}', refs: { a, b, s: f.holy } });
          note.holy[a] = turn.year;
          break;
        }
      }
      // 同教联手拒强邻
      for (let s = 0; s < ps.length && commands.length < FAITH.most; s++) {
        if (!alive(s) || stateOf(s) < 0) continue;
        const around = [...near[s]].filter((p) => alive(p) && ps[p].power < ps[s].power && faithGap(faiths, stateOf(p), stateOf(s)) === 1).sort((x, y) => x - y);
        for (let i = 0; i < around.length && commands.length < FAITH.most; i++) {
          for (let j = i + 1; j < around.length; j++) {
            const a = around[i];
            const b = around[j];
            if (faithGap(faiths, stateOf(a), stateOf(b)) !== 0 || !near[a].has(b) || busy(a, b) || note.pact[`${a}:${b}`] !== undefined) continue;
            if (turn.rand(a, b, Math.round(turn.year), 2) >= FAITH.ally) continue;
            const until = Math.floor(turn.year) + FAITH.allyYears;
            commands.push({ kind: 'ally', a, b, until });
            note.pact[`${a}:${b}`] = until;
            chronicle.push({ text: '{国:a}与{国:b}同奉一教,结盟以拒{国:s}', refs: { a, b, s } });
            break;
          }
        }
      }
      return {
        note: note as unknown as PluginNote,
        influences: { 'unrest.add': unrest, 'assim.rate': assim, 'war.odds': odds },
        ...(commands.length ? { commands, chronicle } : {}),
      };
    },
  };
}
