/**
 * 一套规则(tuning.ts 的 TuningValues:70 项里改过的那些项的值)换成推演用的一套旋钮改动(CivParams.knobs)。
 * 每项改哪几处旋钮也在这里(只有推演用);要查旋钮表里的官方值(civ/knobs.ts 的 CIV_KNOBS,连着各子系统的文件),
 * 所以和项表分开放:只读、清理规则的地方(存档、链接、本机的「我的规则」)引用 tuning.ts 就够了,不用把整个推演载进来。
 * 纯计算,不碰 DOM。
 */
import { CIV_KNOBS } from './knobs';
import type { KnobPatch, KnobValue } from './engine/knobs';
import { TUNING_ITEMS, cleanTuning, type TuningItem, type TuningValue } from './tuning';

/**
 * 一项改哪几处旋钮("表.项"):
 * - 一项可以连着改几处(同一个意思在几张表里各存一份的,「关 = 不发生」要几处一起关的),几处都按同一个值改
 * - inv:倍数档倒过来(数越大越少的:官方值 ÷ 倍数,关 = Infinity)
 * - never、off:数值项「永不」「关」那一档旋钮取的数
 */
export interface TuningKnobs {
  readonly knobs: readonly string[];
  readonly inv?: boolean;
  readonly never?: number;
  readonly off?: number;
}

const KNOBS: Readonly<Record<string, TuningKnobs>> = {
  'realm.found': { knobs: ['polities.FOUND_AT', 'polities.MIN_AGE'], inv: true },
  'realm.worth': { knobs: ['polities.WORTH'] },
  'realm.sail': { knobs: ['polities.SAIL_LEVEL'], inv: true },
  'realm.republic': { knobs: ['polities.REPUBLIC_P'] },
  'realm.reach': { knobs: ['control.REACH'] },
  'war.odds': { knobs: ['wars.WAR_ODDS'] },
  'war.truce': { knobs: ['wars.TRUCE'] },
  'war.length': { knobs: ['wars.LENGTH'] },
  'war.crush': { knobs: ['wars.CRUSH'], never: Infinity },
  'war.project': { knobs: ['wars.PROJECT'], inv: true },
  'war.rest': { knobs: ['wars.REST'] },
  'war.goal': { knobs: ['wars.GOAL'] },
  'war.break': { knobs: ['wars.BREAK_MAX'] },
  'war.fronts': { knobs: ['wars.MAX_WARS', 'diplomacy.MAX_WARS'] },
  'war.capital': { knobs: ['wars.CAPITAL_DEF'] },
  'war.prey': { knobs: ['wars.PREY_ODDS'] },
  'war.revanche': { knobs: ['wars.REVANCHE'] },
  'war.grudge': { knobs: ['wars.GRUDGE_YEARS'] },
  'war.winter': { knobs: ['wars.WINTER_T'], off: -Infinity },
  'war.sack': { knobs: ['cities.SACK_P'] },
  'war.ruin': { knobs: ['cities.RUIN_P'] },
  'war.rebuild': { knobs: ['cities.REBUILD_P'] },
  'split.odds': { knobs: ['politics.SPLIT_ODDS'] },
  'split.restore': { knobs: ['politics.RESTORE_ODDS'] },
  'split.collapse': { knobs: ['unrest.COLLAPSE_ODDS'] },
  'split.hegemon': { knobs: ['unrest.HEG_W'] },
  'split.revolt': { knobs: ['unrest.REVOLT_ODDS'] },
  'split.dynasty': { knobs: ['dynasty.ODDS', 'regents.USURP'] },
  'split.dynastyAge': { knobs: ['dynasty.AGE_REF'] },
  'split.claim': { knobs: ['unrest.CLAIM_ODDS'] },
  'split.merge': { knobs: ['politics.MERGE_ODDS'] },
  'split.share': { knobs: ['politics.SPLIT_FRAC'] },
  'split.newborn': { knobs: ['wars.NEWBORN'] },
  'split.capMove': { knobs: ['politics.CAPMOVE_P'] },
  'split.edge': { knobs: ['politics.EDGE_P'] },
  'split.age': { knobs: ['unrest.AGE_W'] },
  'diplo.pact': { knobs: ['diplomacy.PACT_ODDS'] },
  'diplo.submit': { knobs: ['diplomacy.SUBMIT_ODDS', 'diplomacy.SUE_OFFER'] },
  'diplo.treaty': { knobs: ['treaties.TREATY_ODDS', 'treaties.PEACE_TREATY'] },
  'diplo.marry': { knobs: ['marriages.MARRY_PER', 'marriages.MARRY_MAX', 'marriages.MARRY_ALLY', 'marriages.PEACE_MATCH'] },
  'diplo.maxPacts': { knobs: ['diplomacy.MAX_PACTS'] },
  'diplo.betray': { knobs: ['diplomacy.BETRAY_ODDS'] },
  'diplo.join': { knobs: ['diplomacy.PACT_JOIN'] },
  'diplo.defect': { knobs: ['diplomacy.DEFECT_ODDS'] },
  'diplo.absorb': { knobs: ['diplomacy.ABSORB_ODDS'] },
  'diplo.breach': { knobs: ['treaties.BREACH_ODDS'] },
  'diplo.zone': { knobs: ['treaties.MULTI_ZONE'] },
  'folk.assimilate': { knobs: ['assimilation.RATE'] },
  'folk.treks': { knobs: ['migration.MAX'] },
  'folk.diverge': { knobs: ['assimilation.DIV_P'] },
  'folk.trekPace': { knobs: ['migration.PACE_YEARS'] },
  'folk.trekSize': { knobs: ['migration.SIZE_MAX'] },
  'folk.flight': { knobs: ['assimilation.FLIGHT_ODDS'] },
  'folk.trekAbsorb': { knobs: ['assimilation.TREK_K'] },
  'disaster.plague': { knobs: ['plague.ORIGIN_NORM'], inv: true },
  'disaster.plagueLoss': { knobs: ['plague.LOSS'] },
  'disaster.famine': { knobs: ['unrest.P_BASE', 'unrest.P_FULL'] },
  'disaster.spread': { knobs: ['plague.SPREAD'] },
  'disaster.great': { knobs: ['plague.GREAT_ODDS'] },
  'disaster.growth': { knobs: ['polities.GROWTH'] },
  'disaster.wear': { knobs: ['population.WEAR'] },
  'court.reign': { knobs: ['rulers.REIGN_MAX', 'regents.SEIZE_REIGN'] },
  'court.strongman': { knobs: ['regents.STRONG_P'] },
  'court.reform': { knobs: ['reform.PUSH_MIN'], inv: true },
  'court.maxAge': { knobs: ['rulers.MAX_AGE'] },
  'court.murder': { knobs: ['royals.MURDER'] },
  'court.contest': { knobs: ['royals.CONTEST_ELDER', 'royals.CONTEST_MERIT'] },
  'court.coup': { knobs: ['reform.COUP_ODDS'] },
  'court.restore': { knobs: ['reform.RESTORE_ODDS'] },
  'court.uncle': { knobs: ['regents.UNCLE_P'] },
};

