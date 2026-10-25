/**
 * 数表引擎(gen/civ/tables):公式语言拆得对、写错了说得清哪里错;按频率算、读"这一步开头"的值;
 * 两种跑法(拼函数 / 闭包)逐位一样;搬家总量不变、流向记得上;全 0 跳过和全算一样;护栏拦得住不是数和震荡;
 * 快照接上和一口气算完一样;随机数和先后无关。用一张小网格当地块、4×4 一块当州,不用生成世界。
 */
import { describe, expect, it } from 'vitest';
import { parseFormula, FormulaError, TableEngine, TableSetupError, budgetOf, cardProblems, type TableCard, type EngineUnits, type Backend } from '../src/gen/civ/tables';

/** W × H 的环面网格(四邻),每 B × B 一个州 */
function grid(W = 16, H = 12, B = 4): EngineUnits & { W: number; H: number } {
  const n = W * H;
  const adjStart = new Int32Array(n + 1);
  const adj: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      adjStart[i] = adj.length;
      adj.push(y * W + ((x + W - 1) % W), y * W + ((x + 1) % W), ((y + H - 1) % H) * W + x, ((y + 1) % H) * W + x);
    }
  }
  adjStart[n] = adj.length;
  const RW = W / B;
  const RH = H / B;
  const R = RW * RH;
  const of = new Int32Array(n);
  for (let i = 0; i < n; i++) of[i] = Math.floor(Math.floor(i / W) / B) * RW + Math.floor((i % W) / B);
  // 第 0 个地块当海
  of[0] = -1;
  const cellsOf: number[][] = Array.from({ length: R }, () => []);
  for (let i = 0; i < n; i++) if (of[i] >= 0) cellsOf[of[i]].push(i);
  const cellStart = new Int32Array(R + 1);
  const cells: number[] = [];
  cellsOf.forEach((c, r) => {
    cellStart[r] = cells.length;
    cells.push(...c);
  });
  cellStart[R] = cells.length;
  const radj: number[][] = Array.from({ length: R }, () => []);
  for (let i = 0; i < n; i++) {
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
      const a = of[i];
      const b = of[adj[q]];
      if (a >= 0 && b >= 0 && a !== b && !radj[a].includes(b)) radj[a].push(b);
    }
  }
  const rStart = new Int32Array(R + 1);
  const rAdj: number[] = [];
  radj.forEach((l, r) => {
    rStart[r] = rAdj.length;
    rAdj.push(...l.sort((x, y) => x - y));
  });
  rStart[R] = rAdj.length;
  const adjKind = new Uint8Array(rAdj.length).map((_, k) => k % 3);
  return {
    W,
    H,
    tile: { count: n, adjStart, adj: Int32Array.from(adj) },
    region: {
      count: R,
      adjStart: rStart,
      adj: Int32Array.from(rAdj),
      adjKind,
      adjLen: new Float32Array(rAdj.length).fill(10),
      seat: Int32Array.from(cellsOf.map((c) => c[0])),
      of,
      cellStart,
      cells: Int32Array.from(cells),
    },
  };
}

const habitat: TableCard = { id: 'hab', name: '宜居度', unit: 'tile', input: true, min: 0, max: 40, off: 0 };
const owner: TableCard = { id: 'owner', name: '归哪国', unit: 'region', kind: 'id', min: -1, max: 1e6, off: -1 };

/** 填输入表:宜居度按位置起伏,州 → 国:左半归 0 国、右半归 1 国、最后一州没有国 */
function fill(e: TableEngine, u: ReturnType<typeof grid>) {
  if (e.cards.some((c) => c.id === 'hab')) {
    const h = e.input('hab');
    for (let i = 0; i < h.length; i++) h[i] = i === 0 ? 0 : 5 + ((i * 7919) % 31);
  }
  if (e.cards.some((c) => c.id === 'owner')) {
    e.setPolities(2, [1001, 2002]);
    const o = e.input('owner');
    const R = u.region!.count;
    for (let r = 0; r < R; r++) o[r] = r === R - 1 ? -1 : r % 4 < 2 ? 0 : 1;
  }
}

/** 人口:按宜居度的 S 形增长,往人少的邻格搬 */
const pop: TableCard = {
  id: 'pop',
  name: '人口',
  unit: 'tile',
  min: 0,
  max: 1e6,
  off: 0,
  init: 'if(hab > 30, 2, 0)',
  rate: 'let cap = hab * 10\nif(cap > 0, 0.02 * pop * (1 - pop / cap), -0.1 * pop)',
  move: 'max(0, pop - nb.pop) * 0.01 * if(nb.hab > 0, 1, 0)',
  flowEvery: 20,
  zeroStays: true,
};

function run(cards: TableCard[], years: number[], backend: Backend = 'js', u = grid()) {
  const e = new TableEngine({ seed: 7, cards: [habitat, owner, ...cards], units: u, owner: 'owner', backend });
  fill(e, u);
  e.start(0);
  for (const y of years) e.step(y);
  return e;
}

