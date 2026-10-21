/**
 * 逐年推演的地基(gen/civ/play.ts):停在第 T 年年初下命令、接着推。
 * - 每 25 年停一次、每次下 1–3 条命令推到第 1500 年:和带着同样的命令从第 0 年一口气推到同一刻逐项一样(seed 7 / 2024)
 * - 同一年下的几条命令按先后执行,换个先后结果跟着换,同样的先后两次推演一样
 * - 命令只能下在"现在":早于、晚于现在的不收,结果和没下一样
 * - 存档往返:推到第 T 年存下、读回、接着推,和不存档直接推一样(按存档重新推、读原件接着推都行);没在逐年推演的旧存档照旧
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { Layer } from '../src/gen/civ/types';
import { playCiv, playStop, playTurn } from '../src/gen/civ/play';
import { INTERVENTION_YEAR_MAX, cleanPlay, issueCommands, playInterventions, polityKey, regionKey, settlementKey, type Intervention, type PlayState, type WorldEdits } from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { packValue, recipeOfSave, recipeText, unpackValue } from '../src/gen/snapshot';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};

const KINDS = ['declare', 'ally', 'move', 'cede', 'found', 'halt', 'protect', 'unity'] as const;

/** 第 T 年年初给 civ 下 1–3 条命令(按种子和年份定的伪随机,挑当时还在的国家、它们的城和州) */
function orders(civ: Civ, T: number): Intervention[] {
  let s = (T * 7919 + civ.seed * 31) >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const alive = civ.polities.filter((p) => p.ended === undefined);
  if (alive.length < 2) return [];
  const out: Intervention[] = [];
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = alive[Math.floor(rnd() * alive.length)];
    const b = alive.filter((p) => p !== a)[Math.floor(rnd() * (alive.length - 1))];
    const A = polityKey(civ, a.id);
    const B = polityKey(civ, b.id);
    const kind = KINDS[Math.floor(rnd() * KINDS.length)];
    if (kind === 'declare') out.push({ kind, a: A, b: B, from: T });
    else if (kind === 'ally') out.push({ kind, a: A, b: B, from: T, until: T + 60 });
    else if (kind === 'halt') out.push({ kind, a: A, from: T, until: T + 40 });
    else if (kind === 'protect' || kind === 'unity') out.push({ kind, a: A, from: T });
    else if (kind === 'move') {
      const c = civ.settlements.find((x) => x.ended === undefined && civ.polity[x.region] === a.id && x.id !== a.capital);
      if (c) out.push({ kind, a: A, city: settlementKey(civ, c.id), from: T });
    } else if (kind === 'cede') {
      const r = civ.polity.indexOf(b.id);
      if (r >= 0) out.push({ kind, a: A, region: regionKey(civ, r), from: T });
    } else {
      const c = civ.settlements.find((x) => x.ended === undefined && civ.polity[x.region] === b.id && !civ.polities.some((p) => p.capital === x.id));
      if (c) out.push({ kind, region: regionKey(civ, c.region), from: T });
    }
  }
  return out;
}

/** 从第 25 年起每 25 年一步推到第 to 年年初,每一步下 orders 挑的命令 */
function playUntil(w: World, to: number, start: PlayState = { year: 25, commands: [] }, civ0?: Civ) {
  let play = start;
  let civ = civ0 ?? playCiv(w, {}, play);
  while (play.year < to) {
    const r = playTurn(w, civ, {}, play, orders(civ, play.year), Math.min(25, to - play.year));
    expect(r.rejected, `第 ${play.year} 年`).toEqual([]);
    civ = r.civ;
    play = r.play;
  }
  return { civ, play };
}

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

/** 第 year 年那一刻州 r 最后归了哪国(变化日志) */
function ownerAfter(civ: Civ, r: number, year: number): number {
  let v = -2;
  const L = civ.log;
  for (let i = 0; i < L.size; i++) if (L.year[i] === year && L.region[i] === r && L.layer[i] === Layer.Polity) v = L.value[i];
  return v;
}

