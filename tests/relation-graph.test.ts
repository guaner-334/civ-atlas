/**
 * 人物关系图(ui/relationInfo.ts 取数、ui/relationLayout.ts 摆法):分簇、"还有 N 位"、不到 5 位自动多看一层、作者人物的亲友按字归簇;
 * 摆出来一簇不超过 8 格、人不叠在一起。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import type { AuthorCharacter } from '../src/gen/characters';
import { personKey } from '../src/gen/edits';
import { fatherOf, kidsOf } from '../src/gen/civ/lineageInfo';
import { personName } from '../src/gen/civ/peopleText';
import { DEEP_BELOW, DEEP_PER_VIA, INLAW_ORDER, byWord, charKinSlot, personTies, relationGraph, type RelGraph, type RelNode } from '../src/ui/relationInfo';
import { BLOCK_W, capped, clusterOrder, deskLayout, stackLayout, upRow, type Layout } from '../src/ui/relationLayout';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))));
  return c;
}

const graphOf = (civ: Civ, x: Person, deep: boolean | null = null, chars: AuthorCharacter[] = []) => relationGraph(civ, chars, { kind: 'person', id: x.id }, { deep })!;

/** 一格假人(测"还有 N 位"的先后用) */
const fake = (i: number, o: Partial<RelNode> = {}): RelNode => ({
  k: `p${i}`,
  ref: { kind: 'person', id: i },
  name: `人${i}`,
  cluster: 'court',
  slot: 'court',
  word: '将领',
  tag: '',
  clash: false,
  sub: '',
  why: [],
  role: '',
  years: '',
  prince: false,
  ruler: false,
  color: null,
  polity: 0,
  born: 1000 + i,
  fame: 0,
  sort: 1000 + i,
  dim: false,
  via: null,
  ...o,
});

describe('按字归簇', () => {
  it('照稿子的先后认:"师父"进师友、"姐夫"进姻亲、"杀父仇人"进对手,认不出的进其他', () => {
    const want: [string, string][] = [
      ['宿敌', 'rival'],
      ['杀父仇人', 'rival'],
      ['对手', 'rival'],
      ['师父', 'friend'],
      ['挚友', 'friend'],
      ['同窗', 'friend'],
      ['姐夫', 'inlaw'],
      ['妻子', 'inlaw'],
      ['岳父', 'inlaw'],
      ['主君', 'court'],
      ['部将', 'court'],
      ['门客', 'court'],
      ['幕僚', 'court'],
      ['父亲', 'blood'],
      ['兄长', 'blood'],
      ['侄子', 'blood'],
      ['舅舅', 'blood'],
      ['旧识', 'other'],
      ['故人', 'other'],
    ];
    for (const [rel, cl] of want) expect([rel, byWord(rel)]).toEqual([rel, cl]);
  });
  it('血亲按字摆:父母叔伯在上、兄弟姐妹同辈、儿女孙侄在下', () => {
    expect(['父亲', '母亲', '叔父', '祖父', '舅舅'].map(charKinSlot)).toEqual(['up', 'up', 'up', 'up', 'up']);
    expect(['兄长', '弟弟', '姐姐', '表妹'].map(charKinSlot)).toEqual(['same', 'same', 'same', 'same']);
    expect(['儿子', '女儿', '孙子', '侄女', '养子'].map(charKinSlot)).toEqual(['down', 'down', 'down', 'down', 'down']);
  });
});

