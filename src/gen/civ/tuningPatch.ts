/**
 * 一套规则(tuning.ts 的 TuningValues:70 项里改过的那些项的值)换成推演用的一套旋钮改动(CivParams.knobs)。
 * 每项改哪几处旋钮也在这里(只有推演用);要查旋钮表里的官方值(civ/knobs.ts 的 CIV_KNOBS,连着各子系统的文件),
 * 所以和项表分开放:只读、清理规则的地方(存档、链接、本机的「我的规则」)引用 tuning.ts 就够了,不用把整个推演载进来。
 *
 * **换算分版本**(tuning.ts 的 TUNING_CALC):一个世界照它建成那一刻的那一版换(RuleSet.calc),以前各版的换算原样留在 CALC_TABLES 里,
 * 只往后加、不改:改了哪一版,用那一版建的世界就会推出另一段历史。每一版里官方值那一档都换不出改动(官方规则的世界和版本无关)。
 * 纯计算,不碰 DOM。
 */
import { CIV_KNOBS } from './knobs';
import type { KnobPatch, KnobValue } from './engine/knobs';
import { fpow } from './engine/rand';
import { TUNING_CALC, TUNING_ITEMS, cleanTuning, type TuningItem, type TuningValue, type WorldTuning } from './tuning';

/**
 * 一项改哪几处旋钮("表.项"):
 * - 一项可以连着改几处(同一个意思在几张表里各存一份的,「关 = 不发生」要几处一起关的),几处都按同一个值改
 * - inv:倍数档倒过来(数越大越少的:官方值 ÷ 倍数,关 = Infinity)
 * - pow:倍数档每一处乘倍数的几次方(和 knobs 一一对应;不给 = 都是 1 次方)。负的 = 倍数越大这一处越小(冷却、门槛、隔多久看一眼);
 *   关(倍数 0)时次方为负的那几处照官方(事都不发生了,门槛不用动)。非整数次方按 fpow 舍入(跨 CPU 一致)
 * - never、off:数值项「永不」「关」那一档旋钮取的数
 * - also:按这一项的值连带改的几处(数值、区间项用,比如仗打得久、僵持也等得久);和官方一样的不写。alsoKnobs = 它会改哪几处
 */
export interface TuningKnobs {
  readonly knobs: readonly string[];
  readonly inv?: boolean;
  readonly pow?: readonly number[];
  readonly never?: number;
  readonly off?: number;
  readonly also?: (v: TuningValue) => readonly (readonly [string, KnobValue])[];
  readonly alsoKnobs?: readonly string[];
}

/** 第 1 版的换算(规则开放时定的;定了不改) */
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

/**
 * 第 2 版:六项拉到头也没怎么变的,把卡住它的那几处一起改(5 个种子、推 3000 年和官方比;括号里是第 1 版):
 * - 战争多少:看邻国时多半已经很想打(赔率换成机会早就饱了),只乘一次倍数差不出多少,赔率改按倍数的平方乘;
 *   隔多久看一眼邻国按倍数的 −½ 次方缩短(×4 = 7.5 年一次,×¼ = 30 年)。×4 仗多 47%(16%),×¼ 少 63%(22%)
 * - 一场仗最多打几年:仗多半先因为「连着几年没打下一州」(僵持)罢兵,僵持跟着放宽到上限的三分之一(至少照官方)。
 *   最多 60 年:一场仗平均 12 年(9 年)
 * - 灭国之战:亡国多半是打下国都以后余下的州归降(破都纳降,也看国力是对方几倍),两处一起改(官方都是 2.5 倍)。
 *   永不:亡国少 27%(4%)
 * - 分裂多少:同一国分过以后多少年不再分(冷却)按倍数缩短,多大的国才会分(州数门槛)按倍数的 −½ 次方降。×4 分裂多 3.3 倍(60%),×¼ 少 88%
 * - 大崩解多少:崩过以后多少年不再崩(冷却)、只看占了一块大陆几成的霸主(门槛)按倍数降,多大的国才会崩(州数门槛)按倍数的 −½ 次方降。
 *   ×4 大崩解多一倍(18%),×¼ 少 91%
 * - 改朝换代多少:赔率随王朝的岁数按指数涨,乘一次倍数只等于王朝早亡几十年,改按倍数的三次方乘(权臣篡位照旧按倍数)。
 *   ×4 改朝换代多 1.4 倍(30%)。没改看王朝的间隔:那样「看一眼」多了,权臣专权也跟着多好几倍
 */
