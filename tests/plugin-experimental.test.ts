/**
 * 接口的稳定 / 实验两档:档表只写已有的项,没写档的是稳定档;
 * 用一套只在这里登记的假实验接口(能力、影响口、命令、生成的一步、帮手)走一遍清单 → 打包列出来
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addedExperimental, experimentalUses, type ExperimentalUse } from '../src/plugin/experimental';
import {
  CAP_TIER,
  MAP_HELPER_TIER,
  MAP_STAGE_TIER,
  PLUGIN_CAPS,
  SIM_COMMAND_TEXT,
  SIM_COMMAND_TIER,
  SIM_INFLUENCE_TEXT,
  SIM_INFLUENCE_TIER,
  type ApiTier,
  type PermissionKey,
} from '../src/plugin/pluginCaps';
import { MAP_STAGE_CAPS } from '../src/plugin/pluginMap';
import { experimentalNote, packPluginDir } from '../scripts/lib/pluginDir';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const TIERS: readonly ApiTier[] = ['stable', 'experimental'];

type Rec<T> = Record<string, T>;
const caps = PLUGIN_CAPS as Map<string, PermissionKey | null>;
const capTier = CAP_TIER as Rec<ApiTier>;
const commandText = SIM_COMMAND_TEXT as Rec<string>;
const commandTier = SIM_COMMAND_TIER as Rec<ApiTier>;
const influenceText = SIM_INFLUENCE_TEXT as Rec<string>;
const influenceTier = SIM_INFLUENCE_TIER as Rec<ApiTier>;
const stageCaps = MAP_STAGE_CAPS as Rec<string>;
const stageTier = MAP_STAGE_TIER as Rec<ApiTier>;
const helperTier = MAP_HELPER_TIER as Rec<ApiTier>;

/** 假的实验接口,另带两样没写档的新项(像别的改动加进登记表的那样) */
const FAKE = {
  cap: 'fake.peek@1',
  stageCap: 'gen.fakestep@1',
  plainCap: 'fake.plain@1',
  influence: 'fake.odds',
  command: 'fakewar',
  plainCommand: 'fakeplain',
  stage: 'fakestep',
  helper: 'fakeHelp',
};

function registerFakes(): () => void {
  caps.set(FAKE.cap, 'view');
  caps.set(FAKE.stageCap, 'mapSteer');
  caps.set(FAKE.plainCap, 'view');
  capTier[FAKE.cap] = 'experimental';
  capTier[FAKE.stageCap] = 'experimental';
  influenceText[FAKE.influence] = '假的影响口（按国）';
  influenceTier[FAKE.influence] = 'experimental';
  commandText[FAKE.command] = '假的命令';
  commandTier[FAKE.command] = 'experimental';
  commandText[FAKE.plainCommand] = '没写档的命令';
  stageCaps[FAKE.stage] = 'gen.fakestep';
  stageTier[FAKE.stage] = 'experimental';
  helperTier[FAKE.helper] = 'experimental';
  return () => {
    for (const c of [FAKE.cap, FAKE.stageCap, FAKE.plainCap]) {
      caps.delete(c);
      delete capTier[c];
    }
    delete influenceText[FAKE.influence];
    delete influenceTier[FAKE.influence];
    for (const k of [FAKE.command, FAKE.plainCommand]) {
      delete commandText[k];
      delete commandTier[k];
    }
    delete stageCaps[FAKE.stage];
    delete stageTier[FAKE.stage];
    delete helperTier[FAKE.helper];
  };
}

