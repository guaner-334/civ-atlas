/**
 * 逐年推演停在年中(gen/civ/play.ts 的 playTicks / playTo;时刻见 gen/edits.ts 文件头"时刻"):
 * - 一步走几格(有一格一格走的、有跨好几年的),每一步停在那一格下 1–3 条命令:和带着同样的命令从第 0 年一口气推到同一刻逐项一样(seed 7 / 2024)
 * - 年中下的命令就在那一格生效(史事记在那一刻),不是那一年年初
 * - 同一格里的几条命令按先后执行:换个先后结果跟着换,同样的先后两次一样
 * - 推到任一刻(playTo):夹在"至少下一格、最多 PLAY_TICKS_MAX 格"里;一步走几年从年中出发停在几年以后的同一格
 * - 停在年中存档、读回、按存档重推:和一步步推过来的一样
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { Layer } from '../src/gen/civ/types';
import { PLAY_TICKS_MAX, playCiv, playStop, playTicks, playTo, playTurn } from '../src/gen/civ/play';
import { YEAR_TICKS, playAt, polityKey, regionKey, settlementKey, ticksAt, type Intervention, type PlayState, type WorldEdits } from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};

const KINDS = ['declare', 'ally', 'move', 'cede', 'found', 'halt', 'protect', 'unity'] as const;

/** 在进度那一刻(年 + 第几格)给 civ 下 1–3 条命令(按种子和时刻定的伪随机,挑当时还在的国家、它们的城和州) */
function orders(civ: Civ, play: PlayState): Intervention[] {
  const T = play.year;
  const at = play.tick ? { fromTick: play.tick } : {};
  let s = (playAt(play) * 7919 + civ.seed * 31) >>> 0;
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
    if (kind === 'declare') out.push({ kind, a: A, b: B, from: T, ...at });
    else if (kind === 'ally') out.push({ kind, a: A, b: B, from: T, until: T + 60, ...at });
    else if (kind === 'halt') out.push({ kind, a: A, from: T, until: T + 40, ...at });
    else if (kind === 'protect' || kind === 'unity') out.push({ kind, a: A, from: T, ...at });
    else if (kind === 'move') {
      const c = civ.settlements.find((x) => x.ended === undefined && civ.polity[x.region] === a.id && x.id !== a.capital);
      if (c) out.push({ kind, a: A, city: settlementKey(civ, c.id), from: T, ...at });
    } else if (kind === 'cede') {
      const r = civ.polity.indexOf(b.id);
      if (r >= 0) out.push({ kind, a: A, region: regionKey(civ, r), from: T, ...at });
    } else {
      const c = civ.settlements.find((x) => x.ended === undefined && civ.polity[x.region] === b.id && !civ.polities.some((p) => p.capital === x.id));
      if (c) out.push({ kind, region: regionKey(civ, c.region), from: T, ...at });
    }
  }
  return out;
}

/** 一步走几格,轮着用:跨好几年的、几十格的、一格一格的(连着两步各一格:相邻两格都下命令) */
const STEPS = [3001, 37, 1, 1, 5120, 255, 2, 7777, 64, 1, 4000, 129];

/** 从 start 起一步步走到第 to 格(ticksAt),每一步在停下的那一格下 orders 挑的命令 */
function playUntil(w: World, to: number, start: PlayState) {
  let play = start;
  let civ = playCiv(w, {}, play);
  let i = 0;
  while (playAt(play) < to) {
    const n = Math.min(STEPS[i++ % STEPS.length], to - playAt(play));
    const r = playTicks(w, civ, {}, play, orders(civ, play), n);
    expect(r.rejected, `第 ${play.year} 年第 ${play.tick ?? 0} 格`).toEqual([]);
    expect(playAt(r.play)).toBe(playAt(play) + n);
    civ = r.civ;
    play = r.play;
  }
  return { civ, play, steps: i };
}

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