const yearsTo = (n: number, every = 1) => Array.from({ length: Math.floor(n / every) + 1 }, (_, i) => i * every);

describe('公式语言', () => {
  it('拆得出中间量和结果,运算符有先后', () => {
    const p = parseFormula('let a = 1 + 2 * 3\n// 注释\nlet b = -a ^ 2  # 乘方先算\na < b and not (b == 3)');
    expect(p.lets.map((l) => l.name)).toEqual(['a', 'b']);
    expect(p.result.k).toBe('bin');
  });
  it('括号里、运算符后面换行算接着写;分号也能分句', () => {
    expect(parseFormula('max(1,\n 2) +\n 3').lets.length).toBe(0);
    expect(parseFormula('let x = 1; x + 1').lets.length).toBe(1);
  });
  it('汉字名字也行', () => {
    expect(parseFormula('let 增长 = 人口 * 0.1\n人口 + dt * 增长').lets[0].name).toBe('增长');
  });
  it('写错了说清在第几行第几个字', () => {
    expect(() => parseFormula('let a = 1\nlet b = (a + \n')).toThrow(FormulaError);
    expect(() => parseFormula('1 + $')).toThrow(/认不出「\$」.*第 1 行第 5 个字/);
    expect(() => parseFormula('let a = 1')).toThrow(/最后一行要写出结果/);
    expect(() => parseFormula('1 < 2 < 3')).toThrow(/比较不能连着写/);
    expect(() => parseFormula('1\n2')).toThrow(/结果只能有一句/);
  });
});

describe('规则查得出写错', () => {
  const bad = (rule: string, extra: Partial<TableCard> = {}) => () => run([{ id: 'x', name: '试验', unit: 'region', min: -1e9, max: 1e9, off: 0, rule, ...extra }], [0]);
  it('不认识的名字、细的表直接读、编号表做算术、多栏表没写栏', () => {
    expect(bad('foo + 1')).toThrow(/不认识「foo」/);
    expect(bad('hab')).toThrow(/比州细,要用 sumof/);
    expect(bad('owner + 1')).toThrow(/编号表/);
    expect(() =>
      run(
        [
          { id: 'm', name: '多栏', unit: 'region', cols: ['a', 'b'], min: 0, max: 1, off: 0, rule: 'm' },
          { id: 'x', name: '试验', unit: 'region', min: 0, max: 1, off: 0, rule: 'm' },
        ],
        [0],
      ),
    ).toThrow(/有 2 栏,要写成 m\.栏名/);
  });
  it('读了卡上没写的表、函数参数个数不对、nb 写在邻格函数外面', () => {
    expect(bad('meanof(hab)', { reads: ['owner'] })).toThrow(/读哪些表.*没写它/);
    expect(bad('clamp(1, 2)')).toThrow(/clamp\(…\) 要 3 个参数/);
    expect(bad('nb.x')).toThrow(/只能写在 nbsum/);
  });
  it('一次把所有写错的卡都报出来', () => {
    try {
      run(
        [
          { id: 'x', name: '甲', unit: 'region', min: 0, max: 1, off: 0, rule: 'foo' },
          { id: 'y', name: '乙', unit: 'region', min: 0, max: 1, off: 0, rule: 'bar' },
        ],
        [0],
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TableSetupError);
      expect((e as TableSetupError).problems).toHaveLength(2);
    }
  });
  it('卡本身的毛病:频率不在菜单里、没有上下限、编号表带规则', () => {
    expect(cardProblems({ id: 'a', name: '甲', unit: 'tile', every: 3, min: 0, max: 1, off: 0, rule: '1' }).join()).toMatch(/频率只能从/);
    expect(cardProblems({ id: 'a', name: '甲', unit: 'tile', min: 0, max: NaN, off: 0, rule: '1' }).join()).toMatch(/上下限/);
    expect(cardProblems({ id: 'a', name: '甲', unit: 'region', kind: 'id', min: -1, max: 9, off: -1, rule: '1' }).join()).toMatch(/编号表/);
    expect(cardProblems({ id: '1a', name: '甲', unit: 'tile', min: 0, max: 1, off: 0, rule: '1' }).join()).toMatch(/不以数字开头/);
  });
  it('速度额度:按地块每年算的栏超了要提醒', () => {
    const many = Array.from({ length: 41 }, (_, i): TableCard => ({ id: `t${i}`, name: `表${i}`, unit: 'tile', min: 0, max: 1, off: 0, rule: '0' }));
    expect(budgetOf(many).warnings.length).toBe(1);
    expect(budgetOf(many.map((c) => ({ ...c, every: 5 }))).warnings.length).toBe(0);
    expect(budgetOf(many.map((c) => ({ ...c, every: 5 }))).tile).toBeCloseTo(8.2);
  });
});