describe('档表', () => {
  it('写了档的都在各自的登记表里,档只有稳定、实验两种', () => {
    for (const [k, v] of Object.entries(CAP_TIER)) expect([k, PLUGIN_CAPS.has(k), TIERS.includes(v)]).toEqual([k, true, true]);
    for (const [k, v] of Object.entries(SIM_INFLUENCE_TIER)) expect([k, has(SIM_INFLUENCE_TEXT, k), TIERS.includes(v)]).toEqual([k, true, true]);
    for (const [k, v] of Object.entries(SIM_COMMAND_TIER)) expect([k, has(SIM_COMMAND_TEXT, k), TIERS.includes(v)]).toEqual([k, true, true]);
    for (const [k, v] of Object.entries(MAP_STAGE_TIER)) expect([k, has(MAP_STAGE_CAPS, k), TIERS.includes(v)]).toEqual([k, true, true]);
    for (const v of Object.values(MAP_HELPER_TIER)) expect(TIERS).toContain(v);
  });

  it('网站自己的登记表里没有假接口', () => {
    for (const k of [FAKE.cap, FAKE.stageCap, FAKE.plainCap]) expect(PLUGIN_CAPS.has(k)).toBe(false);
    expect(has(SIM_COMMAND_TEXT, FAKE.command) || has(SIM_INFLUENCE_TEXT, FAKE.influence) || has(MAP_STAGE_CAPS, FAKE.stage) || has(MAP_HELPER_TIER, FAKE.helper)).toBe(false);
  });
});

describe('用了哪些实验接口', () => {
  let undo: () => void;
  beforeAll(() => {
    undo = registerFakes();
  });
  afterAll(() => undo());

  it('只用稳定接口的:一样都没有', () => {
    expect(experimentalUses({ role: 'tool', requires: ['world.read@1', 'history.read@1'], optional: ['view.read@1'] })).toEqual([]);
    expect(experimentalUses({ role: 'sim', requires: ['sim.influence@1', 'sim.commands@1'], sim: { influences: ['war.odds'], commands: ['declare', 'ally'] } })).toEqual([]);
    expect(experimentalUses({ role: 'map', requires: ['gen.height@1'], map: { stages: ['height'] } }, 'civAtlas.map({ height(d) { return { elevation: d.blur(d.noise({ km: 800 }), 2) }; } });')).toEqual([]);
  });

  it('登记表里新加、没写档的项算稳定档', () => {
    expect(experimentalUses({ role: 'tool', requires: [FAKE.plainCap] })).toEqual([]);
    expect(experimentalUses({ role: 'sim', requires: ['sim.commands@1'], sim: { commands: [FAKE.plainCommand] } })).toEqual([]);
  });

  it('清单里的能力、影响口、命令、生成的一步,按这个先后列', () => {
    const uses = experimentalUses({
      role: 'map',
      requires: ['gen.height@1', FAKE.stageCap],
      optional: [FAKE.cap],
      sim: { influences: ['war.odds', FAKE.influence], commands: [FAKE.command, 'declare'] },
      map: { stages: [FAKE.stage, 'height'] },
    });
    expect(uses).toEqual([
      { what: '能力', name: FAKE.stageCap },
      { what: '能力', name: FAKE.cap },
      { what: '影响口', name: FAKE.influence },
      { what: '命令', name: FAKE.command },
      { what: '生成的一步', name: FAKE.stage },
    ]);
  });

  it('帮手看地图插件的代码:名字是一个完整的词才算', () => {
    const map = (code: string) => experimentalUses({ role: 'map', requires: ['gen.height@1'], map: { stages: ['height'] } }, code);
    const used = [{ what: '帮手', name: FAKE.helper }];
    expect(map(`civAtlas.map({ height(d) { return { elevation: d.${FAKE.helper}({ km: 100 }) }; } });`)).toEqual(used);
    expect(map(`const f = d['${FAKE.helper}'];`)).toEqual(used);
    expect(map(`height({ elevation, ${FAKE.helper} }) {}`)).toEqual(used);
    expect(map(`${FAKE.helper}(d)`)).toEqual(used);
    expect(map(`d.${FAKE.helper}er(); my${FAKE.helper}(); d.$${FAKE.helper}; ${FAKE.helper}_2;`)).toEqual([]);
    expect(map('')).toEqual([]);
    expect(experimentalUses({ role: 'map', requires: ['gen.height@1'], map: { stages: ['height'] } })).toEqual([]);
    expect(experimentalUses({ role: 'tool', requires: ['world.read@1'] }, `d.${FAKE.helper}()`)).toEqual([]);
  });

  it('清单里不是字的项不管', () => {
    expect(experimentalUses({ role: 'sim', requires: [1, FAKE.cap] as unknown as string[], sim: { commands: 'fakewar' as unknown as string[] } })).toEqual([{ what: '能力', name: FAKE.cap }]);
  });

  it('更新:新版多用的才算多要了', () => {
    const a: ExperimentalUse = { what: '能力', name: FAKE.cap };
    const b: ExperimentalUse = { what: '命令', name: FAKE.command };
    expect(addedExperimental([], [a])).toEqual([a]);
    expect(addedExperimental([a], [a, b])).toEqual([b]);
    expect(addedExperimental([a, b], [b])).toEqual([]);
    expect(addedExperimental([{ what: '影响口', name: FAKE.command }], [b])).toEqual([b]);
  });
});