describe('逐年推演:停在第 T 年下命令,接着推', () => {
  it('每 25 年停一次、每次下 1–3 条命令推到第 1500 年:和带着同样的命令一口气推完逐项一样(seed 7 / 2024)', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const { civ, play } = playUntil(w, 1500);
      expect(play.year).toBe(1500);
      expect(civ.endYear).toBe(playStop(1500));
      // 每种命令都下过,每条命令都在它那一年记了一条史事
      expect(new Set(play.commands.map((v) => v.kind)), `seed ${seed}`).toEqual(new Set(KINDS));
      const iv = civ.annals.filter((e) => e.kind === 'intervene');
      expect(iv.length, `seed ${seed}`).toBe(play.commands.length);
      for (const e of iv) expect(Math.floor(e.year), `seed ${seed}`).toBe(play.commands[e.war].from);
      same(civ, generateCiv(w, { endYear: playStop(1500), interventions: play.commands }), `seed ${seed}`);
    }
  }, 600_000);

  it('同一年下的几条命令按先后执行:换个先后结果跟着换,同样的先后两次一样', () => {
    const w = world(7);
    const civ = playCiv(w, {}, { year: 600, commands: [] });
    const alive = civ.polities.filter((p) => p.ended === undefined);
    const [x, y] = alive;
    // 第三国的一州(不是国都),先划给 x 再划给 y
    const z = alive.find((p) => p !== x && p !== y)!;
    const r = civ.polity.findIndex((o, i) => o === z.id && civ.settlements[z.capital].region !== i);
    expect(r).toBeGreaterThanOrEqual(0);
    const cede = (p: typeof x): Intervention => ({ kind: 'cede', a: polityKey(civ, p.id), region: regionKey(civ, r), from: 600 });
    const play: PlayState = { year: 600, commands: [] };
    const xy = playTurn(w, civ, {}, play, [cede(x), cede(y)], 25);
    const yx = playTurn(w, civ, {}, play, [cede(y), cede(x)], 25);
    expect(ownerAfter(xy.civ, r, 600)).toBe(y.id);
    expect(ownerAfter(yx.civ, r, 600)).toBe(x.id);
    same(playTurn(w, civ, {}, play, [cede(x), cede(y)], 25).civ, xy.civ, '再推一次');
    expect(xy.play.commands).toEqual([cede(x), cede(y)]);
  }, 120_000);

  it('命令只能下在"现在":早于、晚于现在的、格式不对的不收,结果和没下一样', () => {
    const w = world(2024);
    const play: PlayState = { year: 700, commands: [] };
    const civ = playCiv(w, {}, play);
    const [a, b] = civ.polities.filter((p) => p.ended === undefined);
    const ok: Intervention = { kind: 'declare', a: polityKey(civ, a.id), b: polityKey(civ, b.id), from: 700 };
    const early = { ...ok, from: 650 };
    const late = { ...ok, from: 701 };
    const bad = { kind: 'declare', a: 'polity:?', from: 700 };
    const got = playTurn(w, civ, {}, play, [early, ok, late, bad], 25);
    expect(got.rejected).toEqual([early, late, bad]);
    expect(got.play).toEqual({ year: 725, commands: [ok] });
    same(got.civ, playTurn(w, civ, {}, play, [ok], 25).civ, '不收的命令');
    expect(issueCommands(play, [early]).play.commands).toEqual([]);
    // 推到能推的最后一年:推不动了,命令一条也不收
    const last: PlayState = { year: INTERVENTION_YEAR_MAX, commands: [] };
    const stuck = playTurn(w, civ, {}, last, [{ ...ok, from: INTERVENTION_YEAR_MAX }], 25);
    expect(stuck.play).toBe(last);
    expect(stuck.rejected).toHaveLength(1);
  }, 120_000);

  it('存档往返:推到第 T 年存下、读回、接着推,和不存档直接推一样;没在逐年推演的旧存档照旧', () => {
    const w = world(7);
    const mid = playUntil(w, 300);
    const edits: WorldEdits = { names: {}, interventions: [], terrain: [], play: mid.play };
    const r = parseSave(saveText(makeSave(w.params, edits, 'x')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    const play = r.save.edits.play!;
    expect(play).toEqual(mid.play);
    // 按存档重新推到那一刻 = 一回回推过来的
    const again = playCiv(w, {}, play);
    same(again, mid.civ, '按存档重推');
    // 读原件(整段历史打包再读回)、按存档重推,接着推到第 600 年:都和不存档直接推一样
    const direct = playUntil(w, 600, mid.play, mid.civ);
    same(playUntil(w, 600, play, unpackValue(packValue(mid.civ)) as Civ).civ, direct.civ, '读原件接着推');
    same(playUntil(w, 600, play, again).civ, direct.civ, '按存档重推再接着推');
    // 配方:在逐年推演的记进度;没在逐年推演的和加这一项以前一样
    expect(recipeText(recipeOfSave(r.save))).toContain('"play"');
    const old = parseSave(saveText(makeSave(w.params, { names: {}, interventions: [], terrain: [] }, 'x')));
    expect(old.ok && 'play' in old.save.edits).toBe(false);
    expect(old.ok && recipeText(recipeOfSave(old.save))).not.toContain('play');
  }, 300_000);

  it('读进来的进度先清理:年份不对 = 没在逐年推演;晚于现在、比前一条早、格式不对的命令丢掉', () => {
    const v = (from: number): Intervention => ({ kind: 'unity', a: 'polity:c12#0', from });
    expect(cleanPlay(undefined)).toBeUndefined();
    expect(cleanPlay({ year: -1, commands: [] })).toBeUndefined();
    expect(cleanPlay({ year: 12.5, commands: [] })).toBeUndefined();
    const ok = { year: 300, commands: [v(100), v(100), v(200)] };
    expect(cleanPlay(ok)).toBe(ok);
    expect(cleanPlay({ year: 300, commands: [v(200), v(100), v(400), { kind: 'x' }, v(300)] })).toEqual({ year: 300, commands: [v(200), v(300)] });
    expect(cleanPlay({ year: 300 })).toEqual({ year: 300, commands: [] });
    expect(playInterventions([v(5)], { year: 300, commands: [v(100)] })).toEqual([v(5), v(100)]);
    const r = parseSave(JSON.stringify({ ...JSON.parse(saveText(makeSave(DEFAULT_PARAMS, { names: {}, interventions: [], terrain: [] }, 'x'))), edits: { names: {}, interventions: [], terrain: [], play: { year: 'x' } } }));
    expect(r.ok && r.save.edits.play).toBeUndefined();
    expect(r.ok && r.warnings).toContain('逐年推演的进度认不出来,已跳过');
  });
});
