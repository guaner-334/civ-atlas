/**
 * 冒烟检查(scripts/replay-check.ts)用的例子,按条件现找:历史一变(改了推演,同一个种子的人物、年份换了),
 * 这里照样找得到一个够格的,不用跟着手改人名、年份。找到以后冒烟照原来的断言查(名字、年份、亲属、朝代都按找到的这一位写进断言)。
 *
 * 世界和历史在 Node 里按同一个种子现算(和网页里算出来的逐位一样,见 tests/determinism.test.ts),
 * 卡片上的字用网页同一套写法(peopleText、lineageInfo)算出来,和页面上读到的比。
 */
import { DEFAULT_PARAMS, generateWorld } from '../../src/gen/world';
import { generateCiv } from '../../src/gen/civ';
import type { Civ, Person } from '../../src/gen/civ/types';
import { peopleIndex, personSpan, rulerAt, rulerNeighbors } from '../../src/gen/civ/peopleInfo';
import { generalRole, isConsul, kinOf, personName, princeRole, rulerRole } from '../../src/gen/civ/peopleText';
import { dynastyNote, dynastyRowAt, dynastyRows, kidsOf, layoutDynasty, reignOrder, secededFrom } from '../../src/gen/civ/lineageInfo';
import { searchCiv } from '../../src/ui/searchIndex';
import { ownersAt } from '../../src/gen/civ/timeline';
import { capitalAt, polityAlive, polityName } from '../../src/gen/civ/growth';
import { regionLabel } from '../../src/gen/civ/display';
import { polityKey, regionKey, settlementKey, type Plot } from '../../src/gen/edits';

const civs = new Map<number, Civ>();
/** 网址 ?seed=N 打开的那个世界的历史(默认参数) */
export function civOfSeed(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))));
  return c;
}

/** 正则里原样匹配这段字 */
export const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 「人物」一段的例子:一位君主、他在位时领兵的一位将领,和卡片、世系图、搜索上该写的字 */
export interface PersonExample {
  seed: number;
  /** 打开网页停在哪一年(他在位的某一年,和将领出征那年错开,跳时间轴才看得出跳了) */
  year: number;
  /** 哪国(polity 下标,__wfSelect('polity', …) 用) */
  polity: number;
  ruler: {
    /** 称呼("高宗沈岚尘") */
    name: string;
    /** 身份("大霄皇帝""霄王") */
    role: string;
    from: number;
    until: number;
    prev: { name: string; kin: string };
    next: { name: string; kin: string };
  };
  /** 这国一共几位君主(「全部 N 位」、人物页只看这国时的行数) */
  rulers: number;
  general: { name: string; role: string; from: number; until: number };
  /** 世系图(停在将领出征那年那一朝):标题("霄" + "2655 年起，14 位君主")、头一个没即位的宗室的身份("大霄宗室") */
  lineage: { dynasty: string; note: string; princeRole: string };
}

/** 在一国里找:继位来的君主,前任、继任同一朝都写得出亲属;他在位时有将领头一回出征;世系图、搜索都对得上 */
function personExampleIn(civ: Civ, seed: number): PersonExample[] {
  const ix = peopleIndex(civ);
  const P = civ.people ?? [];
  const nameCount = new Map<string, number>();
  for (const x of P) nameCount.set(personName(civ, x), (nameCount.get(personName(civ, x)) ?? 0) + 1);
  const out: PersonExample[] = [];
  civ.polities.forEach((p, polity) => {
    const rs = ix.rulers[polity] ?? [];
    // 历代君主那一栏列满 5 行
    if (rs.length < 5 || !p.eastern || p.lineage === 'republic') return;
    for (const R of rs) {
      if (R.author !== undefined || isConsul(civ, R) || R.until === undefined || !R.title || !R.leanings || R.from === undefined) continue;
      const { prev, next } = rulerNeighbors(civ, R);
      if (!prev || !next || R.rise !== 'heir' || next.rise !== 'heir') continue;
      if ((prev.dynasty ?? 0) !== (R.dynasty ?? 0) || (next.dynasty ?? 0) !== (R.dynasty ?? 0)) continue;
      const kinPrev = kinOf(civ, R, prev);
      const kinNext = kinOf(civ, R, next);
      if (!kinPrev || !kinNext) continue;
      const from = Math.floor(R.from);
      const until = Math.floor(R.until);
      if (until - from < 4) continue;
      const name = personName(civ, R);
      // 搜他的称呼:头一个就是他(重名的不挑)
      if (nameCount.get(name) !== 1) continue;
      // 卡片「将领」一行(在位时本国领兵的,列前 6 位;领兵的王子也列在这里):挑一位将领(不是王子),头一回出征在他在位那几年、名字没有重的
      const gens = (ix.generals[polity] ?? []).filter((g) => (g.commands ?? []).some((c) => c.until > R.from! && c.from < R.until!)).slice(0, 6);
      for (const G of gens) {
        const gs = personSpan(G);
        const g1 = Math.floor(gs.from);
        if (G.role !== 'general' || !(g1 > from && g1 < until) || nameCount.get(G.name) !== 1) continue;
        if (rulerAt(civ, polity, g1) !== R) continue;
        // 打开时停的年份:他在位、和出征那年差几年
        const year = [g1 + 6, g1 - 6, g1 + 3, g1 - 3].find((y) => y > from && y < until && rulerAt(civ, polity, y) === R);
        if (year === undefined) continue;
        // 世系图:出征那年那一朝;树上至少 8 人;头一个没即位的宗室有子嗣、已去世
        const rows = dynastyRows(civ, polity);
        const ri = dynastyRowAt(rows, g1);
        const row = rows[ri];
        if (!row || !row.rulers.includes(R)) continue;
        const nodes = layoutDynasty(civ, row).flatMap((t) => t.nodes.map((n) => n.p));
        if (nodes.length < 8) continue;
        const prince = nodes.find((x) => !reignOrder(row, x) && !secededFrom(civ, x, polity));
        if (!prince || !kidsOf(civ, prince).length || prince.died === undefined) continue;
        // 搜索(出征那年搜):头一个是他
        const hit = searchCiv(civ, name, g1)[0];
        if (hit?.kind !== 'person' || hit.select.kind !== 'person' || hit.select.id !== R.id) continue;
        out.push({
          seed,
          year,
          polity,
          ruler: {
            name,
            role: rulerRole(civ, R),
            from,
            until,
            prev: { name: personName(civ, prev), kin: kinPrev },
            next: { name: personName(civ, next), kin: kinNext },
          },
          rulers: rs.length,
          general: { name: G.name, role: generalRole(civ, G), from: g1, until: Math.floor(gs.until ?? civ.endYear) },
          lineage: { dynasty: row.name, note: dynastyNote(civ, rows, ri).split('；')[0], princeRole: princeRole(civ, prince) },
        });
        break;
      }
    }
  });
  return out;
}

