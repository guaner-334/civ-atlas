/**
 * 开放给用的人调的规则项(src/gen/civ/tuning.ts):70 项、7 组、常用 28 项;编号、档位、范围;
 * 换成旋钮的改动(一项连改几处、倒过来的、关、永不);清理读进来的值(每处一句提示);摘要、每组改了几项。
 * 几项「关」真的不发生(一项连改几处才关得住的、为它改了推演的):小世界推一遍看史事。
 * 每一项两头的极端值推不推得完、出不出 NaN,在压力测试里(scripts/stress.ts 的「规则项」)
 */
import { describe, expect, it } from 'vitest';
import {
  MULT_STEPS,
  TUNING_GROUPS,
  TUNING_ITEMS,
  cleanTuning,
  multSteps,
  officialValue,
  tuningCounts,
  tuningEnds,
  tuningItem,
  tuningPatch,
  tuningSummary,
  tuningValueText,
  type TuningValues,
} from '../src/gen/civ/tuning';
import { CIV_KNOBS, cleanKnobs } from '../src/gen/civ/knobs';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';

const table = (k: string) => {
  const [t, n] = k.split('.');
  return CIV_KNOBS.find((x) => x.id === t)!.values[n];
};

describe('规则项表', () => {
  it('70 项、7 组、常用 28 项;编号不重复、写法固定;每组都有常用的', () => {
    expect(TUNING_ITEMS.length).toBe(70);
    expect(TUNING_ITEMS.filter((x) => x.common).length).toBe(28);
    expect(TUNING_GROUPS.length).toBe(7);
    const ids = TUNING_ITEMS.map((x) => x.id);
    expect(new Set(ids).size).toBe(70);
    for (const x of TUNING_ITEMS) {
      expect(x.id).toMatch(/^[a-z]+\.[a-z][a-zA-Z]*$/);
      expect(x.id.split('.')[0]).toBe(x.group);
      expect(tuningItem(x.id)).toBe(x);
      expect(x.name.length).toBeGreaterThan(0);
      expect(x.desc.length).toBeGreaterThan(0);
    }
    for (const g of TUNING_GROUPS) expect(TUNING_ITEMS.some((x) => x.group === g.id && x.common), g.id).toBe(true);
  });

  it('改的旋钮都在旋钮表里、是数(区间是两个数);一处旋钮只归一项', () => {
    const seen = new Map<string, string>();
    for (const x of TUNING_ITEMS) {
      expect(x.knobs.length, x.id).toBeGreaterThan(0);
      for (const k of x.knobs) {
        const v = table(k);
        expect(v, `${x.id} → ${k}`).toBeDefined();
        if (x.kind === 'range') expect(Array.isArray(v) && v.length === 2, k).toBe(true);
        else expect(typeof v, k).toBe('number');
        expect(seen.get(k), `${k} 同时归 ${seen.get(k)} 和 ${x.id}`).toBeUndefined();
        seen.set(k, x.id);
      }
    }
  });

  it('数值、区间:官方值就是旋钮的官方值,落在档上;范围、步长合理;倍数档能关的 35 样(连「最多 0 次」的大迁徙、关掉的避冬)', () => {
    for (const x of TUNING_ITEMS) {
      if (x.kind === 'mult') continue;
      const onGrid = (v: number) => Math.abs((v - x.min) / x.step - Math.round((v - x.min) / x.step)) < 1e-9 && v >= x.min && v <= x.max;
      expect(x.min, x.id).toBeLessThan(x.max);
      expect(onGrid(x.max), `${x.id} 最大值在档上`).toBe(true);
      if (x.kind === 'range') {
        expect(x.official.every(onGrid), x.id).toBe(true);
        for (const k of x.knobs) expect(table(k), x.id).toEqual(x.official);
      } else {
        expect(onGrid(x.official), x.id).toBe(true);
        for (const k of x.knobs) expect(x.official, x.id).toBe(table(k));
      }
    }
    const offs = TUNING_ITEMS.filter((x) => (x.kind === 'mult' && x.off) || (x.kind === 'num' && x.offable) || (x.kind === 'num' && x.min === 0 && x.id === 'folk.treks'));
    expect(offs.length).toBe(35);
  });
});

