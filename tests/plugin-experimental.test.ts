/**
 * 接口的稳定 / 实验两档:档表只写已有的项(拿掉了的留着),没写档的是稳定档;实验接口在文档、类型定义里都标了。
 * 用一套只在这里登记的假实验接口(能力、影响口、命令、生成的一步、帮手)走一遍清单 → 打包列出来 → 文档漏标就报
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mesh } from '../src/gen/mesh';
import { mapHelpers } from '../src/gen/mapHelpers';
import { addedExperimental, experimentalUses, removedUses, type ExperimentalUse } from '../src/plugin/experimental';
import { CAP_TIER, MAP_HELPER_TIER, MAP_STAGE_TIER, SIM_COMMAND_TIER, SIM_INFLUENCE_TIER, type TierNote } from '../src/plugin/apiTier';
import { checkCaps } from '../src/plugin/caps';
import { EXPERIMENTAL_PERMISSION, PLUGIN_CAPS, SIM_COMMAND_TEXT, SIM_INFLUENCE_TEXT, permissionLines, type PermissionKey } from '../src/plugin/pluginCaps';
import { GONE_MARK, PluginFileError, openPluginFile, packPluginFile, type PluginPackInput } from '../src/plugin/pluginFile';
import { MAP_STAGE_CAPS } from '../src/plugin/pluginMap';
import { capChips, usesExperimental } from '../src/ui/plugins/galleryPlugin';
import { addedLines } from '../src/ui/plugins/pluginText';
import { loadMapFile } from '../src/mapPluginRun';
import { experimentalNote, packPluginDir } from '../scripts/lib/pluginDir';
import { TIER_MARK, markProblems, tierTableProblems } from './lib/experimentalMarks';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const repo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const SITE: string = JSON.parse(repo('package.json')).version;
const HELPERS = Object.keys(mapHelpers({ n: 0, xyz: new Float32Array(0), width: 1 } as unknown as Mesh, 0, 'x'));

type Rec<T> = Record<string, T>;
const caps = PLUGIN_CAPS as Map<string, PermissionKey | null>;
const capTier = CAP_TIER as Rec<TierNote>;
const commandText = SIM_COMMAND_TEXT as Rec<string>;
const commandTier = SIM_COMMAND_TIER as Rec<TierNote>;
const influenceText = SIM_INFLUENCE_TEXT as Rec<string>;
const influenceTier = SIM_INFLUENCE_TIER as Rec<TierNote>;
const stageCaps = MAP_STAGE_CAPS as Rec<string>;
const stageTier = MAP_STAGE_TIER as Rec<TierNote>;
const helperTier = MAP_HELPER_TIER as Rec<TierNote>;

/** 假的实验接口(都是 1.7.0 开的);两样没写档的新项(像别的改动加进登记表的那样);两样 1.8.0 拿掉了的 */
const FAKE = {
  cap: 'fake.peek@1',
  stageCap: 'gen.fakestep@1',
  plainCap: 'fake.plain@1',
  goneCap: 'fake.gone@1',
  influence: 'fake.odds',
  command: 'fakewar',
  plainCommand: 'fakeplain',
  goneCommand: 'fakegone',
  stage: 'fakestep',
  helper: 'fakeHelp',
};
/** 给用的人看的名字 */
const LABEL: Record<string, string> = {
  [FAKE.cap]: '偷看',
  [FAKE.stageCap]: '假的一步的能力',
  [FAKE.goneCap]: '播放时间轴',
  [FAKE.influence]: '假的影响口',
  [FAKE.command]: '假的命令',
  [FAKE.goneCommand]: '拿掉的命令',
  [FAKE.stage]: '假的一步',
  [FAKE.helper]: '假帮手',
};
const open = (name: string): TierNote => ({ tier: 'experimental', label: LABEL[name], since: '1.7.0' });
const gone = (name: string): TierNote => ({ tier: 'experimental', label: LABEL[name], since: '1.7.0', changed: ['1.7.1'], removed: '1.8.0' });
const use = (what: ExperimentalUse['what'], name: string): ExperimentalUse => ({ what, name, label: LABEL[name] });