describe('上一辈那一排', () => {
  const center = { k: 'p0', ref: { kind: 'person' as const, id: 0 }, name: '中', role: '', color: null, polity: 0 };
  const dad = fake(1, { cluster: 'blood', slot: 'up', word: '父', born: 1000 });
  const elder = fake(2, { cluster: 'blood', slot: 'up', word: '伯父', born: 990, ruler: true, fame: 99, clash: true });
  const younger = fake(3, { cluster: 'blood', slot: 'up', word: '叔父', born: 1010 });
  it('父亲在正中、一定画出来;别的长辈按生年分到两边,放不下的收进"还有 N 位"', () => {
    expect(upRow([younger, elder, dad], 3).cells.map((c) => [c.n?.word ?? '+', c.dx])).toEqual([
      ['父', 0],
      ['伯父', -1],
      ['叔父', 1],
    ]);
    const two = upRow([younger, elder, dad], 2);
    expect(two.cells.map((c) => [c.n?.word ?? '+', c.dx])).toEqual([
      ['父', 0],
      ['+', 1],
    ]);
    expect(two.more).toBe(2);
    // 作者人物写的父母:父亲正中,母亲在他右边
    const mom = fake(4, { cluster: 'blood', slot: 'up', word: '母亲', born: 1003 });
    expect(upRow([mom, fake(5, { cluster: 'blood', slot: 'up', word: '父亲', born: 1001 })], 3).cells.map((c) => [c.n?.word, c.dx])).toEqual([
      ['父亲', 0],
      ['母亲', 1],
    ]);
  });
  it('家谱线只从父亲连下来(叔伯不连),电脑、手机都是', () => {
    const g: RelGraph = { center, nodes: [younger, elder, dad, fake(6, { cluster: 'blood', slot: 'same', word: '兄', born: 1020 })], own: 4, more: 0, empty: '' };
    const L = deskLayout(g, 1188, 816, 280);
    const at = (k: string) => L.nodes.find((l) => l.n.k === k)!;
    expect(at('p1').x).toBe(L.cx);
    const downs = L.edges.filter((e) => e.d.startsWith('M') && e.d.includes(`V${L.cy - 214}`) && /^M[\d.]+ [\d.]+V/.test(e.d) && !e.d.includes('H'));
    const fromUp = downs.filter((e) => Number(/^M[\d.]+ ([\d.]+)/.exec(e.d)![1]) < L.cy - 214);
    expect(fromUp.map((e) => Number(/^M([\d.]+)/.exec(e.d)![1]))).toEqual([at('p1').x]);
    const S = stackLayout(g, 390, 0);
    expect(S.nodes.find((l) => l.n.k === 'p1')!.x).toBe(S.cx);
  });
});

describe('还有 N 位', () => {
  it('放得下全画;放不下留 cap−1 格,先留即位的、有冲突的、名气大的,先后不变', () => {
    const list = Array.from({ length: 10 }, (_, i) => fake(i, { ruler: i === 9, clash: i === 8, fame: i === 7 ? 50 : 0 }));
    expect(capped(list.slice(0, 8), 8, clusterOrder('court')).more).toBe(0);
    const C = capped(list, 8, clusterOrder('court'));
    expect(C.shown).toHaveLength(7);
    expect(C.more).toBe(3);
    expect(C.all).toHaveLength(10);
    expect(C.shown.map((n) => n.k)).toContain('p9');
    expect(C.shown.map((n) => n.k)).toContain('p8');
    expect(C.shown.map((n) => n.k)).toContain('p7');
    for (let i = 1; i < C.shown.length; i++) expect(C.shown[i].sort).toBeGreaterThan(C.shown[i - 1].sort);
  });
  it('多看一层的人排在自己的关系后面,先被收进"还有 N 位"', () => {
    const list = [fake(1, { dim: true, fame: 99 }), fake(2), fake(3), fake(4, { dim: true })];
    const C = capped(list, 3, clusterOrder('court'));
    expect(C.shown.map((n) => n.k)).toEqual(['p2', 'p3']);
    expect(C.more).toBe(2);
  });
  it('姻亲按外祖父、岳父、女婿、外孙排(多看一层的"父亲的女婿"按最后的称呼)', () => {
    const order = clusterOrder('inlaw');
    const list = [fake(1, { word: '外孙' }), fake(2, { word: '父亲的女婿' }), fake(3, { word: '岳父' }), fake(4, { word: '外祖父' })];
    expect([...list].sort(order).map((n) => n.word)).toEqual(['外祖父', '岳父', '父亲的女婿', '外孙']);
  });
});

/** 摆出来的人两两不叠(头像加名字两行大约 104 × 84 的一块) */
function noOverlap(L: Layout): string[] {
  const cells = [...L.nodes.map((l) => ({ k: l.n.k, x: l.x, y: l.y })), ...L.mores.map((m) => ({ k: m.k, x: m.x, y: m.y }))];
  const bad: string[] = [];
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i];
      const b = cells[j];
      if (Math.abs(a.x - b.x) < 80 && Math.abs(a.y - b.y) < 80) bad.push(`${a.k}/${b.k}`);
    }
  return bad;
}