describe('引擎', () => {
  it('第一步 dt 是 0;rule 和 rate 写法结果一样', () => {
    const a = run([{ id: 'x', name: '甲', unit: 'tile', min: 0, max: 100, off: 0, init: 1, rule: 'x + dt * 0.5 * x' }], yearsTo(5));
    const b = run([{ id: 'x', name: '甲', unit: 'tile', min: 0, max: 100, off: 0, init: 1, rate: '0.5 * x' }], yearsTo(5));
    expect(a.value('x', 3)).toBe(1.5 ** 5);
    expect(Array.from(a.get('x'))).toEqual(Array.from(b.get('x')));
  });
  it('按频率算:每 5 年的表只在 5 的倍数年算,dt = 5', () => {
    const e = run([{ id: 'x', name: '甲', unit: 'world', every: 5, min: 0, max: 1e9, off: 0, init: 0, rule: 'x + dt' }], yearsTo(12));
    expect(e.value('x', 0)).toBe(10);
  });
  it('所有表读的是这一步开头的值:先后顺序不影响结果', () => {
    const a: TableCard = { id: 'a', name: '甲', unit: 'region', min: -1e9, max: 1e9, off: 0, init: 1, rule: 'b + 1' };
    const b: TableCard = { id: 'b', name: '乙', unit: 'region', min: -1e9, max: 1e9, off: 0, init: 10, rule: 'a * 2' };
    const x = run([a, b], yearsTo(4));
    const y = run([b, a], yearsTo(4));
    expect(x.value('a', 2)).toBe(y.value('a', 2));
    expect(x.value('b', 2)).toBe(y.value('b', 2));
    // 第 1 步:a = 10 + 1,b = 1 × 2(都读开头的值)
    const z = run([a, b], [0]);
    expect([z.value('a', 0), z.value('b', 0)]).toEqual([11, 2]);
  });
  it('after:同一年排在后面算,读到前面刚算完的新值;prev 读这一步开头的值;没写 after 的照旧读开头的值', () => {
    const a: TableCard = { id: 'a', name: '甲', unit: 'region', min: -1e9, max: 1e9, off: 0, init: 1, rule: 'a + 1' };
    const b: TableCard = { id: 'b', name: '乙', unit: 'region', min: -1e9, max: 1e9, off: 0, init: 0, rule: 'a * 10 + prev(a)', after: ['a'] };
    const c: TableCard = { id: 'c', name: '丙', unit: 'region', min: -1e9, max: 1e9, off: 0, init: 0, rule: 'b + a', after: ['b'] };
    const d: TableCard = { id: 'd', name: '丁', unit: 'region', min: -1e9, max: 1e9, off: 0, init: 0, rule: 'b' };
    for (const order of [[a, b, c, d], [d, c, b, a]]) {
      const e = run(order, [0]);
      // a:1 → 2;b 读新 a、旧 a:2 × 10 + 1;c 在 b 之后(一路往上也在 a 之后):21 + 2;d 没写 after:读开头的 b = 0
      expect([e.value('a', 1), e.value('b', 1), e.value('c', 1), e.value('d', 1)]).toEqual([2, 21, 23, 0]);
    }
  });
  it('avg 还没攒的时候(第一步)也读这一步开头的值:after 一张不相干的表不改结果', () => {
    const a: TableCard = { id: 'a', name: '甲', unit: 'region', min: 0, max: 100, off: 0, init: 1, rule: 'a + 1' };
    const c: TableCard = { id: 'c', name: '丙', unit: 'region', min: 0, max: 100, off: 0, rule: 'c' };
    const r: TableCard = { id: 'r', name: '读平均', unit: 'region', min: 0, max: 100, off: 0, rule: 'avg(a)' };
    const plain = run([a, c, r], [0]);
    const later = run([a, c, { ...r, after: ['c'] }], [0]);
    expect(plain.value('r', 0)).toBe(1);
    expect(later.value('r', 0)).toBe(1);
    expect(run([a, { ...r, after: ['a'] }], [0]).value('r', 0)).toBe(2);
  });
  it('after 写错了说得清:绕成圈、没有这张表、写的是输入表', () => {
    const t = (id: string, after: string[]): TableCard => ({ id, name: id, unit: 'region', min: 0, max: 1, off: 0, rule: '0', after });
    expect(() => run([t('a', ['b']), t('b', ['a'])], [0])).toThrow(/绕成了圈/);
    expect(() => run([t('a', ['zz'])], [0])).toThrow(/没有这张表/);
    expect(() => run([t('a', ['hab'])], [0])).toThrow(/不是算出来的表/);
    expect(cardProblems(t('a', ['a'])).join()).toMatch(/不能写自己/);
  });
  it('between:每层算完调一次,事件层写进新值,后面的层读到写过的', () => {
    const a: TableCard = { id: 'a', name: '甲', unit: 'region', min: 0, max: 100, off: 0, init: 1, rule: 'a + 1' };
    const b: TableCard = { id: 'b', name: '乙', unit: 'region', min: 0, max: 100, off: 0, init: 0, rule: 'a', after: ['a'] };
    const e = new TableEngine({ seed: 7, cards: [habitat, owner, a, b], units: grid(), owner: 'owner' });
    fill(e, grid());
    e.start(0);
    const seen: string[][] = [];
    e.step(0, (done) => {
      seen.push([...done]);
      if (done.includes('a')) e.write('a', 3, 0, 50);
    });
    expect(seen).toEqual([['a'], ['b']]);
    expect([e.value('b', 3), e.value('b', 2)]).toEqual([50, 2]);
  });
  it('set + resume 接上别处存的状态:和一口气算下去一样', () => {
    const card: TableCard = { id: 'x', name: '甲', unit: 'region', every: 5, min: 0, max: 1e9, off: 0, init: 1, rule: 'x + dt * 0.1 * x + nbmean(nb.x) * 0.01' };
    const ref = run([card], yearsTo(20, 5));
    const mid = run([card], yearsTo(10, 5));
    const e = new TableEngine({ seed: 7, cards: [habitat, owner, card], units: grid(), owner: 'owner' });
    fill(e, grid());
    e.start(0);
    e.set('x', mid.get('x'));
    e.resume(10);
    e.step(15);
    e.step(20);
    expect(Array.from(e.get('x'))).toEqual(Array.from(ref.get('x')));
    expect(() => e.set('x', [1, 2])).toThrow(/要 \d+ 个数/);
    // 存的那一年没轮到它(上一步算到第 12 年,它最后一次算是第 10 年):下一步的 dt 还是从第 10 年算起
    const f = new TableEngine({ seed: 7, cards: [habitat, owner, card], units: grid(), owner: 'owner' });
    fill(f, grid());
    f.start(0);
    f.set('x', mid.get('x'));
    f.resume(12);
    f.step(15);
    f.step(20);
    expect(Array.from(f.get('x'))).toEqual(Array.from(ref.get('x')));
  });
  it('跨单位读:地块读所在州、州读所属国(读不到 = off);州汇总地块、国汇总州', () => {
    const u = grid();
    const e = run(
      [
        { id: 'rsum', name: '州里宜居度之和', unit: 'region', min: 0, max: 1e9, off: 0, rule: 'sumof(hab)' },
        { id: 'pn', name: '国里有几州', unit: 'polity', min: 0, max: 1e9, off: 0, rule: 'countof(has(owner))' },
        { id: 'tp', name: '地块读国', unit: 'tile', min: -1, max: 1e9, off: -1, rule: 'pn' },
        { id: 'tr', name: '地块读州', unit: 'tile', min: -1, max: 1e9, off: -1, rule: 'rsum' },
        { id: 'wt', name: '全世界', unit: 'world', min: 0, max: 1e9, off: 0, rule: 'sumof(hab, hab > 20)' },
      ],
      [0, 1, 2],
      'js',
      u,
    );
    const h = e.get('hab');
    const r0 = Array.from(u.region!.cells!.subarray(u.region!.cellStart![0], u.region!.cellStart![1]));
    expect(e.value('rsum', 0)).toBe(r0.reduce((s, i) => s + h[i], 0));
    expect(e.value('pn', 0)).toBe(6);
    expect(e.value('pn', 1)).toBe(5);
    expect(e.value('tp', 0)).toBe(0); // 海:读不到国,读到 pn 的 off
    expect(e.value('tp', 1)).toBe(6);
    expect(e.value('tr', 1)).toBe(e.value('rsum', 0));
    expect(e.value('wt', 0)).toBe(Array.from(h).filter((x) => x > 20).reduce((s, x) => s + x, 0));
  });
  it('邻格函数:nbmax 带起始值和条件、nbcount、nbmean、edge.kind', () => {
    const e = run(
      [
        { id: 'a', name: '甲', unit: 'region', min: -1e9, max: 1e9, off: 0, rule: 'nbmax(nb.r - r, 0, edge.kind == 1)' },
        { id: 'b', name: '乙', unit: 'region', min: -1e9, max: 1e9, off: 0, rule: 'nbcount(nb.owner == owner)' },
        { id: 'c', name: '丙', unit: 'region', min: -1e9, max: 1e9, off: 0, rule: 'nbmean(nb.r)' },
        { id: 'r', name: '编号', unit: 'region', input: true, min: 0, max: 1e9, off: 0 },
      ],
      [],
    );
    const r = e.input('r');
    for (let i = 0; i < r.length; i++) r[i] = i * i;
    e.step(0);
    const u = grid().region!;
    const own = e.get('owner');
    for (let i = 0; i < u.count; i++) {
      let best = 0;
      let same = 0;
      let sum = 0;
      for (let k = u.adjStart[i]; k < u.adjStart[i + 1]; k++) {
        const j = u.adj[k];
        if (u.adjKind![k] === 1) best = Math.max(best, j * j - i * i);
        if (own[j] === own[i]) same++;
        sum += j * j;
      }
      expect(e.value('a', i)).toBe(best);
      expect(e.value('b', i)).toBe(same);
      expect(e.value('c', i)).toBe(sum / (u.adjStart[i + 1] - u.adjStart[i]));
    }
  });
  it('多栏表:一条公式按 col 算各栏,也可以每栏一条;常数串按栏取', () => {
    const e = run(
      [
        { id: 'm', name: '多栏', unit: 'region', cols: ['甲', '乙', '丙'], min: 0, max: 1e9, off: 0, init: 1, rule: 'm * K[col] + col', consts: { K: [1, 2, 3] } },
        { id: 'n', name: '每栏一条', unit: 'region', cols: ['甲', '乙'], min: 0, max: 1e9, off: 0, rule: { 甲: 'm.丙', 乙: 'm[1] + 100' } },
      ],
      [0, 1],
    );
    expect([0, 1, 2].map((c) => e.value('m', 0, c))).toEqual([1 * 1 + 0, 1 * 2 + 1, 1 * 3 + 2].map((x, c) => x * [1, 2, 3][c] + c));
    expect(e.value('n', 0, 0)).toBe(1 * 3 + 2);
    expect(e.value('n', 0, 1)).toBe(1 * 2 + 1 + 100);
  });
  it('avg、total:慢表读快表这段时间的平均和累计', () => {
    const e = run(
      [
        { id: 'f', name: '快', unit: 'world', min: 0, max: 1e9, off: 0, init: 0, rule: 'year' },
        { id: 's', name: '慢平均', unit: 'world', every: 10, min: 0, max: 1e9, off: 0, rule: 'avg(f)' },
        { id: 't', name: '慢累计', unit: 'world', every: 10, min: 0, max: 1e9, off: 0, rule: 'total(f)' },
      ],
      yearsTo(20),
    );
    // f 在 (10, 20] 里依次是 10、11、…、19(每步开头的值)
    expect(e.value('t', 0)).toBe(145);
    expect(e.value('s', 0)).toBe(14.5);
  });
  it('rand:和种子、位置、年份有关,和表的先后无关', () => {
    const c: TableCard = { id: 'x', name: '甲', unit: 'tile', min: 0, max: 1, off: 0, rule: 'rand()' };
    const d: TableCard = { id: 'y', name: '乙', unit: 'tile', min: 0, max: 1, off: 0, rule: 'rand(3)' };
    const a = run([c, d], [0, 1]);
    const b = run([d, c], [0, 1]);
    expect(Array.from(a.get('x'))).toEqual(Array.from(b.get('x')));
    expect(a.value('x', 5)).not.toBe(a.value('y', 5));
    const vals = Array.from(a.get('x'));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(new Set(vals).size).toBeGreaterThan(vals.length * 0.9);
  });
  it('搬家:总量只随规则变,搬家本身不增不减;流向按州对州攒', () => {
    const noRate: TableCard = { ...pop, id: 'pop', rate: undefined, rule: undefined, move: 'max(0, pop - nb.pop) * 0.05', init: 'if(hab > 33, 100, 0)' };
    const e = run([noRate], [0]);
    const total0 = Array.from(e.get('pop')).reduce((s, x) => s + x, 0);
    for (let y = 1; y <= 60; y++) e.step(y);
    const p = Array.from(e.get('pop'));
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(total0, 6);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(0);
    e.closeAllFlows(60);
    const w = e.flows('pop');
    expect(w.map((x) => [x.start, x.end])).toEqual([
      [0, 20],
      [20, 40],
      [40, 60],
    ]);
    expect(w[0].amount.length).toBeGreaterThan(0);
    for (let i = 0; i < w[0].from.length; i++) expect(w[0].from[i]).not.toBe(w[0].to[i]);
  });
  it('全 0 跳过和全算结果一样', () => {
    const a = run([pop], yearsTo(80));
    const b = run([{ ...pop, zeroStays: false }], yearsTo(80));
    expect(Array.from(a.get('pop'))).toEqual(Array.from(b.get('pop')));
    expect(Array.from(a.get('pop')).some((x) => x > 0)).toBe(true);
  });
});