function registerFakes(): () => void {
  caps.set(FAKE.cap, 'view');
  caps.set(FAKE.stageCap, 'mapSteer');
  caps.set(FAKE.plainCap, 'view');
  capTier[FAKE.cap] = open(FAKE.cap);
  capTier[FAKE.stageCap] = open(FAKE.stageCap);
  capTier[FAKE.goneCap] = gone(FAKE.goneCap);
  influenceText[FAKE.influence] = '假的影响口（按国）';
  influenceTier[FAKE.influence] = open(FAKE.influence);
  commandText[FAKE.command] = '假的命令';
  commandTier[FAKE.command] = open(FAKE.command);
  commandText[FAKE.plainCommand] = '没写档的命令';
  commandTier[FAKE.goneCommand] = gone(FAKE.goneCommand);
  stageCaps[FAKE.stage] = 'gen.fakestep';
  stageTier[FAKE.stage] = open(FAKE.stage);
  helperTier[FAKE.helper] = open(FAKE.helper);
  return () => {
    for (const c of [FAKE.cap, FAKE.stageCap, FAKE.plainCap, FAKE.goneCap]) {
      caps.delete(c);
      delete capTier[c];
    }
    delete influenceText[FAKE.influence];
    delete influenceTier[FAKE.influence];
    for (const k of [FAKE.command, FAKE.plainCommand, FAKE.goneCommand]) {
      delete commandText[k];
      delete commandTier[k];
    }
    delete stageCaps[FAKE.stage];
    delete stageTier[FAKE.stage];
    delete helperTier[FAKE.helper];
  };
}

describe('档表', () => {
  it('网站自己的档表:在不在登记表里、版本都对得上', () => {
    expect(tierTableProblems(HELPERS, SITE)).toEqual([]);
  });

  it('网站自己的登记表里没有假接口', () => {
    for (const k of [FAKE.cap, FAKE.stageCap, FAKE.plainCap, FAKE.goneCap]) expect(PLUGIN_CAPS.has(k)).toBe(false);
    expect(has(SIM_COMMAND_TEXT, FAKE.command) || has(SIM_INFLUENCE_TEXT, FAKE.influence) || has(MAP_STAGE_CAPS, FAKE.stage) || has(MAP_HELPER_TIER, FAKE.helper)).toBe(false);
  });

  describe('登记了假接口', () => {
    let undo: () => void;
    beforeAll(() => {
      undo = registerFakes();
    });
    afterAll(() => undo());

    it('拿掉了的留在档表、不在登记表,对得上', () => {
      expect(tierTableProblems([...HELPERS, FAKE.helper], '1.7.0')).toEqual([]);
    });

    it('没拿掉却不在登记表、拿掉了还在登记表、版本写错,都报出来', () => {
      expect(tierTableProblems(HELPERS, '1.7.0')).toEqual([`helper ${FAKE.helper}:没拿掉,登记表里却没有`]);
      commandText[FAKE.goneCommand] = '还留着';
      influenceTier[FAKE.influence] = { tier: 'experimental', label: '假的影响口', since: 'v1.7' };
      commandTier[FAKE.command] = { tier: 'experimental', label: '假的命令', since: '1.8.0', removed: '1.7.0' };
      stageTier[FAKE.stage] = { tier: 'experimental', label: '', since: '1.9.0' };
      try {
        expect(tierTableProblems([...HELPERS, FAKE.helper], '1.7.0')).toEqual([
          `influence ${FAKE.influence}:版本要写成网站的版本号,如 1.7.0`,
          `command ${FAKE.command}:拿掉了,登记表里还有`,
          `command ${FAKE.command}:开的、改的、拿掉的版本要从早到晚`,
          `command ${FAKE.goneCommand}:拿掉了,登记表里还有`,
          `stage ${FAKE.stage}:要写给用的人看的名字`,
          `stage ${FAKE.stage}:版本比下一版 1.8.0 还新`,
        ]);
      } finally {
        delete commandText[FAKE.goneCommand];
        influenceTier[FAKE.influence] = open(FAKE.influence);
        commandTier[FAKE.command] = open(FAKE.command);
        stageTier[FAKE.stage] = open(FAKE.stage);
      }
    });
  });
});