describe('换成旋钮的改动', () => {
  it('没改 / 都是官方值 = undefined(官方)', () => {
    expect(tuningPatch({})).toBeUndefined();
    expect(tuningPatch(undefined)).toBeUndefined();
    expect(tuningPatch(Object.fromEntries(TUNING_ITEMS.map((x) => [x.id, officialValue(x)])))).toBeUndefined();
  });

  it('倍数档 = 官方值 × 倍数;倒过来的 ÷ 倍数;关 = 0(倒过来的关 = Infinity);一项连改几处', () => {
    expect(tuningPatch({ 'war.odds': 2 })).toEqual({ wars: { WAR_ODDS: 0.6 } });
    expect(tuningPatch({ 'split.dynasty': 0 })).toEqual({ dynasty: { ODDS: 0 }, regents: { USURP: 0 } });
    expect(tuningPatch({ 'war.project': 2 })).toEqual({ wars: { PROJECT: 9 } });
    expect(tuningPatch({ 'court.reform': 4 })).toEqual({ reform: { PUSH_MIN: 0.05 } });
    expect(tuningPatch({ 'disaster.plague': 0 })).toEqual({ plague: { ORIGIN_NORM: Infinity } });
    expect(tuningPatch({ 'realm.sail': 0 })).toEqual({ polities: { SAIL_LEVEL: Infinity } });
    expect(tuningPatch({ 'realm.found': 2 })).toEqual({ polities: { FOUND_AT: 5, MIN_AGE: 60 } });
    expect(tuningPatch({ 'diplo.treaty': 0 })).toEqual({ treaties: { TREATY_ODDS: 0, PEACE_TREATY: 0 } });
    expect(tuningPatch({ 'diplo.marry': 2 })).toEqual({ marriages: { MARRY_PER: 0.6, MARRY_MAX: 1.2, MARRY_ALLY: 0.3, PEACE_MATCH: 0.4 } });
    expect(tuningPatch({ 'disaster.famine': 0.5 })).toEqual({ unrest: { P_BASE: 0.01, P_FULL: 0.3 } });
  });

  it('数值、区间原样;同一个意思两张表各一份的一起改;永不 = Infinity,避冬关 = −Infinity', () => {
    expect(tuningPatch({ 'war.truce': 12, 'war.length': [3, 9] })).toEqual({ wars: { TRUCE: 12, LENGTH: [3, 9] } });
    expect(tuningPatch({ 'war.fronts': 3 })).toEqual({ wars: { MAX_WARS: 3 }, diplomacy: { MAX_WARS: 3 } });
    expect(tuningPatch({ 'court.reign': 20 })).toEqual({ rulers: { REIGN_MAX: 20 }, regents: { SEIZE_REIGN: 20 } });
    expect(tuningPatch({ 'war.crush': 'never' })).toEqual({ wars: { CRUSH: Infinity } });
    expect(tuningPatch({ 'war.winter': 'off' })).toEqual({ wars: { WINTER_T: -Infinity } });
    expect(tuningPatch({ 'realm.republic': 0.5, 'disaster.plagueLoss': [0.1, 0.3] })).toEqual({ polities: { REPUBLIC_P: 0.5 }, plague: { LOSS: [0.1, 0.3] } });
  });

  it('每一项的两头、全部拉到最左 / 最右:换出来的改动都是旋钮那一层认的(清理以后一样)', () => {
    for (const side of [0, 1] as const) {
      const all = Object.fromEntries(TUNING_ITEMS.map((x) => [x.id, tuningEnds(x)[side]]));
      const p = tuningPatch(all)!;
      expect(cleanKnobs(p)).toEqual(p);
      for (const x of TUNING_ITEMS) {
        const q = tuningPatch({ [x.id]: tuningEnds(x)[side] })!;
        expect(q, x.id).toBeDefined();
        expect(cleanKnobs(q), x.id).toEqual(q);
      }
    }
  });

  it('存的值能进 JSON(永不、关是字符串,不存 Infinity),读回来一样', () => {
    const v: TuningValues = { 'war.crush': 'never', 'war.winter': 'off', 'war.length': [2, 40], 'split.odds': 0, 'realm.republic': 0.25, 'court.maxAge': 100 };
    const back = cleanTuning(JSON.parse(JSON.stringify(v)));
    expect(back.values).toEqual(v);
    expect(back.notes).toEqual([]);
    expect(tuningPatch(JSON.parse(JSON.stringify(v)))).toEqual(tuningPatch(v));
  });
});

