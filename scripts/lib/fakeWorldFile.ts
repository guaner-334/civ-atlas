/**
 * 开发假服务器作品墙上的规则作品、世界作品用的那几样:两套示例规则,和世界作品的世界文件。
 * 世界文件是现做的小世界(2000 地块、推到默认的年份、用「长治久安」那套规则),和网页存成文件走同一套打包,网页上照存的内容打开;
 * 第一次要的时候做(一两秒)。
 */
import { rulesHash } from '../../src/gen/civ/ruleShare';
import { newWorldRules, type RuleSet } from '../../src/gen/civ/ruleSet';
import { tuningTop } from '../../src/gen/civ/tuningText';
import { EMPTY_EDITS, GENERATOR_VERSION } from '../../src/gen/edits';
import { READER_VERSIONS } from '../../src/gen/readers/versions';
import { makeSave, worldCheck } from '../../src/gen/savefile';
import { DEFAULT_PARAMS } from '../../src/gen/world';
import { packWorldFile } from '../../src/gen/worldFile';
import { recomputeWorld } from '../../src/worldConvert';
import { worldChronicle, worldFlags } from '../../src/worldRun';

/** 规则作品:七八个国家并立、谁也吞不下谁 */
export const WARRING_RULES: RuleSet = {
  name: '战国千年',
  version: 1,
  by: '鲸落',
  values: { 'war.odds': 2, 'war.truce': 2, 'split.odds': 1.5, 'split.collapse': 2, 'split.hegemon': 4, 'diplo.pact': 2 },
};

/** 世界作品用的那一套 */
export const STEADY_RULES: RuleSet = {
  name: '长治久安',
  version: 1,
  by: '霜叶',
  values: { 'war.odds': 0.75, 'split.odds': 0.5, 'split.restore': 2, 'split.collapse': 0.5, 'split.dynastyAge': 450 },
};

/** 作品墙列表里的规则摘要(上架时帮手算的那一份;这几套没改地貌的叫法) */
export function rulesBriefOf(r: RuleSet): { name: string; changed: number; brief: string } {
  return { name: r.name, changed: Object.keys(r.values).length, brief: tuningTop(r.values, 3).shown.join('、') };
}

/** 规则作品给的规则链接 # 后面那段 */
export function rulesLinkOf(r: RuleSet): string {
  return rulesHash(r).replace(/^#/, '');
}

const made = new Map<string, Promise<Uint8Array>>();

/** 世界作品的世界文件(同一个名字只做一次,几个假服务器共用) */
export function makeWorldFile(title: string): Promise<Uint8Array> {
  let f = made.get(title);
  if (!f) made.set(title, (f = buildWorldFile(title)));
  return f;
}

async function buildWorldFile(title: string): Promise<Uint8Array> {
  const params = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
  const edits = { ...EMPTY_EDITS, rules: newWorldRules(STEADY_RULES) };
  const draft = makeSave(params, edits, '', title, '2026-11-01T08:00:00.000Z');
  const { world, civ } = recomputeWorld(draft);
  const save = { ...draft, check: worldCheck(world) };
  const blob = await packWorldFile({
    id: 'wgallerydev',
    title,
    made: { app: '1.0.0', generator: GENERATOR_VERSION, commit: '', at: save.savedAt },
    readers: { ...READER_VERSIONS },
    recipe: save,
    map: world,
    civ,
    chronicle: worldChronicle(civ, save.edits.characters),
    flags: worldFlags(world, civ),
  });
  return new Uint8Array(await blob.arrayBuffer());
}