describe('实验接口在文档、类型定义里标出来', () => {
  it('网站自己的实验接口都标了', () => {
    expect(markProblems(repo, HELPERS)).toEqual([]);
  });

  describe('登记了假接口', () => {
    let undo: () => void;
    beforeAll(() => {
      undo = registerFakes();
    });
    afterAll(() => undo());

    const row = (code: string) => `\n| \`${code}\` | 假的 | **实验**,网站 1.7.0 起。假的 |\n`;
    const block = (decl: string) => `\n/**\n * ${TIER_MARK}\n * 假的\n * @experimental\n */\n${decl}\n`;
    /** 文档、类型定义末尾照约定补上假接口 */
    const marked: Rec<string> = {
      'docs/plugins/limits.md': row(FAKE.cap),
      'docs/plugins/sim.md': row(FAKE.influence) + row(FAKE.command),
      'docs/plugins/map.md': row(FAKE.stageCap) + row(FAKE.stage) + row(`d.${FAKE.helper}({ km })`),
      'src/plugin/types.ts': block(`  | '${FAKE.cap}'`),
      'examples/plugins/civ-atlas-sim.d.ts': block(`  | '${FAKE.influence}'`) + block(`  | { kind: '${FAKE.command}'; a: SimRef }`),
      'examples/plugins/civ-atlas-map.d.ts': `\n/** ${TIER_MARK}。要 ${FAKE.stageCap} @experimental */\n` + block(`  ${FAKE.stage}?(d: MapShared): void;`) + block(`  ${FAKE.helper}(km: number): Float32Array;`),
    };
    const helpers = [...HELPERS, FAKE.helper];

    it('都没标:每样文档、类型定义各报一条;拿掉了的不查', () => {
      const problems = markProblems(repo, helpers);
      expect(problems).toHaveLength(12);
      for (const name of [FAKE.cap, FAKE.stageCap, FAKE.influence, FAKE.command, FAKE.stage, FAKE.helper]) expect(problems.filter((p) => p.includes(`:${name} `))).toHaveLength(2);
      expect(problems.some((p) => p.includes(FAKE.goneCap) || p.includes(FAKE.goneCommand))).toBe(false);
    });

    it('照约定标了就不报', () => {
      expect(markProblems((p) => repo(p) + (marked[p] ?? ''), helpers)).toEqual([]);
    });

    it('版本对不上、没写实验、注释第一行不是那句、没带 @experimental,都算漏标', () => {
      const with_ = (path: string, text: string) => (p: string) => repo(p) + (p === path ? text : (marked[p] ?? ''));
      const only = (problems: string[]) => problems.map((p) => p.split(':')[0]);
      expect(only(markProblems(with_('docs/plugins/sim.md', row(FAKE.influence) + row(FAKE.command).replace('1.7.0', '1.6.0')), helpers))).toEqual(['docs/plugins/sim.md']);
      expect(only(markProblems(with_('docs/plugins/sim.md', row(FAKE.influence) + `\n| \`${FAKE.command}\` | 网站 1.7.0 起 |\n`), helpers))).toEqual(['docs/plugins/sim.md']);
      expect(only(markProblems(with_('src/plugin/types.ts', `\n/**\n * 假的\n * ${TIER_MARK}\n * @experimental\n */\n  | '${FAKE.cap}'\n`), helpers))).toEqual(['src/plugin/types.ts']);
      expect(only(markProblems(with_('src/plugin/types.ts', `\n/** ${TIER_MARK} */\n  | '${FAKE.cap}'\n`), helpers))).toEqual(['src/plugin/types.ts']);
      expect(only(markProblems(with_('src/plugin/types.ts', `\n/** ${TIER_MARK} @experimental */\n  | 'world.read@1'\n  | '${FAKE.cap}'\n`), helpers))).toEqual(['src/plugin/types.ts']);
    });
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
    expect(uses).toEqual([use('能力', FAKE.stageCap), use('能力', FAKE.cap), use('影响口', FAKE.influence), use('命令', FAKE.command), use('生成的一步', FAKE.stage)]);
  });

  it('帮手看地图插件的代码:名字是一个完整的词才算', () => {
    const map = (code: string) => experimentalUses({ role: 'map', requires: ['gen.height@1'], map: { stages: ['height'] } }, code);
    const used = [use('帮手', FAKE.helper)];
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
    expect(experimentalUses({ role: 'sim', requires: [1, FAKE.cap] as unknown as string[], sim: { commands: 'fakewar' as unknown as string[] } })).toEqual([use('能力', FAKE.cap)]);
  });

  it('拿掉了的不算在用,另列出来(和网站太旧分开);optional 里的能力拿掉了照样能开,不列', () => {
    const m = { role: 'sim', requires: ['sim.commands@1', FAKE.goneCap], sim: { commands: ['declare', FAKE.goneCommand, FAKE.command] } };
    expect(experimentalUses(m)).toEqual([use('命令', FAKE.command)]);
    expect(removedUses(m)).toEqual([
      { ...use('能力', FAKE.goneCap), removed: '1.8.0' },
      { ...use('命令', FAKE.goneCommand), removed: '1.8.0' },
    ]);
    expect(removedUses({ role: 'tool', requires: ['world.read@1'], optional: [FAKE.goneCap] })).toEqual([]);
    expect(removedUses({ role: 'tool', requires: ['world.read@1', 'fake.future@1'] })).toEqual([]);
  });

  it('更新:新版多用的才算多要了', () => {
    const a = use('能力', FAKE.cap);
    const b = use('命令', FAKE.command);
    expect(addedExperimental([], [a])).toEqual([a]);
    expect(addedExperimental([a], [a, b])).toEqual([b]);
    expect(addedExperimental([a, b], [b])).toEqual([]);
    expect(addedExperimental([{ ...b, what: '影响口' }], [b])).toEqual([b]);
  });
});