describe('两种跑法逐位一样', () => {
  const cards: TableCard[] = [
    { ...pop },
    { id: 'dev', name: '能力', unit: 'region', cols: ['产', '运'], every: 5, min: 0, max: 9, off: 0, init: 0.2, consts: { L: [0.01, 0.02] }, rate: 'let g = nbmax(nb.dev - dev, 0, nb.owner == owner) * L[col]\ng + 0.001 * meanof(pop) / (1 + meanof(pop)) + if(rand(1) < 0.1, 0.002, 0)' },
    { id: 'tax', name: '税', unit: 'polity', min: 0, max: 1e12, off: 0, rule: 'sumof(dev.产 * 2) + 0.5 * tax' },
    { id: 'calm', name: '太平', unit: 'region', every: 10, min: 0, max: 1, off: 1, init: 1, rule: 'clamp(avg(tax) / 1000 + floor(sqrt(abs(tax))) / 100 + pow(0.5, 2) - log(2) * 0 + exp(0) - 1, 0, 1)' },
  ];
  it('拼函数 / 闭包算 200 年,每张表每格都一样', () => {
    const a = run(cards, yearsTo(200), 'js');
    const b = run(cards, yearsTo(200), 'closure');
    for (const c of cards) expect(Array.from(b.get(c.id))).toEqual(Array.from(a.get(c.id)));
    expect(a.incidents).toEqual([]);
  });
  it('搬家、限每年变多少的表:先搬、先限,再压上下限,两种跑法一样', () => {
    const cards: TableCard[] = [
      { id: 'x', name: '满了还搬', unit: 'region', min: 0, max: 10, off: 0, init: 5, rule: 'x + dt * if(meanof(hab) > 20, 10, 0)', move: '5' },
      { id: 'y', name: '限速', unit: 'tile', min: 0, max: 3, maxRate: 0.5, off: 0, init: 'if(hab > 20, 2.8, 0)', rate: 'hab' },
    ];
    for (const years of [yearsTo(1), yearsTo(30)]) {
      const a = run(cards, years, 'js');
      const b = run(cards, years, 'closure');
      for (const c of cards) expect(Array.from(a.get(c.id))).toEqual(Array.from(b.get(c.id)));
    }
  });
  it('中间量在邻格循环里头一次用到、几栏合走一遍邻格时取随机数、备份规则的上下限不一样、全 0 跳过的格子:两种跑法也一样', () => {
    const cards: TableCard[] = [
      { id: 'x', name: '往低处搬', unit: 'tile', min: 0, max: 1e6, off: 0, init: 'hab', rule: 'x', move: 'let 那边 = nb.x\nnbsum(max(0, nb.x - 那边)) * 0.01' },
      { id: 'z', name: '两栏随机', unit: 'region', cols: ['甲', '乙'], min: -1e6, max: 1e6, off: 0, rule: 'let s = nbsum(rand())\ns' },
      { id: 'w', name: '坏了换备份', unit: 'region', min: 0, max: 10, off: 0, init: 1, rule: '0 / 0', fallback: { id: 'w', name: '坏了换备份', unit: 'region', min: 0, max: 100, off: 0, rule: '20' } },
    ];
    const a = run(cards, yearsTo(5), 'js');
    const b = run(cards, yearsTo(5), 'closure');
    for (const c of cards) expect(Array.from(a.get(c.id))).toEqual(Array.from(b.get(c.id)));
    expect(a.value('z', 0, 0)).not.toBe(a.value('z', 0, 1));
    expect(a.value('w', 0)).toBe(10);
    // 全 0 跳过的格子核没算,下限不是 0 时照样压上来
    const zs: TableCard = { id: 'v', name: '跳过的也压', unit: 'tile', min: 1, max: 9, off: 1, init: 0, rule: 'v + nbsum(nb.v)', zeroStays: true };
    expect(Array.from(run([zs], yearsTo(2), 'js').get('v'))).toEqual(Array.from(run([zs], yearsTo(2), 'closure').get('v')));
    // 主卡全 0 跳过、备份没写:备份也按跳过算
    const two: TableCard = { id: 'u', name: '两栏备份', unit: 'tile', cols: ['甲', '乙'], min: 0, max: 1e6, off: 0, init: 1, rule: 'u / 0 * 0', zeroStays: true, fallback: { id: 'u', name: '两栏备份', unit: 'tile', cols: ['甲', '乙'], min: 0, max: 1e6, off: 0, rule: 'u * 2' } };
    const ua = run([two], yearsTo(3), 'js');
    expect(Array.from(ua.get('u'))).toEqual(Array.from(run([two], yearsTo(3), 'closure').get('u')));
    expect(ua.value('u', 5, 1)).toBe(16);
  });
  it('多栏表每栏一条、if 里套邻格函数、after 和 prev 混着读:两种跑法也一样', () => {
    const many: TableCard[] = [
      { ...pop },
      {
        id: 'ab',
        name: '本事',
        unit: 'region',
        cols: ['产', '运', '学'],
        min: 0,
        max: 50,
        off: 0,
        init: 1,
        consts: { K: [0.03, 0.05, 0.02] },
        rule: {
          产: 'let 近 = nbmax(nb.ab.产, 0, nb.owner == owner)\nif(近 > ab.产 and dt > 0, ab.产 + (近 - ab.产) * K[col], ab.产 + dt * 0.01)',
          运: 'ab.运 + dt * if(meanof(pop) > 1 or has(owner), K[col], 0)',
          学: 'max(ab.学, min(ab.产, ab.运)) + if(nbcount(nb.owner == owner) >= 2, dt * K[col], 0)',
        },
        builtin: true,
      },
      { id: 'top', name: '最强', unit: 'region', cols: ['产', '运', '学'], after: ['ab'], min: 0, max: 50, off: 0, rule: 'max(ab, top * 0.5) + if(ab > prev(ab.学), 0.001, 0)' },
    ];
    const a = run(many, yearsTo(150), 'js');
    const b = run(many, yearsTo(150), 'closure');
    for (const c of many) expect(Array.from(b.get(c.id))).toEqual(Array.from(a.get(c.id)));
    expect(a.incidents).toEqual([]);
  });
});

