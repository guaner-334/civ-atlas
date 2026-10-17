/**
 * 人物头像(gen/portrait.ts):同一个种子同一张脸、一家人长得像、身份对得上衣服和头饰、年龄对得上胡子皱纹白发、
 * 每一层的图都在 public/portraits 里、神情按那一年的事换。
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { characterPortrait, personPortrait, polityGroup, portraitLayers, portraitMood, STYLE_GROUP, type Portrait } from '../src/gen/portrait';
import { PORTRAIT_PARTS } from '../src/gen/portraitParts';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))));
  return c;
}

const ids = (p: Portrait) => p.layers.map((x) => x.src.split('/')[1].replace(/\.f\d\.webp$|\.webp$/, ''));
const has = (p: Portrait, id: string) => ids(p).includes(id);
const part = (p: Portrait, id: string) => PORTRAIT_PARTS[p.group]!.parts.find((x) => x.id === id)!;
const layerOf = (p: Portrait, layer: string) => ids(p).filter((id) => part(p, id).layer === layer);

describe('部件表', () => {
  it('每件的图都在,每组有身体、默认发型、六种身份的衣服', () => {
    for (const [g, parts] of Object.entries(PORTRAIT_PARTS)) {
      for (const p of parts!.parts) {
        if (!p.nobase) expect(existsSync(`public/portraits/${g}/${p.id}.webp`), `${g}/${p.id}`).toBe(true);
        for (const f of p.own ?? []) expect(existsSync(`public/portraits/${g}/${p.id}.f${f}.webp`), `${g}/${p.id}.f${f}`).toBe(true);
      }
      expect(parts!.parts.some((p) => p.layer === 'body' && !p.young)).toBe(true);
      expect(parts!.parts.some((p) => p.layer === 'hair' && p.def)).toBe(true);
      for (const role of ['ruler', 'general', 'minister', 'royal'] as const) expect(parts!.parts.some((p) => p.layer === 'clothes' && p.roles?.includes(role)), `${g} ${role}`).toBe(true);
    }
  });
  it('十二种地名语感都分到了组', () => {
    expect(Object.keys(STYLE_GROUP).sort()).toEqual(['central', 'desert', 'elven', 'frontier', 'hellenic', 'imperial', 'kingdom', 'mythic', 'nordic', 'slavic', 'steppe', 'xianxia']);
  });
});

describe.each([7, 2024])('人物头像 · seed=%i', (seed) => {
  it('每个人都有头像,同一个种子算两次一样', () => {
    const civ = civOf(seed);
    const again = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }));
    for (const x of civ.people!) {
      const a = personPortrait(civ, x.id, x.died ?? civ.endYear);
      expect(a, x.name).not.toBeNull();
      expect(a!.layers.length).toBeGreaterThanOrEqual(3);
      expect(personPortrait(again, x.id, x.died ?? civ.endYear)).toEqual(a);
      // 贴在脸上的层只用这张底脸自己的图,不借第一张脸的
      const all = [...a!.layers, ...a!.blink, ...Object.values(a!.exprs).flat()];
      for (const l of all) if (a!.face > 1 && ['body', 'jaw', 'nose', 'wrinkle', 'brow', 'eye', 'mouth'].includes(l.layer)) expect(l.src).toContain(`.f${a!.face}.`);
    }
  });

  it('身份对得上衣服、头饰;戴盔戴帽的不画头发', () => {
    const civ = civOf(seed);
    for (const x of civ.people!) {
      const p = personPortrait(civ, x.id, x.died ?? civ.endYear)!;
      const P = PORTRAIT_PARTS[p.group]!.parts;
      const clothes = layerOf(p, 'clothes');
      expect(clothes.length).toBe(1);
      const roles = P.find((q) => q.id === clothes[0])!.roles!;
      const want = x.role === 'general' ? 'general' : x.role === 'minister' ? 'minister' : x.role === 'prince' ? 'royal' : civ.polities[x.polity].lineage === 'republic' ? 'consul' : 'ruler';
      expect(roles).toContain(want);
      const hat = layerOf(p, 'hat')[0];
      if (hat && part(p, hat).hides) expect(layerOf(p, 'hair')).toEqual([]);
      if (want === 'ruler') expect(hat).toBeDefined();
    }
  });

  it('一家人长得像:父子底脸大多一样,不相干的两朝开国之君大多不一样', () => {
    const civ = civOf(seed);
    const people = civ.people!;
    const at = (id: number) => personPortrait(civ, id, people[id].died ?? civ.endYear)!;
    let same = 0;
    let pairs = 0;
    for (const x of people) {
      if (x.parent === undefined || polityGroup(civ, people[x.parent].polity) !== polityGroup(civ, x.polity)) continue;
      pairs++;
      if (at(x.id).face === at(x.parent).face) same++;
    }
    expect(pairs).toBeGreaterThan(10);
    expect(same / pairs).toBeGreaterThan(0.85);
    const founders = people.filter((x) => x.role === 'ruler' && x.parent === undefined && polityGroup(civ, x.polity) === 'zhongyuan');
    const faces = new Set(founders.map((x) => at(x.id).face));
    if (founders.length >= 8) expect(faces.size).toBeGreaterThan(1);
  });

  it('年龄:少年用年轻的脸、没胡子;老了有皱纹、头发白', () => {
    const civ = civOf(seed);
    const x = civ.people!.find((p) => p.role === 'ruler' && (p.died ?? civ.endYear) - p.born > 65)!;
    expect(x).toBeDefined();
    const young = personPortrait(civ, x.id, x.born + 16)!;
    expect(layerOf(young, 'body')).toEqual(['body-young']);
    expect(layerOf(young, 'beard')).toEqual([]);
    expect(young.white).toBe(0);
    const old = personPortrait(civ, x.id, x.born + 70)!;
    expect(layerOf(old, 'body')).toEqual(['body']);
    expect(layerOf(old, 'wrinkle').length).toBe(1);
    expect(old.white).toBeGreaterThan(0.6);
    // 年纪变了,衣服、底脸不变
    expect(old.face).toBe(young.face);
    expect(layerOf(old, 'clothes')).toEqual(layerOf(young, 'clothes'));
  });

  it('表情换眉眼嘴,别的层不动;神情按那一年的事', () => {
    const civ = civOf(seed);
    const x = civ.people!.find((p) => p.role === 'general' && p.commands?.length)!;
    const p = personPortrait(civ, x.id, x.commands![0].from)!;
    for (const e of ['smile', 'frown', 'angry', 'surprise'] as const) {
      const ls = portraitLayers(p, e);
      const rest = (l: typeof ls) => l.filter((q) => !['brow', 'eye', 'mouth'].includes(q.layer)).map((q) => q.src);
      expect(rest(ls)).toEqual(rest(p.layers));
    }
    expect(p.blink.length).toBeGreaterThan(0);
    expect(portraitMood(civ, x, x.commands![0].from).expr).not.toBe('calm');
    expect(portraitMood(civ, x, x.born - 5).expr).toBe('calm');
    // 神情里按年份二分找史事:史事要按年份排好
    const A = civ.annals;
    for (let i = 1; i < A.length; i++) expect(A[i].year >= A[i - 1].year).toBe(true);
  });

  it('作者的人物:换一张换了样子,同一个编号同一次换得到同一张', () => {
    const civ = civOf(seed);
    const c = { id: 3, born: 2400 };
    const a = characterPortrait(civ, c, 0, 2440)!;
    expect(characterPortrait(civ, c, 0, 2440)).toEqual(a);
    const others = [1, 2, 3, 4].map((n) => characterPortrait(civ, { ...c, portrait: n }, 0, 2440)!);
    expect(others.some((b) => JSON.stringify(b.layers) !== JSON.stringify(a.layers))).toBe(true);
  });
});