describe.each([7, 2024])('关系图 · seed=%i', (seed) => {
  it('每个人:不重复、不含他自己;血亲的称呼和世系对得上;姻亲、对手的词对得上', () => {
    const civ = civOf(seed);
    let rich = 0;
    for (const x of civ.people!) {
      const g = graphOf(civ, x, false);
      expect(g.nodes).toHaveLength(g.own);
      const keys = new Set(g.nodes.map((n) => n.k));
      expect(keys.size).toBe(g.nodes.length);
      expect(keys.has(`p${x.id}`)).toBe(false);
      expect(g.empty === '').toBe(g.own > 0);
      const f = fatherOf(civ, x);
      if (f) expect(g.nodes.find((n) => n.k === `p${f.id}`)?.word).toMatch(/^养?父$/);
      for (const k of kidsOf(civ, x)) expect(g.nodes.find((n) => n.k === `p${k.id}`)?.slot).toBe('down');
      for (const n of g.nodes) {
        if (n.cluster === 'inlaw') expect(INLAW_ORDER).toContain(n.word);
        if (n.cluster === 'rival') expect(['对阵', '争储', '对手', '放逐', '权臣']).toContain(n.word);
        if (n.cluster === 'blood') expect(['up', 'same', 'down']).toContain(n.slot);
        if (n.tag) expect(n.clash).toBe(true);
        expect(n.why.length).toBeGreaterThan(0);
      }
      if (g.own >= 12) rich++;
    }
    expect(rich).toBeGreaterThan(5);
  });

  it(`自己的关系不到 ${DEEP_BELOW} 位自动多看一层(淡的、经过第一圈的人),能收起;关系多的不自动`, () => {
    const civ = civOf(seed);
    let auto = 0;
    for (const x of civ.people!) {
      const g = graphOf(civ, x);
      const dims = g.nodes.filter((n) => n.dim);
      if (g.own >= DEEP_BELOW || !g.own) {
        expect(dims).toHaveLength(0);
        continue;
      }
      expect(dims).toHaveLength(g.more);
      if (g.more) auto++;
      const first = new Set(g.nodes.filter((n) => !n.dim).map((n) => n.k));
      const per = new Map<string, number>();
      for (const n of dims) {
        expect(first.has(n.via!)).toBe(true);
        const k = `${n.via}|${n.cluster}`;
        per.set(k, (per.get(k) ?? 0) + 1);
      }
      for (const v of per.values()) expect(v).toBeLessThanOrEqual(DEEP_PER_VIA);
      expect(graphOf(civ, x, false).nodes.some((n) => n.dim)).toBe(false);
    }
    expect(auto).toBeGreaterThan(20);
  });

  it('电脑上摆出来:一簇最多 8 格,"还有 N 位"加上画出来的正好是这一簇的人数;人不叠在一起,都在图里', () => {
    const civ = civOf(seed);
    const people = civ.people!.map((x) => ({ x, n: personTies(civ, x).length })).sort((a, b) => b.n - a.n);
    // 关系最多的几位(打开、多看一层)、关系少的几位
    const picks = [...people.slice(0, 6), ...people.filter((p) => p.n > 0 && p.n < DEEP_BELOW).slice(0, 6)];
    for (const { x } of picks) {
      for (const deep of [null, true]) {
        const g: RelGraph = graphOf(civ, x, deep);
        for (const [W, H] of [
          [1188, 816],
          [954, 684],
        ]) {
          const L = deskLayout(g, W, H, 280);
          for (const b of L.blocks) {
            const inBlock = L.nodes.filter((l) => l.x > b.x && l.x < b.x + BLOCK_W && l.y > b.y && l.y < b.y + b.h && l.n.cluster === b.cluster);
            const more = L.mores.find((m) => m.k === `more-${b.cluster}`);
            expect(inBlock.length + (more ? 1 : 0)).toBeLessThanOrEqual(8);
            expect(inBlock.length + (more?.count ?? 0)).toBe(b.count);
          }
          for (const m of L.mores) expect(m.list.length).toBeGreaterThanOrEqual(m.count);
          expect([personName(civ, x), deep, W, noOverlap(L)]).toEqual([personName(civ, x), deep, W, []]);
          for (const l of L.nodes) {
            expect(l.x - 41).toBeGreaterThanOrEqual(0);
            expect(l.x + 41).toBeLessThanOrEqual(W);
            expect(l.y - l.size / 2).toBeGreaterThanOrEqual(0);
            expect(l.y + 60).toBeLessThanOrEqual(L.height);
          }
        }
        // 手机:家谱里的人也不叠,下面一簇一条把剩下的人全列出来
        const S = stackLayout(g, 390, 0);
        expect(noOverlap(S)).toEqual([]);
        const listed = new Set([...S.nodes.map((l) => l.n.k), ...S.mores.flatMap((m) => m.list.map((n) => n.k)), ...S.strips.flatMap((s) => s.list.map((n) => n.k))]);
        expect(g.nodes.filter((n) => n.slot !== 'up2' && !listed.has(n.k))).toEqual([]);
      }
    }
  });

  it('作者的人物:推演人物的图上单独一簇;作者人物居中时亲友按字归簇,经历里勾到的人单独一簇', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    const rich = P.map((x) => ({ x, t: personTies(civ, x) })).find(({ t }) => t.some((u) => u.word === '父') && t.some((u) => u.cluster === 'rival'))!;
    const x = rich.x;
    const f = P[rich.t.find((u) => u.word === '父')!.id];
    const foe = P[rich.t.find((u) => u.cluster === 'rival')!.id];
    const other = P.find((o) => o.polity !== x.polity && o.role === 'general' && o !== foe && o !== f)!;
    const chars: AuthorCharacter[] = [
      {
        id: 1,
        name: '甲',
        color: 'purple',
        born: x.born + 20,
        kin: [
          { rel: '父亲', person: personKey(civ, x.id) },
          { rel: '祖父', person: personKey(civ, f.id) },
          { rel: '师父', char: 2 },
          { rel: '杀父仇人', person: personKey(civ, foe.id) },
          { rel: '旧识', person: personKey(civ, other.id) },
        ],
        life: [{ year: x.born + 40, text: '随军，与其他人同行', people: [personKey(civ, other.id), personKey(civ, f.id)] }],
      },
      { id: 2, name: '乙', color: 'teal', born: x.born, kin: [{ rel: '主君', person: personKey(civ, x.id) }] },
    ];
    const g = graphOf(civ, x, false, chars);
    const auth = g.nodes.filter((n) => n.cluster === 'author');
    expect(auth.map((n) => [n.k, n.word])).toEqual([
      ['c1', '父亲是他'],
      ['c2', '主君是他'],
    ]);
    expect(auth[0].color).toBeTruthy();
    expect(auth[1].why[0]).toBe(`乙的亲友里写着：主君是${personName(civ, x)}`);
    // 作者写的字里的"他"不换("其他人")
    const viaF = graphOf(civ, f, false, chars).nodes.find((n) => n.k === 'c1')!;
    expect(viaF.why.some((t) => t.endsWith('随军，与其他人同行'))).toBe(true);

    const c = relationGraph(civ, chars, { kind: 'character', id: 1 }, { deep: false })!;
    const at = (k: string) => c.nodes.find((n) => n.k === k)!;
    expect([at(`p${x.id}`).cluster, at(`p${x.id}`).slot, at(`p${x.id}`).word]).toEqual(['blood', 'up', '父亲']);
    expect([at(`p${f.id}`).cluster, at(`p${f.id}`).slot]).toEqual(['blood', 'up']);
    expect([at('c2').cluster, at('c2').word]).toEqual(['friend', '师父']);
    expect(at(`p${foe.id}`).cluster).toBe('rival');
    // 旧识也在经历里:按亲友归"其他",经历那一句并进说明里
    expect(at(`p${other.id}`).cluster).toBe('other');
    expect(at(`p${other.id}`).why.some((t) => t.includes('随军'))).toBe(true);
    expect(c.own).toBe(5);
    // 只在经历里写到的
    const c2 = relationGraph(civ, [{ ...chars[0], kin: [] }], { kind: 'character', id: 1 }, { deep: false })!;
    expect(c2.nodes.map((n) => [n.k, n.cluster, n.slot])).toEqual([
      [`p${other.id}`, 'story', 'story'],
      [`p${f.id}`, 'story', 'story'],
    ]);
    // 一个都没写
    const c3 = relationGraph(civ, [{ id: 3, name: '丙', color: 'red', born: 100 }], { kind: 'character', id: 3 })!;
    expect(c3.own).toBe(0);
    expect(c3.empty).not.toBe('');
  });
});