describe('逐年推演停在年中:分段推 = 一口气推', () => {
  it('一步走几格、每一步在停下的那一格下 1–3 条命令,从第 540 年年中推到第 1100 年第 77 格:和带着同样的命令一口气推完逐项一样(seed 7 / 2024)', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const to = ticksAt(1100, 77);
      const { civ, play, steps } = playUntil(w, to, { year: 540, tick: 200, commands: [] });
      expect(steps).toBeGreaterThan(30);
      expect(play.year).toBe(1100);
      expect(play.tick).toBe(77);
      expect(civ.endYear).toBe(playStop(1100, 77));
      // 年中下过命令(不只是年初的)
      expect(play.commands.filter((v) => v.fromTick).length, `seed ${seed}`).toBeGreaterThan(10);
      const once = generateCiv(w, { endYear: playStop(1100, 77), interventions: play.commands });
      same(civ, once, `seed ${seed}`);
      // 年中下的命令在那一格生效:有史事的,记在那一刻(不是那一年年初)
      let checked = 0;
      for (const e of civ.annals) {
        if (e.kind !== 'intervene') continue;
        const v = civ.interventions?.[e.war];
        if (!v?.fromTick) continue;
        expect(e.year, `seed ${seed} 第 ${e.war} 条`).toBe(v.from + v.fromTick / YEAR_TICKS);
        checked++;
      }
      expect(checked, `seed ${seed}`).toBeGreaterThan(5);
      // 停在年中存档、读回、按存档重推:和一步步推过来的一样
      const edits: WorldEdits = { names: {}, interventions: [], terrain: [], play };
      const r = parseSave(saveText(makeSave(w.params, edits, 'x')));
      expect(r.ok && r.warnings).toEqual([]);
      if (!r.ok) return;
      expect(r.save.format).toBe(2);
      expect(r.save.edits.play).toEqual(play);
      same(playCiv(w, {}, r.save.edits.play!), civ, `seed ${seed} 按存档重推`);
    }
  }, 600_000);

  it('同一格里的几条命令按先后执行:换个先后结果跟着换,同样的先后两次一样', () => {
    const w = world(7);
    const play: PlayState = { year: 600, tick: 150, commands: [] };
    const civ = playCiv(w, {}, play);
    const alive = civ.polities.filter((p) => p.ended === undefined);
    const [x, y] = alive;
    // 第三国的一州(不是国都),先划给 x 再划给 y
    const z = alive.find((p) => p !== x && p !== y)!;
    const r = civ.polity.findIndex((o, i) => o === z.id && civ.settlements[z.capital].region !== i);
    expect(r).toBeGreaterThanOrEqual(0);
    const cede = (p: typeof x): Intervention => ({ kind: 'cede', a: polityKey(civ, p.id), region: regionKey(civ, r), from: 600, fromTick: 150 });
    const xy = playTicks(w, civ, {}, play, [cede(x), cede(y)], 300);
    const yx = playTicks(w, civ, {}, play, [cede(y), cede(x)], 300);
    expect(xy.rejected).toEqual([]);
    expect(xy.play.commands).toEqual([cede(x), cede(y)]);
    // 后下的那条盖过先下的:那一格这一州最后归后下令的那一国(年初那一刻没动)
    const owner = (c: Civ, at: number) => {
      let v = -2;
      for (let i = 0; i < c.log.size; i++) if (c.log.year[i] === at && c.log.region[i] === r && c.log.layer[i] === Layer.Polity) v = c.log.value[i];
      return v;
    };
    const at = 600 + 150 / YEAR_TICKS;
    expect(owner(xy.civ, at)).toBe(y.id);
    expect(owner(yx.civ, at)).toBe(x.id);
    same(playTicks(w, civ, {}, play, [cede(x), cede(y)], 300).civ, xy.civ, '再推一次');
    same(xy.civ, generateCiv(w, { endYear: playStop(601, 194), interventions: xy.play.commands }), '一口气推');
  }, 300_000);

  it('推到任一刻:至少下一格、最多 PLAY_TICKS_MAX 格;从年中走几年停在几年以后的同一格;年初走几年和以前一样', () => {
    const w = world(7);
    const play: PlayState = { year: 300, tick: 40, commands: [] };
    const civ = playCiv(w, {}, play);
    expect(playTo(w, civ, {}, play, [], { year: 299, tick: 0 }).play).toEqual({ year: 300, tick: 41, commands: [] });
    expect(playTo(w, civ, {}, play, [], { year: 301, tick: 999 }).play).toEqual({ year: 301, tick: 255, commands: [] });
    expect(playAt(playTo(w, civ, {}, play, [], { year: 9000, tick: 0 }).play)).toBe(playAt(play) + PLAY_TICKS_MAX);
    const t = playTurn(w, civ, {}, play, [], 3);
    expect(t.play).toEqual({ year: 303, tick: 40, commands: [] });
    expect(t.civ.endYear).toBe(playStop(303, 40));
    // 年初走几年:停在几年以后的年初,和一口气推到那一年年初一样
    const y0: PlayState = { year: 300, commands: [] };
    const c0 = playCiv(w, {}, y0);
    const t0 = playTurn(w, c0, {}, y0, [], 2);
    expect(t0.play).toEqual({ year: 302, commands: [] });
    same(t0.civ, generateCiv(w, { endYear: playStop(302) }), '年初走两年');
  }, 300_000);
});
