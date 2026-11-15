/**
 * 推演插件状态块(sim.<插件编号>)换版:相邻两版的软件互相读对方存的世界。
 * 老一版读新一版的块:世界照常打开,块只当字节留着(不拿认不得的口名报坏);新一版读老一版的块:照常核对、接回状态。
 * 「第 v 版的软件」= 把 SIM_STATE_SCHEMA 换成 v、登记的影响口只留第 v 版以前有的,另起一份模块来读写
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { chronicleBlock } from '../src/gen/civ/story/nameTokens';
import { flagBook } from '../src/gen/civ/story/flags';
import { OFFICIAL_INFLUENCES } from '../src/gen/civ/influence';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { SIM_STATE_SCHEMA } from '../src/gen/worldFormat';
import { ZIP_UPLOAD_MAX_BYTES } from '../src/gen/zipStore';
import type { PackInput } from '../src/gen/worldFile';
import { MADE, READERS, bytesOf } from './lib/worldFileSample';
import { steady, type Point } from './lib/influencePlugins';

/** 各版状态块里新能出现的影响口(第 1 版 = 一开始的那几个,不列);状态块再升版时在这里加一行 */
const ADDED: Readonly<Record<number, readonly Point[]>> = {
  2: ['revolt.odds', 'collapse.odds', 'claim.odds', 'warlord.odds', 'merge.odds', 'restore.odds', 'alliance.odds', 'submit.odds', 'defect.odds', 'treaty.odds', 'marry.odds', 'aid.odds', 'war.length', 'war.goal'],
  3: ['sack.odds', 'ruin.odds', 'rebuild.odds', 'defense.power', 'plague.spread', 'famine.odds', 'diverge.odds', 'trek.odds'],
};
const sinceOf = (id: string): number => Number(Object.keys(ADDED).find((v) => ADDED[+v].includes(id as Point)) ?? 1);
/** 第 v 版新能出现的一个口(第 1 版拿 war.odds) */
const pointOf = (v: number): Point => (v === 1 ? 'war.odds' : ADDED[v][0]);

type WorldFileModule = typeof import('../src/gen/worldFile');
type InfluenceModule = typeof import('../src/gen/civ/influence');
type FormatModule = typeof import('../src/gen/worldFormat');

/** 第 v 版的软件读写世界文件的那一份模块 */
async function software(v: number): Promise<WorldFileModule> {
  vi.resetModules();
  vi.doMock('../src/gen/worldFormat', async (orig) => ({ ...(await orig<FormatModule>()), SIM_STATE_SCHEMA: v }));
  vi.doMock('../src/gen/civ/influence', async (orig) => {
    const m = await orig<InfluenceModule>();
    return { ...m, OFFICIAL_INFLUENCES: m.OFFICIAL_INFLUENCES.filter((p) => sinceOf(p.id) <= v) };
  });
  try {
    return await import('../src/gen/worldFile');
  } finally {
    vi.doUnmock('../src/gen/worldFormat');
    vi.doUnmock('../src/gen/civ/influence');
  }
}

const params = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
let world: World;
const civs = new Map<number, Civ>();
/** 带一个插件推到第 700 年,插件交给第 v 版新能出现的那个口 */
function civOf(v: number): Civ {
  let c = civs.get(v);
  if (!c) civs.set(v, (c = generateCiv(world, { endYear: 700, plugins: [steady('p', { [pointOf(v)]: 1.5 })] })));
  return c;
}
function input(c: Civ): PackInput {
  return {
    id: 'wver',
    title: '插件世界',
    made: MADE,
    readers: READERS,
    recipe: makeSave(params, { names: {}, interventions: [], terrain: [], upheavals: [] }, worldCheck(world), '插件世界', '2026-11-15T08:00:00.000Z', { projection: 'robinson', center: 120 }),
    map: world,
    civ: c,
    chronicle: chronicleBlock(c),
    flags: flagBook(world, c),
  };
}
/** 第 w 版的软件把 civ 存成文件 */
const packBy = async (w: number, c: Civ) => bytesOf(await (await software(w)).packWorldFile(input(c)));

beforeAll(() => {
  world = generateWorld(params);
}, 60_000);

describe('推演插件状态块:相邻两版互相读', () => {
  it('登记表:最新一版就是现在的 SIM_STATE_SCHEMA,列的口都登记了;第 1 版以后登记的口都列在哪一版', () => {
    expect(Math.max(1, ...Object.keys(ADDED).map(Number))).toBe(SIM_STATE_SCHEMA);
    const all = OFFICIAL_INFLUENCES.map((p) => p.id);
    for (const v of Object.keys(ADDED)) for (const id of ADDED[+v]) expect(all, id).toContain(id);
    // 第 1 版的口:插件第 1 版就有的那 12 个
    expect(all.filter((id) => sinceOf(id) === 1)).toHaveLength(12);
  });

  for (let v = 1; v < SIM_STATE_SCHEMA; v++) {
    it(`第 ${v} 版读第 ${v + 1} 版存的:世界打得开,状态块只当字节留着,接着推时从头推;要是没升版就会被当成坏块`, async () => {
      const c = civOf(v + 1);
      const f = await packBy(v + 1, c);
      const old = await software(v);
      const opened = await old.openWorldFile(f, { readers: READERS });
      expect(opened.kept.map((p) => p.name)).toEqual(['sim.p']);
      expect(old.opaqueParts(opened.manifest.parts)).toEqual(['sim.p']);
      const content = await old.readWorldContent(opened);
      expect(content.civ.annals.length).toBe(c.annals.length);
      expect('simPlugins' in content.civ).toBe(false);
      expect(content.skipped).toEqual([]);
      expect(startContinue(world, content.civ, { endYear: 800, plugins: [steady('p', { [pointOf(v + 1)]: 1.5 })] }), '接不上').toBeNull();
      // 传上服务器(没重打的校验器就是老一版):也打得开,只是带着看不懂的块
      const up = await old.readWorldContent(await old.openWorldFile(f, { readers: READERS, maxBytes: ZIP_UPLOAD_MAX_BYTES }));
      expect('simPlugins' in up.civ).toBe(false);
      // 新口名写进第 v 版的块:老一版本机读时这块不要,传上服务器算坏
      const same = await packBy(v, c);
      expect((await old.readWorldContent(await old.openWorldFile(same, { readers: READERS }))).skipped).toEqual(['sim.p']);
      await expect(old.readWorldContent(await old.openWorldFile(same, { readers: READERS, maxBytes: ZIP_UPLOAD_MAX_BYTES }))).rejects.toMatchObject({ kind: 'broken' });
    }, 120_000);

    it(`第 ${v + 1} 版读第 ${v} 版和第 ${v + 1} 版存的:照常核对、接回状态`, async () => {
      const now = await software(v + 1);
      for (const [w, c] of [
        [v, civOf(v)],
        [v + 1, civOf(v + 1)],
      ] as const) {
        const opened = await now.openWorldFile(await packBy(w, c), { readers: READERS, maxBytes: ZIP_UPLOAD_MAX_BYTES });
        expect(opened.kept, `第 ${w} 版存的`).toEqual([]);
        const content = await now.readWorldContent(opened);
        expect(content.civ.simPlugins, `第 ${w} 版存的`).toEqual(c.simPlugins);
      }
    }, 120_000);
  }
});