/** 一项改哪几处旋钮 */
export function tuningKnobs(x: Pick<TuningItem, 'id'>): TuningKnobs {
  return KNOBS[x.id];
}

/** 有旋钮映射的项的编号(单测核对和项表一样) */
export const TUNING_KNOB_IDS: readonly string[] = Object.keys(KNOBS);

const tables = new Map(CIV_KNOBS.map((t) => [t.id, t]));
/** "表.项" 官方的值(登记表里没有就报错:编号对不上旋钮是写错了) */
function officialKnob(k: string): KnobValue {
  const [t, name] = k.split('.');
  const v = tables.get(t)?.values[name];
  if (v === undefined) throw new Error(`规则项改的旋钮 ${k} 不在旋钮表里`);
  return v;
}

/** 一项的值换成它改的那几处旋钮的值(值是清理过的) */
function knobValues(x: TuningItem, v: TuningValue): [string, KnobValue][] {
  const k = tuningKnobs(x);
  if (x.kind === 'mult') {
    const m = v as number;
    return k.knobs.map((name) => {
      const o = officialKnob(name) as number;
      return [name, k.inv ? (m === 0 ? Infinity : o / m) : o * m];
    });
  }
  if (x.kind === 'range') {
    const [a, b] = v as readonly [number, number];
    return k.knobs.map((name) => [name, [a, b]]);
  }
  const kv = v === 'never' ? k.never! : v === 'off' ? k.off! : (v as number);
  return k.knobs.map((name) => [name, kv]);
}

/**
 * 一套规则 → 推演用的一套旋钮改动(CivParams.knobs)。先过 cleanTuning(读进来的乱值不会变成乱旋钮);
 * 什么都没改 = undefined(官方)
 */
export function tuningPatch(values: unknown): KnobPatch | undefined {
  const clean = cleanTuning(values).values;
  const out: Record<string, Record<string, KnobValue>> = {};
  let any = false;
  for (const x of TUNING_ITEMS) {
    if (!(x.id in clean)) continue;
    for (const [k, kv] of knobValues(x, clean[x.id])) {
      const [t, name] = k.split('.');
      (out[t] ??= {})[name] = kv;
      any = true;
    }
  }
  return any ? out : undefined;
}
