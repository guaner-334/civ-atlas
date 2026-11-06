/**
 * 帮手第 2 版的规则作品(helperProtocol.ts):推哪张图、交回的摘要。纯计算,单测直接调;帮手用到时才下载。
 */
import { DEFAULT_PARAMS, type WorldParams } from '../gen/params';
import { latestTuning, type RuleSet } from '../gen/civ/ruleSet';
import { decodeRulesHash } from '../gen/civ/ruleShare';
import { tuningTop } from '../gen/civ/tuningText';
import type { WorkerRequest } from '../worker';
import { DEFAULT_MAP_SEED } from './compare/compareMaps';
import { modifiedCount } from './rules/rulesView';
import type { RulesBrief } from './helperProtocol';

/** 改了几项、最显眼的三处(常用的项排前面;没改规则项时说地貌的叫法改了几项) */
export function rulesBrief(r: RuleSet): RulesBrief {
  const n = modifiedCount(r);
  const top = tuningTop(r.values, 3);
  const brief = top.count ? top.shown.join('、') : n.biomes ? `改了地貌的名字 ${n.biomes} 项` : '和官方规则一样';
  return { name: r.name, changed: n.total, brief };
}

/**
 * 规则链接 # 后面那段 → 要推的那一个:并排试推默认的那张地图(默认参数、种子 7),文明种子、拓荒这些照默认,推 3000 年;
 * 读不出来 = 抛出给管理员看的中文
 */
export function rulesJob(hash: string): { params: WorldParams; input: Omit<Extract<WorkerRequest, { type: 'generate' }>, 'type' | 'id'>; rules: RulesBrief } {
  const r = decodeRulesHash(hash);
  if (!r.ok) throw new Error(`规则链接读不出来：${r.error}`);
  const params: WorldParams = { ...DEFAULT_PARAMS, seed: DEFAULT_MAP_SEED };
  const tuning = latestTuning(r.rules);
  return { params, input: { params, scale: 1, ...(tuning ? { tuning } : {}) }, rules: rulesBrief(r.rules) };
}