describe('清理读进来的值', () => {
  it('认不出的编号丢掉;不在档位上的吸到最近一档;超出范围拉回来;区间前大后小对调;每处一句提示', () => {
    const { values, notes } = cleanTuning({
      'war.odds': 2.2,
      'war.truce': 70,
      'war.length': [30, 4],
      'war.goal': [0, 100],
      'nope.x': 1,
      'split.odds': 0,
      'war.project': 0,
      'realm.republic': 0.63,
      'war.capital': 2.04,
      'war.rest': 4.2,
      'court.maxAge': 59.4,
    });
    expect(values).toEqual({
      'realm.republic': 0.65,
      'war.odds': 2,
      'war.truce': 60,
      'war.length': [4, 30],
      'war.project': 0.25,
      'war.goal': [1, 60],
      'war.capital': 2,
      'split.odds': 0,
      'court.maxAge': 60,
    });
    expect(notes).toContain('「nope.x」不是能调的项，略过');
    expect(notes).toContain('「战争多少」×2.2 不在档位上，按 ×2 算');
    expect(notes).toContain('「议和后几年不再开战」70 年超出范围（0–60 年），按 60 年算');
    expect(notes).toContain('「一场仗最多打几年」前一个数比后一个大，已对调');
    expect(notes).toContain('「远征吃力」不能关，按 ×¼ 算');
    expect(notes).toContain('「海边城邦多是共和国」6.3 成不在档位上，按 6.5 成算');
    // 吸到档上正好是官方值的不写(war.rest 4.2 → 4)
    expect('war.rest' in values).toBe(false);
    expect(notes.length).toBe(11);
  });

  it('和官方一样的不写、不提示;值认不出的按官方(提示);永不、关只认有这一档的项;整份不是对象的按官方', () => {
    expect(cleanTuning({ 'war.odds': 1, 'war.truce': 5, 'war.length': [5, 18] })).toEqual({ values: {}, notes: [] });
    const r = cleanTuning({ 'war.odds': 'x', 'war.truce': 'never', 'war.rest': 'off', 'war.length': [1], 'war.crush': Infinity, 'war.winter': -Infinity, 'war.grudge': NaN });
    expect(r.values).toEqual({ 'war.crush': 'never', 'war.winter': 'off' });
    expect(r.notes.length).toBe(5);
    expect(cleanTuning('war.odds=2')).toEqual({ values: {}, notes: ['规则的格式认不出，按官方规则算'] });
    expect(cleanTuning([1, 2]).values).toEqual({});
    expect(cleanTuning(null)).toEqual({ values: {}, notes: [] });
  });

  it('清理过的再清理一遍不变、没有提示;交出去的冻住', () => {
    const once = cleanTuning({ 'war.odds': 3.3, 'war.length': [50, 2], 'folk.treks': 25, 'disaster.plagueLoss': [0.3, 0.123] }).values;
    expect(cleanTuning(once)).toEqual({ values: once, notes: [] });
    expect(Object.isFrozen(once)).toBe(true);
  });

  it('倍数档:能关的 9 档、不能关的 8 档;每一档都认', () => {
    for (const x of TUNING_ITEMS) {
      if (x.kind !== 'mult') continue;
      expect(multSteps(x).length, x.id).toBe(x.off ? 9 : 8);
      for (const s of multSteps(x)) expect(cleanTuning({ [x.id]: s }).notes, `${x.id} ${s}`).toEqual([]);
    }
    expect(MULT_STEPS).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
  });
});