describe('打包列出用了的实验接口', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plugin-experimental-'));
  let undo: () => void;
  beforeAll(() => {
    undo = registerFakes();
  });
  afterAll(() => {
    undo();
    rmSync(tmp, { recursive: true, force: true });
  });

  const write = (id: string, manifest: Record<string, unknown>, code: string): string => {
    const dir = join(tmp, id);
    mkdirSync(dir);
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ id, name: id, version: '1.0.0', api: 1, license: 'MIT', ...manifest }));
    writeFileSync(join(dir, 'main.js'), code);
    writeFileSync(join(dir, 'README.md'), `# ${id}\n`);
    writeFileSync(join(dir, 'LICENSE'), 'MIT License\n');
    return dir;
  };

  it('工具插件要了实验能力', async () => {
    const dir = write('fake-tool', { role: 'tool', runtime: 'worker', requires: ['world.read@1', FAKE.cap] }, 'civAtlas.log("hi");\n');
    const { experimental } = await packPluginDir(dir);
    expect(experimental).toEqual([{ what: '能力', name: FAKE.cap }]);
    expect(experimentalNote(experimental)).toBe(`用了实验接口(网站更新后可能失效):能力 ${FAKE.cap}`);
  });

  it('推演插件交数给实验影响口、下实验命令', async () => {
    const sim = { influences: ['war.odds', FAKE.influence], commands: ['declare', FAKE.command] };
    const dir = write('fake-sim', { role: 'sim', runtime: 'quickjs', requires: ['sim.influence@1', 'sim.commands@1'], sim }, 'civAtlas.sim({ act() {} });\n');
    const { experimental } = await packPluginDir(dir);
    expect(experimentalNote(experimental)).toBe(`用了实验接口(网站更新后可能失效):影响口 ${FAKE.influence}、命令 ${FAKE.command}`);
  });

  it('地图插件在实验的一步出手、调实验帮手', async () => {
    const code = `civAtlas.map({\n  height(d) { return { elevation: d.${FAKE.helper}({ km: 100 }) }; },\n  ${FAKE.stage}() {},\n});\n`;
    const dir = write('fake-map', { role: 'map', runtime: 'quickjs', requires: ['gen.height@1', FAKE.stageCap], map: { stages: ['height', FAKE.stage] } }, code);
    const { experimental } = await packPluginDir(dir);
    expect(experimentalNote(experimental)).toBe(`用了实验接口(网站更新后可能失效):能力 ${FAKE.stageCap}、生成的一步 ${FAKE.stage}、帮手 d.${FAKE.helper}`);
  });

  it('假接口拿掉以后,同一个插件打不成', async () => {
    undo();
    try {
      await expect(packPluginDir(join(tmp, 'fake-tool'))).rejects.toThrow(`插件要的 ${FAKE.cap} 这一版网站还没有`);
    } finally {
      undo = registerFakes();
    }
  });

  it('示例插件只用稳定接口,打包不多打一行', async () => {
    const { experimental } = await packPluginDir(join(process.cwd(), 'examples', 'plugins', 'route-days'));
    expect(experimental).toEqual([]);
    expect(experimentalNote(experimental)).toBeNull();
  });
});