describe('护栏', () => {
  it('算出不是数:有备份规则换成备份,没有就关掉,并说清是哪条规则哪一年', () => {
    const backup: TableCard = { id: 'x', name: '甲', unit: 'region', min: 0, max: 10, off: 0, init: 1, rule: 'x + dt * 0.1' };
    const broken: TableCard = { ...backup, rule: 'if(year >= 3, x / (x - x), x + dt)', fallback: backup };
    const e = run([broken], yearsTo(6));
    expect(e.status('x')).toBe('fallback');
    expect(e.incidents[0]).toMatchObject({ table: 'x', year: 3, kind: 'nan', action: 'fallback' });
    expect(e.incidents[0].message).toMatch(/规则「甲」在第 3 年算出了不是数的值/);
    // 前 2 年按坏规则(每年 +1),第 3 年起按备份(每年 +0.1)
    expect(e.value('x', 0)).toBeCloseTo(1 + 2 + 0.4, 10);
    const f = run([{ ...broken, fallback: undefined }], yearsTo(6));
    expect(f.status('x')).toBe('off');
    expect(f.value('x', 0)).toBe(0);
    expect(f.incidents[0].action).toBe('off');
  });
  it('来回震荡拦得下;压回上下限和每年最多变多少', () => {
    const osc = run([{ id: 'x', name: '震荡', unit: 'tile', min: -1e9, max: 1e9, off: 0, init: 1, rule: '-1.5 * x' }], yearsTo(20));
    expect(osc.incidents.map((i) => i.kind)).toEqual(['oscillate']);
    expect(osc.status('x')).toBe('off');
    // 一步步收拢的(每步反向、幅度减半)不算
    const damp = run([{ id: 'x', name: '收拢', unit: 'tile', min: -1e9, max: 1e9, off: 0, init: 1, rule: '-0.5 * x' }], yearsTo(20));
    expect(damp.incidents).toEqual([]);
    const cl = run([{ id: 'x', name: '压', unit: 'tile', min: 0, max: 5, maxRate: 0.5, off: 0, init: 1, rate: '10' }], yearsTo(20));
    expect(cl.value('x', 1)).toBe(5);
    const half = run([{ id: 'x', name: '压', unit: 'tile', min: 0, max: 5, maxRate: 0.5, off: 0, init: 1, rate: '10' }], yearsTo(4));
    expect(half.value('x', 1)).toBe(1 + 4 * 0.5);
  });
  it('自带的规则(builtin)只查不是数:来回震荡不拦;多栏表算出不是数照样拦得下', () => {
    const osc = run([{ id: 'x', name: '震荡', unit: 'tile', min: -1e9, max: 1e9, off: 0, init: 1, rule: '-1.5 * x', builtin: true }], yearsTo(20));
    expect(osc.incidents).toEqual([]);
    expect(osc.status('x')).toBe('rule');
    for (const backend of ['js', 'closure'] as const) {
      const bad = run([{ id: 'x', name: '两栏', unit: 'region', cols: ['甲', '乙'], min: 0, max: 10, off: 0, init: 1, rule: { 甲: 'x.甲 + dt', 乙: 'if(year >= 4, x.乙 / (x.乙 - x.乙), x.乙 + dt)' }, builtin: true }], yearsTo(6), backend);
      expect(bad.incidents[0]).toMatchObject({ table: 'x', year: 4, kind: 'nan', action: 'off' });
      expect(bad.value('x', 0)).toBe(0);
    }
  });
  it('一大半格子顶着上限好些步:只提醒一次,不拦', () => {
    const e = run([{ id: 'x', name: '涨', unit: 'tile', min: 0, max: 5, off: 0, init: 1, rate: '1' }], yearsTo(30));
    expect(e.incidents.map((i) => [i.kind, i.action])).toEqual([['runaway', 'warn']]);
    expect(e.status('x')).toBe('rule');
  });
});