describe('权限框上用了实验接口的那一行', () => {
  let undo: () => void;
  beforeAll(() => {
    undo = registerFakes();
  });
  afterAll(() => undo());

  const why = { 'history.read@1': '挑出每场大仗', [FAKE.cap]: '讲完一段自动往下播', 'view.read@1': '你拖到哪一年就从哪一年讲' };

  it('排在最后,不标黄;小字写用到哪几样,实验能力的理由挪到这一行', () => {
    const lines = permissionLines({ requires: ['history.read@1', 'view.read@1', FAKE.cap], why });
    expect(lines.map((l) => l.key)).toEqual(['history', 'view', 'experimental']);
    expect(lines[1].why).toEqual(['你拖到哪一年就从哪一年讲']);
    expect(lines[2]).toMatchObject({ ...EXPERIMENTAL_PERMISSION, note: '用到：偷看。网站改了这个接口，它会先停下，等作者更新。', why: ['讲完一段自动往下播'] });
    expect(EXPERIMENTAL_PERMISSION).toEqual({ text: '用了实验接口：网站更新后可能失效', loud: false });
  });

  it('几样一起列;推演插件的命令、影响口也算;地图插件给了代码才看帮手', () => {
    const sim = permissionLines({ role: 'sim', requires: ['sim.influence@1', 'sim.commands@1'], sim: { influences: [FAKE.influence], commands: [FAKE.command] } });
    expect(sim.at(-1)?.note).toBe('用到：假的影响口、假的命令。网站改了其中哪一个，它会先停下，等作者更新。');
    const map = { role: 'map', requires: ['gen.height@1'], map: { stages: ['height'] } };
    expect(permissionLines(map).map((l) => l.key)).toEqual(['mapSteer']);
    expect(permissionLines(map, `d.${FAKE.helper}()`).map((l) => l.key)).toEqual(['mapSteer', 'experimental']);
  });

  it('没用实验接口的,行和字一点不变', () => {
    const m = { requires: ['history.read@1', 'view.read@1'], optional: ['layer.marks@1'], why: { 'history.read@1': '挑出每场大仗' } };
    expect(permissionLines(m)).toEqual([
      { key: 'history', text: '看历史（国家、城市、人物、编年史）', loud: false, why: ['挑出每场大仗'] },
      { key: 'view', text: '知道你在看哪一年、点了哪里（只在用它的时候）', loud: false, why: [] },
      { key: 'layer', text: '在地图上加图层和标注', loud: false, why: [] },
    ]);
  });

  it('作品墙卡片:能力小标签里没有实验那一行,另挂「实验」', () => {
    expect(capChips({ requires: ['history.read@1', FAKE.cap], optional: [] }).map((c) => c.key)).toEqual(['history', 'view']);
    expect(usesExperimental({ requires: ['history.read@1', FAKE.cap], optional: [] })).toBe(true);
    expect(usesExperimental({ requires: ['history.read@1'], optional: ['view.read@1'] })).toBe(false);
  });

  it('更新:旧版没有实验那一行,新版用了,整行算多要了', () => {
    const added = addedLines({ requires: ['history.read@1', 'view.read@1'] }, { requires: ['history.read@1', 'view.read@1', FAKE.cap], why });
    expect(added.map((l) => [l.key, l.note, l.why])).toEqual([['experimental', '用到：偷看。网站改了这个接口，它会先停下，等作者更新。', ['讲完一段自动往下播']]]);
  });

  it('更新:旧版已经有实验那一行,新版又多用一样,也算多要了;小字写多用了哪个,理由只留新多用的', () => {
    const old = { role: 'map', requires: ['history.read@1', 'gen.height@1', FAKE.cap], map: { stages: ['height'] } };
    const next = { ...old, requires: [...old.requires, FAKE.stageCap], why: { ...why, [FAKE.stageCap]: '讲到哪场仗，打开「战线」图层' } };
    const added = addedLines(old, next);
    expect(added.map((l) => [l.key, l.note, l.why])).toEqual([['experimental', '多用了：假的一步的能力（原来就用：偷看）', ['讲到哪场仗，打开「战线」图层']]]);
    expect(addedLines(old, old)).toEqual([]);
    expect(addedLines(next, old)).toEqual([]);
  });
});