/**
 * 「人物」一段的例子:依次在几个种子里找,够格的里挑离第 2900 年最近的一位(后半段的历史人物多、卡片写得满);
 * 一个种子里找不到就换下一个
 */
export function findPersonExample(seeds: readonly number[] = [7, 2024, 11, 42]): PersonExample | null {
  for (const seed of seeds) {
    const all = personExampleIn(civOfSeed(seed), seed);
    if (all.length) return all.sort((a, b) => Math.abs(a.year - 2900) - Math.abs(b.year - 2900) || a.polity - b.polity)[0];
  }
  return null;
}

/** 「大纲找更合的世界」一段的例子:一份带两国的大纲(按这个种子的历史现写,稳定键都是真的) */
export interface OutlineExample {
  seed: number;
  /** 开战那年 */
  year: number;
  /** 大纲里的两国:国名(那年的)、稳定键;a 是那年有邻国的最大的一国,b 是和它接壤的最大的一国 */
  a: { name: string; key: string };
  b: { name: string; key: string };
  /** 迁都迁到的城、立国的那一州(原来的名字) */
  city: string;
  region: string;
  /** 4 条:a 攻 b、a 迁都、某州立国、只讲故事 */
  plots: Plot[];
}

/** 第 year 年有接壤邻国的最大的一国和它接壤的最大的一国,写成 4 条的大纲;找不到够格的换一年 */
export function findOutlineExample(seed = 7, years: readonly number[] = [1600, 1500, 1800, 1300]): OutlineExample | null {
  const civ = civOfSeed(seed);
  const rg = civ.regions;
  for (const year of years) {
    const own = ownersAt(civ, year).polity;
    const size = new Map<number, number>();
    for (let r = 0; r < rg.count; r++) if (own[r] >= 0) size.set(own[r], (size.get(own[r]) ?? 0) + 1);
    const alive = [...size.keys()].filter((p) => polityAlive(civ.polities[p], year)).sort((x, y) => size.get(y)! - size.get(x)! || x - y);
    for (const a of alive.slice(0, 6)) {
      const near = new Set<number>();
      const mine: number[] = [];
      for (let r = 0; r < rg.count; r++) {
        if (own[r] !== a) continue;
        mine.push(r);
        for (let k = rg.adjStart[r]; k < rg.adjStart[r + 1]; k++) if (own[rg.adj[k]] >= 0 && own[rg.adj[k]] !== a) near.add(own[rg.adj[k]]);
      }
      const b = alive.find((p) => near.has(p));
      const cap = capitalAt(civ.polities[a], year);
      const city = civ.settlements.findIndex((s, i) => i !== cap && own[s.region] === a);
      const region = mine.find((r) => r !== civ.settlements[cap]?.region);
      if (b === undefined || city < 0 || region === undefined) continue;
      const A = { name: polityName(civ.polities[a], year), key: polityKey(civ, a) };
      const B = { name: polityName(civ.polities[b], year), key: polityKey(civ, b) };
      const plots: Plot[] = [
        { id: 1, kind: 'war', year, a: A.key, b: B.key, text: `${A.name}挥师出境，${B.name}震动。` },
        { id: 2, kind: 'capital', year: year + 60, a: A.key, city: settlementKey(civ, city), text: '迁都。' },
        { id: 3, kind: 'found', year: year + 120, region: regionKey(civ, region) },
        { id: 4, kind: 'story', year: year + 180, text: '雨夜，有人携图籍出奔南海。' },
      ];
      return { seed, year, a: A, b: B, city: civ.settlements[city].name, region: regionLabel(civ, region), plots };
    }
  }
  return null;
}