describe('快照', () => {
  it('第 100 年存一份,接着算到 300 年,和一口气算完逐位一样', () => {
    const cards: TableCard[] = [
      { ...pop },
      { id: 's', name: '慢', unit: 'region', every: 20, min: 0, max: 1e9, off: 0, rule: 'avg(meanof(pop)) + total(meanof(pop))' },
    ];
    // avg / total 里只能写表:先给州加一张"州里平均人口"
    const mean: TableCard = { id: 'mp', name: '州均人口', unit: 'region', min: 0, max: 1e9, off: 0, rule: 'meanof(pop)' };
    const slow: TableCard = { id: 's', name: '慢', unit: 'region', every: 20, min: 0, max: 1e9, off: 0, rule: 'avg(mp) + total(mp) / 1000' };
    expect(() => run(cards, [0])).toThrow(/avg\(…\) 里要写一张表/);
    const set = [pop, mean, slow];
    const whole = run(set, yearsTo(300));
    const half = run(set, yearsTo(100));
    const snap = half.snapshot();
    const u = grid();
    const e = new TableEngine({ seed: 7, cards: [habitat, owner, ...set], units: u, owner: 'owner' });
    fill(e, u);
    e.start(0);
    e.restore(snap);
    for (let y = 101; y <= 300; y++) e.step(y);
    for (const c of set) expect(Array.from(e.get(c.id))).toEqual(Array.from(whole.get(c.id)));
    e.closeAllFlows(300);
    whole.closeAllFlows(300);
    // 接上以后的流向:从快照那一段([80, 100],第 101 年收好)起,和一口气算的后几段一样
    const got = e.flows('pop');
    expect(got[0].start).toBe(80);
    expect(got.map((w) => Array.from(w.amount))).toEqual(whole.flows('pop').slice(-got.length).map((w) => Array.from(w.amount)));
  });
});