const KNOBS_2: Readonly<Record<string, TuningKnobs>> = {
  'war.odds': { knobs: ['wars.WAR_ODDS', 'wars.CHECK_EVERY'], pow: [2, -0.5] },
  'war.length': {
    knobs: ['wars.LENGTH'],
    also: (v) => {
      const stall = officialKnob('wars.STALL') as number;
      return [['wars.STALL', Math.max(stall, Math.round((v as readonly [number, number])[1] / 3))]];
    },
    alsoKnobs: ['wars.STALL'],
  },
  'war.crush': { knobs: ['wars.CRUSH', 'wars.SURRENDER_POWER'], never: Infinity },
  'split.odds': { knobs: ['politics.SPLIT_ODDS', 'politics.SPLIT_REST', 'politics.SPLIT_MIN_SIZE'], pow: [1, -1, -0.5] },
  'split.collapse': { knobs: ['unrest.COLLAPSE_ODDS', 'unrest.COLLAPSE_REST', 'unrest.HEG_GATE', 'unrest.COLLAPSE_MIN'], pow: [1, -1, -1, -0.5] },
  'split.dynasty': { knobs: ['dynasty.ODDS', 'regents.USURP'], pow: [3, 1] },
};

/**
 * 各版换算:第 i 个是第 i + 1 版。第 1 版写全 70 项;以后每一版只写这一版换了的项(那一项整个换掉),没写的照上一版。
 * 加一版:在末尾加一份,tuning.ts 的 TUNING_CALC 跟着加一(单测核对两边一样);前面的不动
 */
const CALC_TABLES: readonly Readonly<Record<string, TuningKnobs>>[] = [KNOBS, KNOBS_2];

/** 有几版换算(单测核对和 TUNING_CALC 一样) */
export const CALC_COUNT = CALC_TABLES.length;

/** 换算版本得是 1 到 TUNING_CALC 的整数,不然报错 */
function checkCalc(calc: number): void {
  if (!Number.isInteger(calc) || calc < 1 || calc > Math.min(TUNING_CALC, CALC_TABLES.length)) {
    throw new Error(`规则的换算版本 ${calc} 不认得(现在到第 ${TUNING_CALC} 版)`);
  }
}

/** 一项在第 calc 版(不给 = 最新的一版)改哪几处旋钮 */
export function tuningKnobs(x: Pick<TuningItem, 'id'>, calc: number = TUNING_CALC): TuningKnobs {
  checkCalc(calc);
  for (let i = calc - 1; i >= 0; i--) {
    const k = CALC_TABLES[i][x.id];
    if (k) return k;
  }
  throw new Error(`规则项 ${x.id} 没有换算`);
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

/** 一项的值按第 calc 版换成它改的那几处旋钮的值(值是清理过的) */
function knobValues(x: TuningItem, v: TuningValue, calc: number): (readonly [string, KnobValue])[] {
  const k = tuningKnobs(x, calc);
  return [...mainValues(x, k, v), ...(k.also ? k.also(v).filter(([name, kv]) => kv !== officialKnob(name)) : [])];
}

/** knobs 那几处的值 */
function mainValues(x: TuningItem, k: TuningKnobs, v: TuningValue): [string, KnobValue][] {
  if (x.kind === 'mult') {
    const m = v as number;
    return k.knobs.flatMap((name, i): [string, KnobValue][] => {
      const o = officialKnob(name) as number;
      if (k.inv) return [[name, m === 0 ? Infinity : o / m]];
      const p = k.pow?.[i] ?? 1;
      if (p === 1) return [[name, o * m]];
      // 关:次方为正的那几处是 0,为负的(冷却、门槛)照官方,不写
      if (m === 0) return p > 0 ? [[name, 0]] : [];
      return [[name, o * fpow(m, p)]];
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
 * 一套规则按第 calc 版换算 → 推演用的一套旋钮改动(CivParams.knobs)。先过 cleanTuning(读进来的乱值不会变成乱旋钮);
 * 什么都没改 = undefined(官方)。calc 不认得就报错:世界里记的版本读档时已经核对过(比现在新的不读,见 savefile.ts),
 * 走到这里是代码写错了,不能悄悄换成别的版本、推出另一段历史
 */
export function tuningPatch(values: unknown, calc: number): KnobPatch | undefined {
  checkCalc(calc);
  const clean = cleanTuning(values).values;
  const out: Record<string, Record<string, KnobValue>> = {};
  let any = false;
  for (const x of TUNING_ITEMS) {
    if (!(x.id in clean)) continue;
    for (const [k, kv] of knobValues(x, clean[x.id], calc)) {
      const [t, name] = k.split('.');
      (out[t] ??= {})[name] = kv;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** 推演要的那部分(规则项 + 换算版本)→ 一套旋钮改动;没有 = undefined(官方) */
export function worldPatch(t: WorldTuning | undefined): KnobPatch | undefined {
  return t ? tuningPatch(t.values, t.calc) : undefined;
}
