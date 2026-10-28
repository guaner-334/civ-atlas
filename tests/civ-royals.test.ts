/**
 * 君主的诸子、养子和争储(gen/civ/royals.ts,people.ts 里排统帅、继位时用):
 * 儿子的年纪对得上父亲、兄弟错开;成年的王子替父出征、进统帅名单;即位以前领过兵的君主就是先君的儿子;
 * 争储杀掉的宗室卒于新君即位那一刻,编年史的继位那一句写上;干预某一年之前领过兵的宗室不变。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { buildChronicle, reignEntries } from '../src/gen/civ/chronicle';
import { personKey, polityKey, resolvePersonKey } from '../src/gen/edits';
import { princeRef, princeTitle } from '../src/gen/civ/peopleText';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
}
const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
}

describe.each([7, 2024])('诸子 · seed=%i', (seed) => {
  it('儿子:同一国、同一朝;养子比养父小 14 岁以上;兄弟出生几乎都错开一年以上;有三个以上儿子的君主不少', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    const kids = new Map<number, Person[]>();
    for (const x of P) if (x.parent !== undefined && P[x.parent].role === 'ruler') kids.set(x.parent, [...(kids.get(x.parent) ?? []), x]);
    let many = 0;
    let adopted = 0;
    let twins = 0;
    let pairs = 0;
    for (const [f, ks] of kids) {
      const father = P[f];
      const sons = ks.filter((k) => k.role === 'prince' && !(k.commands === undefined && P.some((o) => o.parent === k.id && o.role === 'ruler')));
      if (sons.length + ks.filter((k) => k.role === 'ruler').length >= 3) many++;
      for (const k of ks) {
        // 据地争位、自立为君的(推演里的 split,cause = heir)在自己立的国
        if (k.claim?.how === 'secede') {
          expect(civ.polities[k.polity].parent).toBe(father.polity);
          expect(k.from).toBe(father.until);
          continue;
        }
        expect(k.polity).toBe(father.polity);
        expect(k.dynasty ?? 0).toBe(father.dynasty ?? 0);
        if (k.adopted) {
          adopted++;
          expect(k.born - father.born).toBeGreaterThanOrEqual(14 - 1 / 128);
        }
      }
      // 诸子之间错开一年以上;兄终弟及时接上的那一位按年纪连成儿子,偶尔和某个兄弟同年生(双生)
      const bs = ks.map((k) => k.born).sort((a, b) => a - b);
      for (let i = 1; i < bs.length; i++) if (bs[i] - bs[i - 1] < 1) twins++;
      pairs += bs.length - 1;
    }
    // 20 个种子(12000 个地块)里同年生的兄弟占 3%–6%(种子 7 在 5.5% 上下;GENERATOR_VERSION 39 以后种子 2024 在 5.2% 上下)
    expect(twins).toBeLessThan(pairs * 0.06);
    expect(many).toBeGreaterThan(50);
    expect(adopted).toBeGreaterThan(5);
  });

  it('王子领兵:领兵时 16–60 岁、在世,父亲(或兄长)正在位;王子进统帅名单,也有战死的', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    let princeCmds = 0;
    let generalCmds = 0;
    let fell = 0;
    for (const x of P) {
      if (x.role === 'general') generalCmds += x.commands?.length ?? 0;
      if (x.role !== 'prince' || !x.commands) continue;
      princeCmds += x.commands.length;
      if (x.fate === 'battle') fell++;
      const f = P[x.parent!];
      for (const c of x.commands) {
        const age = c.from - x.born;
        expect(age).toBeGreaterThanOrEqual(16 - 1e-9);
        expect(age).toBeLessThanOrEqual(60 + 1e-9);
        if (x.died !== undefined) expect(c.until).toBeLessThanOrEqual(x.died);
        // 派他出征的:父亲,或者父亲的继位者(他的兄弟)
        const ruler = P.find((r) => r.role === 'ruler' && r.polity === x.polity && r.from! <= c.from && (r.until === undefined || c.from < r.until));
        expect(ruler, x.name).toBeDefined();
        const prev = P.find((r) => r.role === 'ruler' && r.polity === x.polity && r.until === ruler!.from);
        expect(ruler!.id === f.id || prev?.id === f.id, x.name).toBe(true);
      }
    }
    expect(princeCmds).toBeGreaterThan(30);
    expect(princeCmds).toBeLessThan(generalCmds);
    expect(fell).toBeGreaterThan(0);
  });

  it('即位以前领过兵的君主:是先君的儿子(继位的,或据地自立的)', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    let n = 0;
    for (const x of P) {
      if (x.role !== 'ruler' || !x.commands?.some((c) => c.from < x.from!)) continue;
      n++;
      expect(x.rise === 'heir' || x.claim?.how === 'secede').toBe(true);
      const f = P[x.parent!];
      expect(f.role).toBe('ruler');
      expect(f.until).toBe(x.from);
    }
    expect(n).toBeGreaterThan(5);
    // 下台(被废、让位、亡国)以后不再领兵,即位以前就出征的那一仗也一样
    for (const x of P) if (x.role === 'ruler' && x.until !== undefined) for (const c of x.commands ?? []) expect(c.until, x.name).toBeLessThanOrEqual(x.until);
  });

  it('预定的继承人:推到他即位以前记下的宗室键,即位以后还找得到他(往回推也一样)', () => {
    const civ = civOf(seed);
    const heirs = civ.people!.filter((x) => x.role === 'ruler' && x.rise === 'heir' && x.parent !== undefined);
    expect(heirs.length).toBeGreaterThan(10);
    for (const x of heirs.slice(0, 20)) {
      const key = personKey(civ, x.id);
      expect(key).toContain('|ruler|');
      expect(resolvePersonKey(civ, key.replace('|ruler|', '|prince|'))).toBe(x.id);
    }
  });

  it('争储:杀掉的宗室卒于新君即位那一刻;以军功得立的越过的是还在世的兄长;编年史那一句写上对手', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    const reigns = new Map(reignEntries(civ).map((e) => [e.id - civ.annals.length, e]));
    const hows = new Set<string>();
    let n = 0;
    for (const x of P) {
      // 据地自立、引兵入朝(先君在位时就杀了兄弟)、摄政篡位不是即位那一刻的争储(后两样见 civ-regency.test.ts)
      if (!x.claim || x.claim.how === 'secede' || x.claim.how === 'march' || x.claim.how === 'seize') continue;
      n++;
      hows.add(x.claim.how);
      const e = reigns.get(x.id)!;
      expect(e, x.name).toBeDefined();
      expect(x.claim.rivals.length).toBeGreaterThan(0);
      for (const id of x.claim.rivals) {
        const r = P[id];
        expect(r.role).toBe('prince');
        expect(r.polity).toBe(x.polity);
        expect(e.people).toContain(id);
        expect(e.text).toContain(r.name);
        if (x.claim.how === 'merit') {
          expect(r.born).toBeLessThan(x.born);
          expect(r.died === undefined || r.died > x.from!).toBe(true);
        } else {
          expect(r.fate).toBe('purged');
          expect(r.died).toBe(x.from);
          expect(r.rival).toBe(x.id);
        }
      }
      // 争的人里有女的换说法("兄妹争立""王子公主争位"……)
      if (x.claim.how === 'coup' || x.claim.how === 'intrigue') expect(e.text).toMatch(/(诸子|兄妹|诸女)争立|(诸子|王子公主|诸公主)争位/);
    }
    expect(n).toBeGreaterThan(10);
    // 以军功得立、举兵夺位、宫中争立至少两种(GENERATOR_VERSION 40 时种子 7 只有两种)
    expect(hows.size).toBeGreaterThanOrEqual(2);
    // 争储、引兵入朝被杀的,杀他的那位记着他(掌实权伏诛的叔父、大将不算,rival 是诛他的君主)
    for (const x of P) if (x.fate === 'purged' && !x.regencies) expect(P[x.rival!].claim?.rivals).toContain(x.id);
  });
});

describe('诸子 · 只往前看', () => {
  it('干预某一年之前领过兵、出生的宗室,名字、生年、领兵的仗和不干预时一样', () => {
    const civ = civOf(7);
    const y0 = 1900;
    const alive = civ.polities.filter((p) => p.founded < y0 && (p.ended ?? Infinity) > y0);
    const c = generateCiv(world(7), { interventions: [{ kind: 'declare', a: polityKey(civ, alive[0].id), b: polityKey(civ, alive[1].id), from: y0 }] });
    const before = (x: Civ) =>
      x.people!
        .filter((p) => p.commands?.some((k) => k.until < y0) && (p.role === 'prince' || (p.role === 'ruler' && p.from! > p.commands[0].from)))
        .map((p) => [p.polity, p.name, p.born, p.commands!.filter((k) => k.until < y0).map((k) => [k.war, k.side, k.from, k.until])]);
    const a = before(civ);
    expect(a.length).toBeGreaterThan(10);
    expect(JSON.stringify(before(c))).toBe(JSON.stringify(a));
  });
});

describe.each([7, 2024])('据地争位 · seed=%i', (seed) => {
  it('推演里的宗室争位:新国家的开国之君就是先君之子(生年 = Polity.prince),不服的是同一刻即位的新君;编年史写上', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    const entries = buildChronicle(civ);
    let n = 0;
    let sons = 0;
    for (const e of civ.annals) {
      if (e.kind !== 'split' || e.cause !== 'heir') continue;
      n++;
      const p = civ.polities[e.a];
      expect(p.prince).toBeDefined();
      expect(p.parent).toBe(e.b);
      // 紧跟着记讨伐他的那一仗
      expect(civ.annals.some((w) => w.kind === 'war' && w.cause === 'heir' && w.a === e.b && w.b === e.a && w.year === e.year)).toBe(true);
      const F = P.find((x) => x.role === 'ruler' && x.polity === e.a)!;
      expect(F.from).toBe(e.year);
      expect(F.born).toBe(p.prince);
      expect(F.claim?.how).toBe('secede');
      const X = P[F.claim!.rivals[0]];
      expect(X.polity).toBe(e.b);
      expect(X.from).toBe(e.year);
      if (F.parent !== undefined) {
        sons++;
        const R = P[F.parent];
        expect(R.polity).toBe(e.b);
        expect(R.until).toBe(e.year);
        expect(e.year - F.born).toBeGreaterThanOrEqual(20);
        // 立国以前替父亲出征时,称呼照父亲那国("大昌皇子李昭",不写后来自立的国号)
        for (const c of F.commands ?? []) {
          if (c.from >= e.year) continue;
          expect(princeRef(civ, F, c.from)).toBe(princeRef(civ, { ...F, polity: e.b }, c.from));
          expect(princeTitle(civ, F, c.from)).not.toBe('宗室');
        }
      }
      const t = entries.find((x) => x.kind === 'split' && x.year === e.year && x.polities.includes(e.a));
      expect(t?.text).toContain(F.name);
      expect(t?.text).toContain(X.name);
      expect(t?.text).toMatch(/不服.*即位/);
    }
    expect(n).toBeGreaterThan(2);
    expect(sons).toBeGreaterThan(n / 2);
  });
});