describe('边角情形', () => {
  it('开头的值能读国这一级的输入表(开头就按编号表对上州 → 国)', () => {
    const pv: TableCard = { id: 'pv', name: '国的数', unit: 'polity', input: true, min: 0, max: 1e9, off: 0 };
    const u = grid();
    const e = new TableEngine({ seed: 7, cards: [habitat, owner, pv, { id: 'x', name: '甲', unit: 'region', min: 0, max: 1e9, off: 0, init: 'pv', rule: 'x' }], units: u, owner: 'owner' });
    fill(e, u);
    e.input('pv').set([42, 7]);
    e.start(0);
    expect([e.value('x', 0), e.value('x', 2), e.value('x', u.region!.count - 1)]).toEqual([42, 7, 0]);
  });
  it('快照接回拦下以前:换回卡上的规则,和没拦下时一样往下算', () => {
    const backup: TableCard = { id: 'x', name: '甲', unit: 'region', min: 0, max: 100, off: 0, init: 1, rule: 'x + dt * 0.1' };
    const broken: TableCard = { ...backup, rule: 'if(year == 3, x / (x - x), x + dt)', fallback: backup };
    const u = grid();
    const e = new TableEngine({ seed: 7, cards: [habitat, owner, broken], units: u, owner: 'owner' });
    fill(e, u);
    e.start(0);
    for (const y of [0, 1, 2]) e.step(y);
    const snap = e.snapshot();
    for (const y of [3, 4]) e.step(y);
    expect(e.status('x')).toBe('fallback');
    e.restore(snap);
    expect(e.status('x')).toBe('rule');
    expect(e.incidents).toEqual([]);
    e.step(3);
    expect(e.status('x')).toBe('fallback');
  });
  it('拦下的那一步搬的不记进流向;只有备份规则搬家也行', () => {
    const backup: TableCard = { id: 'x', name: '甲', unit: 'region', min: 0, max: 1e9, off: 0, init: 10, rule: 'x', move: '0.1 * x', flowEvery: 1 };
    const broken: TableCard = { ...backup, rule: 'if(year >= 2, x / (x - x), x)', fallback: { ...backup } };
    const e = run([broken], yearsTo(1));
    e.step(2);
    e.step(3);
    e.closeAllFlows(3);
    const w = e.flows('x');
    // 第 2 年:坏规则那一遍搬的丢掉,只留备份重算的那一遍;各段的量和只用备份算的一样
    const ref = run([{ ...backup }], yearsTo(3));
    ref.closeAllFlows(3);
    expect(w.length).toBe(ref.flows('x').length);
    expect(w.map((x) => Array.from(x.amount))).toEqual(ref.flows('x').map((x) => Array.from(x.amount)));
    const onlyBackup: TableCard = { id: 'y', name: '乙', unit: 'region', min: 0, max: 1e9, off: 0, init: 10, rule: 'if(year >= 2, y / (y - y), y)', fallback: { id: 'y', name: '乙', unit: 'region', min: 0, max: 1e9, off: 0, rule: 'y', move: '0.1 * y' } };
    const f = run([onlyBackup], yearsTo(4));
    expect(f.status('y')).toBe('fallback');
    expect(Array.from(f.get('y')).reduce((a, b) => a + b, 0)).toBeCloseTo(10 * grid().region!.count, 6);
  });
  it('avg / total 不受别的表算不算影响(没有表要算的年份也攒)', () => {
    const inp: TableCard = { id: 'v', name: '输入', unit: 'world', input: true, min: 0, max: 1e9, off: 0 };
    const reader: TableCard = { id: 't', name: '累计', unit: 'world', every: 10, min: 0, max: 1e9, off: 0, rule: 'total(v)' };
    const other: TableCard = { id: 'o', name: '无关', unit: 'world', min: 0, max: 1e9, off: 0, rule: 'o + 1' };
    const go = (cards: TableCard[]) => {
      const e = new TableEngine({ seed: 7, cards: [inp, ...cards], units: {} });
      e.start(0);
      for (let y = 0; y <= 10; y++) {
        e.input('v')[0] = y;
        e.step(y);
      }
      return e.value('t', 0);
    };
    expect(go([reader])).toBe(go([reader, other]));
  });
  it('只有地块时,全世界也能汇总地块', () => {
    const u = grid();
    const e = new TableEngine({ seed: 7, cards: [habitat, { id: 'w', name: '总和', unit: 'world', min: 0, max: 1e9, off: 0, rule: 'sumof(hab)' }], units: { tile: u.tile } });
    fill(e, u);
    e.start(0);
    e.step(0);
    expect(e.value('w', 0)).toBe(Array.from(e.get('hab')).reduce((a, b) => a + b, 0));
  });
});