describe('实验接口被网站拿掉以后', () => {
  let undo: () => void;
  beforeAll(() => {
    undo = registerFakes();
  });
  afterAll(() => undo());

  const input = (manifest: Partial<PluginPackInput['manifest']>): PluginPackInput => ({
    manifest: { id: 'fake-gone', name: '战争导览', version: '0.3.0', role: 'tool', api: 1, runtime: 'worker', requires: ['history.read@1'], license: 'MIT', ...manifest },
    files: { 'main.js': 'civAtlas.log("hi");\n', 'README.md': '# 战争导览\n', LICENSE: 'MIT License\n' },
  });
  /** 拿掉之前打的包:打完再照拿掉以后的登记 */
  async function packedBefore(i: PluginPackInput, back: () => void): Promise<Uint8Array> {
    try {
      return await packPluginFile(i);
    } finally {
      back();
    }
  }

  it('工具插件:装不上时说是实验接口拿掉了,带上名字和第几版', async () => {
    caps.set(FAKE.goneCap, 'view');
    delete capTier[FAKE.goneCap];
    const bytes = await packedBefore(input({ requires: ['history.read@1', FAKE.goneCap] }), () => {
      caps.delete(FAKE.goneCap);
      capTier[FAKE.goneCap] = gone(FAKE.goneCap);
    });
    const e = await openPluginFile(bytes).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PluginFileError);
    expect(e).toMatchObject({ kind: 'newer', plugin: '战争导览', gone: '播放时间轴', version: '0.3.0', message: `「战争导览」${GONE_MARK}。要等作者出新版。更新网站没有用。` });
  });

  it('推演插件:世界里显示的那句话', async () => {
    commandText[FAKE.goneCommand] = '拿掉的命令';
    delete commandTier[FAKE.goneCommand];
    const bytes = await packedBefore(input({ role: 'sim', runtime: 'quickjs', name: '厌战', requires: ['sim.commands@1'], sim: { commands: ['declare', FAKE.goneCommand] } }), () => {
      delete commandText[FAKE.goneCommand];
      commandTier[FAKE.goneCommand] = gone(FAKE.goneCommand);
    });
    const e = await openPluginFile(bytes).catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: 'newer', gone: '拿掉的命令', message: '「厌战」用的实验接口，网站已经改掉了。这个世界照常能看；要接着推（或用它新长地图），等作者出新版。更新网站没有用。' });
  });

  it('网站真的太旧(插件要的东西以后才有):照旧说要更新网站', async () => {
    caps.set('fake.future@1', 'view');
    const bytes = await packedBefore(input({ requires: ['history.read@1', 'fake.future@1'] }), () => caps.delete('fake.future@1'));
    const e = await openPluginFile(bytes).catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: 'newer', message: '要更新网站才能用:插件要的 fake.future@1 这一版网站还没有' });
    expect((e as PluginFileError).gone).toBeUndefined();
  });

  it('地图插件:长地图时装不上,错上带着是实验接口拿掉了(地图那张卡另说)', async () => {
    const goneNote = stageTier[FAKE.stage];
    const bytes = await packedBefore(input({ role: 'map', runtime: 'quickjs', name: '潮汐', requires: ['gen.height@1', FAKE.stageCap], map: { stages: ['height', FAKE.stage] } }), () => {
      delete stageCaps[FAKE.stage];
      stageTier[FAKE.stage] = { ...goneNote, removed: '1.8.0' };
    });
    try {
      const e = await loadMapFile({ id: 'fake-gone', sum: 'x', bytes }, 'k', () => Promise.reject(new Error('不该装进 QuickJS'))).catch((x: unknown) => x);
      expect(e).toMatchObject({ name: 'MapPluginLoadError', gone: true, why: '「潮汐」用的实验接口，网站已经改掉了。这个世界照常能看；要接着推（或用它新长地图），等作者出新版。更新网站没有用。' });
    } finally {
      stageCaps[FAKE.stage] = 'gen.fakestep';
      stageTier[FAKE.stage] = goneNote;
    }
  });

  it('开插件时查能力:拿掉了的另说', () => {
    expect(checkCaps(['history.read@1', FAKE.goneCap])).toEqual({ ok: false, kind: 'newer', text: '用的实验接口「播放时间轴」，网站已经改掉了，要等作者出新版' });
    expect(checkCaps(['fake.future@1'])).toEqual({ ok: false, kind: 'newer', text: '要更新网站才能用:插件要的 fake.future@1 这一版网站还没有' });
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
    expect(experimental).toEqual([use('能力', FAKE.cap)]);
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
