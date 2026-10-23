/**
 * 助手的查人物(people)、查地块(land):几个种子上返回的数合理,同一种子同一结果,只读不改世界,
 * 超大世界(20 万地块)、人物很多时也不超字数上限。不联网:只调工具本身和测试用假 AI。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ } from '../src/gen/civ/types';
import { MARK_COLORS, personKey, polityKey, settlementKey, type WorldEdits } from '../src/gen/edits';
import type { AuthorCharacter } from '../src/gen/characters';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityAlive, populationLabel, regionPopulationAt } from '../src/gen/civ/growth';
import { regionLabel } from '../src/gen/civ/display';
import { peopleIndex, rulerAt } from '../src/gen/civ/peopleInfo';
import { personName } from '../src/gen/civ/peopleText';
import { toLonLat } from '../src/ai/prompts/rewrite';
import { LOOKUP_MAX, fitLines, landLabel, lookupLand, lookupPeople, peopleLabel, regionOf, type LookupContext } from '../src/ai/agent/lookup';
import { ASSISTANT_SYSTEM, assistantTools, mockAssistant, stepsSummary } from '../src/ai/agent/assistant';
import type { AgentToolResult } from '../src/ai/agent/loop';

const F = Math.floor;
const Y = 2000;

function make(seed: number, cells?: number): { world: World; civ: Civ } {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed, ...(cells ? { cells } : {}) });
  return { world, civ: generateCiv(world) };
}

/** 第 y 年国土最大的国家 */
function biggest(civ: Civ, y: number): number {
  const own = ownersAt(civ, y).polity;
  const n = new Map<number, number>();
  for (let r = 0; r < own.length; r++) if (own[r] >= 0) n.set(own[r], (n.get(own[r]) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** 一个作者的人物:国家写的是 id 那一国,生在它的(开国时的)国都 */
function character(civ: Civ, id: number, over: Partial<AuthorCharacter> = {}): AuthorCharacter {
  const p = civ.polities[id];
  const ruler = rulerAt(civ, id, Y)!;
  return {
    id: 1,
    name: '林小满',
    color: MARK_COLORS[0],
    born: 1980,
    died: 2040,
    role: '书记官',
    polity: polityKey(civ, id),
    birthplace: settlementKey(civ, p.capital),
    note: '随军的书记官,记下了这一场仗。',
    life: [
      { year: 2006, text: '随军西征', where: settlementKey(civ, p.capital) },
      { year: 1998, text: '入宫做抄书吏' },
    ],
    kin: [{ rel: '主公', person: personKey(civ, ruler.id) }],
    leanings: { expand: 40, war: 20, develop: 80, trade: 60 },
    ...over,
  };
}

function ctxOf(w: { world: World; civ: Civ }, chars?: AuthorCharacter[]): LookupContext {
  const id = biggest(w.civ, Y);
  const edits: WorldEdits = { names: {}, interventions: [], terrain: [], characters: chars ?? [character(w.civ, id)] };
  return { world: w.world, civ: w.civ, year: Y, edits };
}

/** "平均 a 米,最低 b 米,最高 c 米" 这样的一行 → [平均, 最低, 最高] */
function triple(text: string, head: string, unit: string): [number, number, number] {
  const line = text.split('\n').find((l) => l.startsWith(head));
  expect(line, `没有「${head}」这一行:\n${text}`).toBeTruthy();
  const m = new RegExp(`平均 (-?[\\d.]+) ?${unit},最(?:低|少) (-?[\\d.]+) ?${unit},最(?:高|多) (-?[\\d.]+) ?${unit}`).exec(line!);
  expect(m, line).toBeTruthy();
  return [Number(m![1]), Number(m![2]), Number(m![3])];
}

/** 以 head 开头那一行的占比加起来("不到 1%" 算 0.5):"地块 … 块(按面积:陆地 31%、海洋 68%)"、"地形(按面积):草原 40%、……" */
function shareSum(text: string, head = '地块 '): number {
  const line = text.split('\n').find((l) => l.startsWith(head))!;
  return [...line.matchAll(/(不到 1|\d+)%/g)].reduce((s, m) => s + (m[1] === '不到 1' ? 0.5 : Number(m[1])), 0);
}

const worlds = [7, 2024].map((seed) => ({ seed, ...make(seed) }));

describe.each(worlds)('种子 $seed', (w) => {
  const ctx = ctxOf(w);
  const { civ, world } = w;
  const big = biggest(civ, Y);
  const ruler = rulerAt(civ, big, Y)!;

  it('按名字找推演里的君主:国家、在位年份、倾向对得上', () => {
    expect(ruler).toBeTruthy();
    const r = lookupPeople(ctx, { name: ruler.name, country: `P${big}` });
    expect(r.summary).toMatch(/^找到 \d+ 人$/);
    expect(r.result).toContain(personName(civ, ruler));
    expect(r.result).toContain(`(P${big})`);
    expect(r.result).toContain(`第 ${F(ruler.from!)}`);
    if (ruler.leanings) expect(r.result).toContain(`开拓 ${ruler.leanings.expand}，好战 ${ruler.leanings.war}`);
    expect(peopleLabel(ctx, { name: ruler.name })).toBe(`查人物：${ruler.name}`);
  });

  it('国家 + 年份:那年在位的君主、在位第几年、几岁,和那年在世的作者的人物', () => {
    const r = lookupPeople(ctx, { country: `P${big}`, year: Y });
    expect(r.summary).toBe(`第 ${Y} 年在位的是${personName(civ, ruler)}`);
    expect(r.result).toContain(`在位的:君主 ${personName(civ, ruler)}`);
    expect(r.result).toContain(`第 ${Y} 年时在位第 ${Y - F(ruler.from!) + 1} 年、${F(Y - ruler.born)} 岁`);
    expect(r.result).toContain('作者的人物 林小满(书记官)');
    expect(r.result).toContain(`第 ${Y} 年时 20 岁`);
  });

  it('国家:历代君主的数目和人物索引一样;太多的列最早的和最近的', () => {
    const rs = peopleIndex(civ).rulers[big];
    const r = lookupPeople(ctx, { country: `P${big}` });
    expect(r.result).toContain(`历代君主 共 ${rs.length} 位`);
    expect(r.result).toContain(personName(civ, rs[0]));
    expect(r.result).toContain(personName(civ, rs[rs.length - 1]));
    if (rs.length > 30) expect(r.result).toContain(`中间 ${rs.length - 30} 位没列`);
    // 只看几年:那几年在位的才列
    const x = rs[Math.floor(rs.length / 2)];
    const r2 = lookupPeople(ctx, { country: `P${big}`, from: F(x.from!), to: F(x.from!) });
    expect(r2.result).toContain(personName(civ, x));
    expect(Number(/历代君主 共 (\d+) 位/.exec(r2.result)![1])).toBeLessThanOrEqual(3);
  });

  it('只给年份:那年在世的各国,按国土大小,各有在位的君主', () => {
    const own = ownersAt(civ, Y).polity;
    const alive = civ.polities.filter((p) => polityAlive(p, Y) && own.includes(p.id));
    const r = lookupPeople(ctx, { year: Y, limit: 60 });
    expect(r.result.split('\n')[0]).toContain(`第 ${Y} 年在世的国家 ${alive.length} 个`);
    expect(r.result.split('\n')[1]).toContain(`P${big} `);
    expect(r.summary).toBe(`${alive.length} 国的君主`);
  });

  it('作者的人物:人物卡上的生卒、身份、性格、经历、亲友都在', () => {
    const r = lookupPeople(ctx, { name: '林小满' });
    expect(r.summary).toBe('找到 1 人');
    for (const s of ['作者的人物 林小满(书记官)', '生卒 第 1980—2040 年(享年 60)', '性格 开拓 40，好战 20，发展 80，重商 60', `国家 P${big} `, '简介:随军的书记官'])
      expect(r.result).toContain(s);
    // 经历按年份排
    expect(r.result.indexOf('第 1998 年 入宫做抄书吏')).toBeLessThan(r.result.indexOf('第 2006 年 随军西征'));
    expect(r.result).toContain(`亲友:主公 ${personName(civ, ruler)}`);
    // 只要作者的人物
    expect(lookupPeople(ctx, { role: 'author' }).result).toContain('作者的人物 1 个');
  });

  it('查一州:平均在最低、最高之间,数在合理范围里,人口和面板上一样', () => {
    const r = civ.settlements[civ.polities[big].capital].region;
    expect(regionOf(civ, `R${r}`)).toBe(r);
    expect(regionOf(civ, regionLabel(civ, r))).toBe(r);
    const out = lookupLand(ctx, { region: `R${r}` });
    const e = triple(out.result, '海拔', '米');
    const t = triple(out.result, '年均气温', '°C');
    const p = triple(out.result, '年降水', '毫米');
    for (const [avg, lo, hi] of [e, t, p]) {
      expect(lo).toBeLessThanOrEqual(avg + 5);
      expect(avg).toBeLessThanOrEqual(hi + 5);
    }
    expect(e[1]).toBeGreaterThan(-500);
    expect(e[2]).toBeLessThan(10000);
    expect(t[1]).toBeGreaterThan(-80);
    expect(t[2]).toBeLessThan(50);
    expect(p[1]).toBeGreaterThanOrEqual(0);
    expect(Math.abs(shareSum(out.result) - 100)).toBeLessThanOrEqual(2);
    expect(shareSum(out.result, '地形(按面积)')).toBeLessThanOrEqual(104);
    expect(out.result).toContain(`人口(第 ${Y} 年):${populationLabel(regionPopulationAt(civ, r, Y))}`);
    expect(out.result).toMatch(/物产/);
    expect(landLabel(ctx, { region: `R${r}` })).toBe(`查地块：${regionLabel(civ, r)}`);
    expect(out.summary).toMatch(/^平均海拔 -?\d+ 米，年均 -?[\d.]+°C，年降水 \d+ 毫米$/);
  });

  it('查一国的国土:州数对得上;那年不在世的按它最后一年', () => {
    const own = ownersAt(civ, Y).polity;
    const n = own.filter((o) => o === big).length;
    const r = lookupLand(ctx, { country: `P${big}`, year: Y });
    expect(r.result.split('\n')[0]).toContain(`第 ${Y} 年的国土:${n} 州`);
    const gone = civ.polities.find((p) => p.ended !== undefined && p.ended < Y - 50 && p.ended - p.founded > 30)!;
    const r2 = lookupLand(ctx, { country: `P${gone.id}`, year: Y });
    expect(r2.result).toContain('已经亡了,按第');
  });

  it('经纬度一点 = 离它最近那块地的数', () => {
    const cell = civ.settlements[civ.polities[big].capital].cell;
    const at = toLonLat(world.mesh.x[cell], world.mesh.y[cell]);
    const r = lookupLand(ctx, { at });
    expect(r.result).toContain(`海拔 ${Math.round(world.elevation[cell])} 米`);
    expect(r.result).toContain(`年降水 ${Math.round(world.precipitation[cell])} 毫米`);
    expect(r.result).toContain(`R${civ.regions.of[cell]} `);
    // 带半径:周围一圈的汇总
    const r2 = lookupLand(ctx, { at, radius: 500 });
    expect(r2.result.split('\n')[0]).toContain('周围 500 公里');
    triple(r2.result, '海拔', '米');
  });

  it('整个世界、一块陆地、一框:陆地海洋占比加起来是一百,不超过字数上限', () => {
    for (const a of [{}, { landmass: 'L0' }, { box: [-60, -30, 60, 30] }, { box: [150, -10, -150, 10] }, { box: [-180, -90, 180, 90] }]) {
      const r = lookupLand(ctx, a);
      expect(r.result.length).toBeLessThanOrEqual(LOOKUP_MAX);
      expect(Math.abs(shareSum(r.result) - 100)).toBeLessThanOrEqual(2);
    }
    expect(lookupLand(ctx, {}).result).toMatch(new RegExp(`^整个世界\\n地块 ${world.mesh.n} 块`));
    // 一框框满全世界 = 整个世界
    expect(lookupLand(ctx, { box: [-180, -90, 180, 90] }).result).toContain(`经度 全部、纬度 -90 ~ 90 这一片\n地块 ${world.mesh.n} 块`);
  });

  it('找不到的照实说,不编', () => {
    expect(lookupPeople(ctx, { name: '查无此人甲乙' }).result).toContain('没有名字里带「查无此人甲乙」');
    expect(lookupPeople(ctx, { country: 'P99999' }).result).toContain('找不到国家');
    expect(lookupLand(ctx, { region: '查无此州甲乙' }).result).toContain('找不到州');
    expect(lookupLand(ctx, { landmass: 'L9999' }).result).toContain('找不到陆块');
    expect(lookupLand(ctx, { box: [1, 2] }).result).toContain('box 要写成');
  });
});

describe('同一种子同一结果,只读不改', () => {
  const asks: [string, Record<string, unknown>][] = [
    ['people', { name: '林小满' }],
    ['people', {}],
    ['people', { year: 1500 }],
    ['people', { country: 'P0' }],
    ['people', { country: 'P0', year: 1200 }],
    ['people', { country: 'P0', role: 'minister' }],
    ['land', {}],
    ['land', { country: 'P0', year: 1200 }],
    ['land', { region: 'R10' }],
    ['land', { at: [20, 10], radius: 900 }],
    ['land', { box: [-40, 0, 40, 50] }],
  ];
  const run = (ctx: LookupContext) => asks.map(([tool, a]) => (tool === 'people' ? lookupPeople(ctx, a) : lookupLand(ctx, a)));
  let again: { world: World; civ: Civ };
  beforeAll(() => {
    again = make(7);
  }, 120_000);

  it('重新生成同一个种子,查出来一字不差', () => {
    const a = ctxOf(worlds[0]);
    // 人物卡按稳定键记国家、出生地:用第一份历史算出来的键,第二份照样认得
    const b: LookupContext = { ...ctxOf(again), edits: a.edits };
    expect(run(b)).toEqual(run(a));
  });

  it('查过以后世界、历史、作者的修改都没变', () => {
    const ctx = ctxOf(worlds[0]);
    const before = structuredClone(ctx.edits);
    const people = ctx.civ.people!;
    const names = people.map((x) => x.name).join('|');
    const elev = Float32Array.from(ctx.world.elevation);
    const own = Int16Array.from(ctx.civ.polity);
    run(ctx);
    expect(ctx.edits).toEqual(before);
    expect(ctx.civ.people).toBe(people);
    expect(people.map((x) => x.name).join('|')).toBe(names);
    expect(ctx.world.elevation).toEqual(elev);
    expect(ctx.civ.polity).toEqual(own);
  });
});

describe('超大世界(20 万地块)、人物很多:不超字数上限', () => {
  let big: { world: World; civ: Civ };
  beforeAll(() => {
    big = make(7, 212_000);
  }, 120_000);

  it('每一种查法都不超过上限,超了写明截掉了', () => {
    expect(big.world.mesh.n).toBeGreaterThanOrEqual(200_000);
    const id = biggest(big.civ, Y);
    const base = character(big.civ, id);
    const long = '很长的简介。'.repeat(300);
    // 500 个人物,个个有长简介、200 段经历
    const chars = Array.from({ length: 500 }, (_, i) => ({
      ...base,
      id: i + 1,
      name: `林小满${i}`,
      note: long,
      life: Array.from({ length: 200 }, (_, k) => ({ year: 1980 + k, text: `第 ${k} 段经历`.repeat(8) })),
    }));
    const ctx = ctxOf(big, chars);
    const outs = [
      lookupPeople(ctx, {}),
      lookupPeople(ctx, { limit: 60 }),
      lookupPeople(ctx, { name: '林' , limit: 60 }),
      lookupPeople(ctx, { name: '林小满1' }),
      lookupPeople(ctx, { year: Y, limit: 60 }),
      lookupPeople(ctx, { country: `P${id}`, limit: 60 }),
      lookupPeople(ctx, { country: `P${id}`, year: Y, limit: 60 }),
      lookupPeople(ctx, { country: `P${id}`, role: 'author', limit: 60 }),
      lookupPeople(ctx, { year: Y, role: 'minister', limit: 60 }),
      lookupLand(ctx, {}),
      lookupLand(ctx, { landmass: 'L0' }),
      lookupLand(ctx, { country: `P${id}` }),
      lookupLand(ctx, { box: [-180, -90, 180, 90] }),
      lookupLand(ctx, { at: [0, 0], radius: 3000 }),
    ];
    for (const o of outs) expect(o.result.length).toBeLessThanOrEqual(LOOKUP_MAX);
    expect(outs[2].result).toContain('字数到了上限');
    expect(outs[2].result).toContain('名字里带「林」');
    // 整个世界的汇总不逐块列,很短
    expect(outs[9].result.length).toBeLessThan(1500);
    expect(outs[9].result).toContain(`地块 ${big.world.mesh.n} 块`);
  });
});

describe('拼行、接进助手', () => {
  it('放得下全给;放不下截掉后面的行,写明截了几行', () => {
    expect(fitLines(['甲', '乙'])).toBe('甲\n乙');
    const lines = Array.from({ length: 400 }, (_, i) => `第 ${i} 行,写点字凑长度`);
    const s = fitLines(lines, 1000, '缩小范围');
    expect(s.length).toBeLessThanOrEqual(1000);
    expect(s).toMatch(/……\(字数到了上限,后面 \d+ 行没给;缩小范围\)$/);
    expect(s.startsWith('第 0 行')).toBe(true);
  });

  const w = worlds[0];
  const ctx = { ...ctxOf(w) };
  const big = biggest(w.civ, Y);

  it('助手的工具里有 people、land,结果和直接查一样;提示词里写了它们能干什么', () => {
    const tools = Object.fromEntries(assistantTools(ctx, { trials: [], proposal: null }).map((t) => [t.def.name, t]));
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(['people', 'land']));
    expect((tools.people.run({ name: '林小满' }) as AgentToolResult).result).toBe(lookupPeople(ctx, { name: '林小满' }).result);
    expect((tools.land.run({ country: `P${big}` }) as AgentToolResult).result).toBe(lookupLand(ctx, { country: `P${big}` }).result);
    expect(tools.people.label!({ country: `P${big}`, year: Y })).toMatch(new RegExp(`^查人物：.+第 ${Y} 年$`));
    expect(ASSISTANT_SYSTEM).toContain('## 查人物、查地块');
    expect(ASSISTANT_SYSTEM).toContain('people、land 这些工具名');
  });

  it('做完那一行把查人物、查地块算作查了几次', () => {
    const q = (tool: string, label: string) => ({ tool, state: 'ok' as const, label });
    expect(stepsSummary([q('people', '查人物：李昭')])).toBe('查了李昭');
    expect(stepsSummary([q('people', '查第 1200 年各国的君主')])).toBe('查了第 1200 年各国的君主');
    expect(stepsSummary([q('land', '查地块：贝林马克')])).toBe('查了贝林马克的地形气候');
    expect(stepsSummary([q('land', '查地块：贝林马克'), q('people', '查人物：李昭'), q('try_edits', '试推演')])).toBe('查了 2 次，试推演 1 次');
  });

  it('测试用假 AI:问君主先查人物,问海拔气温先查地块', () => {
    const mock = mockAssistant({ ...ctx });
    const req = (ask: string) => ({
      feature: '助手',
      messages: [
        { role: 'system' as const, content: ASSISTANT_SYSTEM },
        { role: 'user' as const, content: `材料\n# 作者这次说\n${ask}` },
      ],
      tools: ['country', 'people', 'land'].map((name) => ({ name, description: '', parameters: {} })),
    });
    const name = w.civ.polities[big].name;
    const a = mock(req(`${name}现在的君主是谁？`));
    expect(a.toolCalls?.[0].name).toBe('people');
    expect(JSON.parse(a.toolCalls![0].args)).toMatchObject({ year: Y });
    const r = w.civ.settlements[w.civ.polities[big].capital].region;
    const b = mock(req(`${regionLabel(w.civ, r)}海拔多高？`));
    expect(b.toolCalls?.[0].name).toBe('land');
    expect(JSON.parse(b.toolCalls![0].args)).toEqual({ region: `R${r}` });
  });
});