describe('写成字', () => {
  it('一项的值', () => {
    const t = (id: string, v: Parameters<typeof tuningValueText>[1]) => tuningValueText(tuningItem(id)!, v);
    expect(t('war.odds', 0.25)).toBe('×¼');
    expect(t('split.odds', 0)).toBe('不发生');
    expect(t('war.truce', 5)).toBe('5 年');
    expect(t('war.crush', 'never')).toBe('永不');
    expect(t('war.winter', 'off')).toBe('关');
    expect(t('war.winter', -3)).toBe('-3°C');
    expect(t('war.length', [5, 18])).toBe('5–18 年');
    expect(t('war.length', [7, 7])).toBe('7 年');
    expect(t('realm.republic', 0.75)).toBe('7.5 成');
    expect(t('disaster.plagueLoss', [0.08, 0.2])).toBe('8%–20%');
  });

  it('摘要:常用的排前面,最多列几项、后面省略;关掉的写"不……";没改 = 照官方', () => {
    expect(tuningSummary({})).toBe('照官方');
    expect(tuningSummary({ 'war.odds': 2, 'war.truce': 2, 'split.collapse': 2, 'split.dynasty': 0, 'war.rest': 9, 'folk.treks': 20 })).toBe(
      '改了 6 项：战争 ×2、议和后 2 年不再开战、大崩解 ×2……',
    );
    expect(tuningSummary({ 'war.rest': 9, 'split.dynasty': 0, 'folk.treks': 0, 'war.crush': 'never', 'disaster.plagueLoss': [0.1, 0.3] }, 9)).toBe(
      '改了 5 项：不打灭国之战、万世一系、没有大迁徙、瘟疫死 10%–30%、打完仗歇 9 年',
    );
    // 每一项的两头都写得出(不冒 undefined、NaN)
    for (const x of TUNING_ITEMS)
      for (const v of tuningEnds(x)) {
        const s = tuningSummary({ [x.id]: v });
        expect(s, x.id).toMatch(/^改了 1 项：/);
        expect(s, x.id).not.toMatch(/undefined|NaN|Infinity/);
      }
  });

  it('每组改了几项', () => {
    expect(tuningCounts({ 'war.odds': 2, 'war.truce': 2, 'split.collapse': 2, 'nope.x': 1, 'court.reign': 50 })).toEqual({
      realm: 0,
      war: 2,
      split: 1,
      diplo: 0,
      folk: 0,
      disaster: 0,
      court: 0,
    });
  });
});

describe('几项「关」真的不发生', () => {
  let w: World | undefined;
  const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 }));
  const kinds = (patch: ReturnType<typeof tuningPatch>, calamity?: 'many') => {
    const c = generateCiv(world(), { knobs: patch, ...(calamity ? { calamity } : {}) });
    return { c, n: (f: (e: (typeof c.annals)[number]) => boolean) => c.annals.filter(f).length };
  };

  it('不和亲(看邦交时结亲、议和时以和亲作结都关)、不立约(议和顺带立约也关)、不称臣(打不过时奉表称臣也关)、万世一系(权臣也不篡位)、不复国(分裂出去的新国都正好是故都也不算)、没有瘟疫(全球大疫照旧)、普通国家不出海', () => {
    const official = kinds(undefined);
    expect(official.n((e) => e.kind === 'marry')).toBeGreaterThan(0);
    expect(official.n((e) => e.kind === 'treaty')).toBeGreaterThan(0);
    expect(official.n((e) => e.kind === 'submit')).toBeGreaterThan(0);
    expect(official.n((e) => e.kind === 'dynasty')).toBeGreaterThan(0);
    expect(official.c.polities.some((p) => p.restores !== undefined)).toBe(true);
    expect(official.n((e) => e.kind === 'plague')).toBeGreaterThan(0);
    expect(official.c.polities.some((p) => p.sail !== undefined)).toBe(true);
    const off = kinds(tuningPatch({ 'diplo.marry': 0, 'diplo.treaty': 0, 'diplo.submit': 0, 'split.dynasty': 0, 'split.restore': 0, 'disaster.plague': 0, 'realm.sail': 0 }));
    expect(off.n((e) => e.kind === 'marry')).toBe(0);
    expect(off.n((e) => e.kind === 'treaty')).toBe(0);
    expect(off.n((e) => e.kind === 'submit')).toBe(0);
    expect(off.n((e) => e.kind === 'dynasty')).toBe(0);
    expect(off.c.polities.some((p) => p.restores !== undefined)).toBe(false);
    expect(off.n((e) => e.kind === 'plague' && e.cause !== 'pandemic')).toBe(0);
    expect(off.c.polities.some((p) => p.sail !== undefined)).toBe(false);
  });

  it('「天灾 很多」时大瘟疫的几率也跟着这一项:关成 0 就没有大瘟疫', () => {
    const many = kinds(undefined, 'many');
    expect(many.n((e) => e.kind === 'plague' && e.cause === 'great')).toBeGreaterThan(0);
    const none = kinds(tuningPatch({ 'disaster.great': 0 }), 'many');
    expect(none.n((e) => e.kind === 'plague' && e.cause === 'great')).toBe(0);
    expect(none.n((e) => e.kind === 'plague')).toBeGreaterThan(0);
  });
});
