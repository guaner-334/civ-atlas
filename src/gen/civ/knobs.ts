/**
 * 官方推演的全部旋钮表(各子系统"调参"那一段的数:名字、默认值;说明写在各文件每一项上面)。
 * 推演本身不读这个清单(各文件从这次推演带的那套数里取自己的表);它是给"看 / 调这些数"的地方用的总目录,
 * 清理一套改动(cleanKnobs)、按改动配一套数(knobSet)、取一个世界用的那套数(knobsOf)也在这里。
 */
import { OFFICIAL_KNOBS, knobSetOf, knobValueOk, type KnobPatch, type KnobSet, type Knobs, type KnobValue } from './engine/knobs';
import { ASSIMILATION_KNOBS } from './assimilation';
import { CITIES_KNOBS } from './cities';
import { CONSORTS_KNOBS } from './consorts';
import { CONTROL_KNOBS } from './control';
import { COUNCIL_KNOBS } from './council';
import { COUNCIL_RULES_KNOBS } from './councilRules';
import { DIPLOMACY_KNOBS } from './diplomacy';
import { DYNASTY_KNOBS } from './dynasty';
import { EXILE_KNOBS } from './exile';
import { KIN_KNOBS } from './kin';
import { MARRIAGES_KNOBS } from './marriages';
import { MIGRATION_KNOBS } from './migration';
import { OFFICIALS_KNOBS } from './officials';
import { PANDEMIC_KNOBS } from './pandemic';
import { PEOPLE_KNOBS } from './people';
import { PLAGUE_KNOBS } from './plague';
import { POLICY_KNOBS } from './policy';
import { POLITICS_KNOBS } from './politics';
import { POLITIES_KNOBS } from './polities';
import { POPULATION_KNOBS } from './population';
import { REFORM_KNOBS } from './reform';
import { REGENTS_KNOBS } from './regents';
import { REGIONS_KNOBS } from './regions';
import { ROUTES_KNOBS } from './routes';
import { ROYALS_KNOBS } from './royals';
import { RULERS_KNOBS } from './rulers';
import { TREATIES_KNOBS } from './treaties';
import { UNREST_KNOBS } from './unrest';
import { WARS_KNOBS } from './wars';
import { WOMEN_KNOBS } from './women';

export const CIV_KNOBS: readonly Knobs<Record<string, KnobValue>>[] = [
  ASSIMILATION_KNOBS,
  CITIES_KNOBS,
  CONSORTS_KNOBS,
  CONTROL_KNOBS,
  COUNCIL_KNOBS,
  COUNCIL_RULES_KNOBS,
  DIPLOMACY_KNOBS,
  DYNASTY_KNOBS,
  EXILE_KNOBS,
  KIN_KNOBS,
  MARRIAGES_KNOBS,
  MIGRATION_KNOBS,
  OFFICIALS_KNOBS,
  PANDEMIC_KNOBS,
  PEOPLE_KNOBS,
  PLAGUE_KNOBS,
  POLICY_KNOBS,
  POLITICS_KNOBS,
  POLITIES_KNOBS,
  POPULATION_KNOBS,
  REFORM_KNOBS,
  REGENTS_KNOBS,
  REGIONS_KNOBS,
  ROUTES_KNOBS,
  ROYALS_KNOBS,
  RULERS_KNOBS,
  TREATIES_KNOBS,
  UNREST_KNOBS,
  WARS_KNOBS,
  WOMEN_KNOBS,
];

const sameValue = (a: KnobValue, b: KnobValue) => (typeof a === 'number' ? a === b : typeof b !== 'number' && a.length === b.length && a.every((x, i) => x === b[i]));

/**
 * 清理一套改动:认不出的表、项,值不合用的(见 knobValueOk),和官方一样的,都去掉;表、项照登记的先后排。
 * 什么都不剩 = undefined(官方)。传进来的不改;交出去的冻住(几个世界可能共用同一份)
 */
export function cleanKnobs(patch: unknown): KnobPatch | undefined {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return undefined;
  const src = patch as Record<string, unknown>;
  const out: Record<string, Record<string, KnobValue>> = {};
  let any = false;
  for (const t of CIV_KNOBS) {
    if (!Object.prototype.hasOwnProperty.call(src, t.id)) continue;
    const p = src[t.id];
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    let row: Record<string, KnobValue> | undefined;
    for (const n of t.names) {
      if (!Object.prototype.hasOwnProperty.call(p, n)) continue;
      const v = (p as Record<string, unknown>)[n];
      if (!knobValueOk(t.values[n], v) || sameValue(t.values[n], v)) continue;
      (row ??= {})[n] = typeof v === 'number' ? v : Object.freeze([...v]);
    }
    if (row) {
      out[t.id] = Object.freeze(row);
      any = true;
    }
  }
  return any ? Object.freeze(out) : undefined;
}

/** 一套改动的键(清理过的改动:内容一样键就一样;±Infinity 也分得开) */
export const knobsKey = (p: KnobPatch) => JSON.stringify(p, (_k, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));

/** 最近用过的几套(内容一样的改动认同一套:两个世界用同样的改动,配好的表、按它算的东西只做一次) */
const recent = new Map<string, KnobSet>();
const RECENT_KEEP = 8;

/** 一套改动(清理以后)对应的那套数;没有改动、清理完什么都不剩 = 官方 */
export function knobSet(patch: unknown): KnobSet {
  const c = cleanKnobs(patch);
  if (!c) return OFFICIAL_KNOBS;
  const key = knobsKey(c);
  let s = recent.get(key);
  if (s) recent.delete(key);
  else s = knobSetOf(c);
  recent.set(key, s);
  if (recent.size > RECENT_KEEP) recent.delete(recent.keys().next().value!);
  return s;
}

/** 两套改动是不是一样(按清理以后比;undefined = 官方) */
export function sameKnobs(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const x = cleanKnobs(a);
  const y = cleanKnobs(b);
  return x === y || (!!x && !!y && knobsKey(x) === knobsKey(y));
}

/** 一个世界(推出来的 Civ)用的那套数:推演之外现算的(讲故事、界面里现算人物)都从这里取 */
export function knobsOf(civ: { readonly knobs?: KnobPatch }): KnobSet {
  return knobSetOf(civ.knobs);
}
