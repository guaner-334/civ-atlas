/**
 * 插件提的「改你写的东西」:改名、加标记、下干预。一次调用的整批先套在现在的修改上算好,有一条不合格整批不改,不替插件改;
 * 合格的由网站照办,整批记一步撤销。查的只是改完的世界能存、能打开,不替用的人判断改得对不对。
 */
import type { Civ } from '../gen/civ/types';
import {
  cleanMark,
  cleanMarkNote,
  cleanMarkTitle,
  cleanName,
  INTERVENTION_YEAR_MAX,
  isRegionKey,
  markAiName,
  markRegionTotal,
  MARK_COLORS,
  MARK_NOTE_MAX,
  MARK_REGIONS_MAX,
  MARK_REGIONS_TOTAL,
  MARK_SIZES,
  MARK_TITLE_MAX,
  MARKS_MAX,
  NAME_MAX,
  nextMarkId,
  resolveKey,
  type AuthorMark,
  type Intervention,
  type WorldEdits,
} from '../gen/edits';
import { checkIntervention } from '../gen/ivCheck';
import { makeSave, saveText, SAVE_MAX_BYTES } from '../gen/savefile';
import { TERRAIN_H } from '../gen/terrainOps';
import type { WorldParams } from '../gen/world';
import { argsOf, bad, int, isRec, list, num, over, PluginApiError } from './check';
import { approxBytes } from './protocol';
import type { ApplyResult } from './types';

/** 一次最多提几条 */
export const CHANGES_MAX = 200;
/** 一条最大多少字节(估的;最大的是圈满州的标记):同一个大数组可以被很多条引用,先挡住再清理 */
const CHANGE_MAX_BYTES = 64 * 1024;
/** 插件改完以后干预、改名最多几条 */
export const PLUGIN_INTERVENTIONS_MAX = 10_000;
export const PLUGIN_NAMES_MAX = 20_000;
/** 存档里修改以外的东西(校验、世界名、视角、出处)留的地方 */
const SAVE_ROOM = 64 * 1024;

export interface PlannedChanges {
  next: WorldEdits;
  result: ApplyResult;
  /** 这批碰到的稳定键(网站那边看现在能不能改) */
  keys: string[];
}

function needCiv(civ: Civ | null): Civ {
  if (!civ) throw new PluginApiError('unavailable', '这个世界还没有历史,改名、下干预要等历史推出来');
  return civ;
}

/** 一条干预点到的键(国家、对方、城、州、民族) */
function ivKeys(v: Intervention): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === 'string' && /^(polity|region|settlement|culture|person):/.test(x)) out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
  };
  for (const val of Object.values(v)) walk(val);
  return out;
}

const chars = (s: string) => [...s].length;

/** 不合格回 bad-args、超上限回 limit,不替插件改;合格的再照存标记的规矩整理(去空白、州键去重) */
function checkMark(raw: unknown, at: string, id: number): AuthorMark {
  if (!isRec(raw)) return bad(`${at} 要是对象`);
  const tints: readonly unknown[] = [...MARK_COLORS, 'none'];
  if (!tints.includes(raw.color)) bad(`${at}.color 只能是 ${tints.join('、')}`);
  if (raw.size !== undefined && !(MARK_SIZES as readonly unknown[]).includes(raw.size)) bad(`${at}.size 只能是 ${MARK_SIZES.join('、')}`);
  if (typeof raw.title !== 'string') bad(`${at}.title 要是字`);
  if (chars(cleanMarkTitle(raw.title, Infinity)) > MARK_TITLE_MAX) over(`${at}.title 最多 ${MARK_TITLE_MAX} 个字`);
  if (raw.note !== undefined && typeof raw.note !== 'string') bad(`${at}.note 要是字`);
  if (chars(cleanMarkNote(raw.note, Infinity)) > MARK_NOTE_MAX) over(`${at}.note 最多 ${MARK_NOTE_MAX} 个字`);
  const from = int(raw.from, `${at}.from`, 0, INTERVENTION_YEAR_MAX);
  if (raw.to !== undefined) int(raw.to, `${at}.to`, from, INTERVENTION_YEAR_MAX);
  if (raw.at === undefined && raw.regions === undefined) bad(`${at} 要给 at(一个点)或 regions(几个州)`);
  if (raw.at !== undefined && raw.regions !== undefined) bad(`${at} 的 at 和 regions 只给一个`);
  if (raw.regions !== undefined) {
    const rs = raw.regions;
    if (!Array.isArray(rs) || !rs.length) return bad(`${at}.regions 要是州键的数组,至少一个`);
    if (rs.length > MARK_REGIONS_MAX) over(`${at}.regions 最多 ${MARK_REGIONS_MAX} 个州`);
    for (let j = 0; j < rs.length; j++) if (!isRegionKey(rs[j])) bad(`${at}.regions[${j}] 不是州键(history.regions 的 key)`);
  } else {
    const p = raw.at;
    if (!Array.isArray(p) || p.length !== 2) return bad(`${at}.at 要是一个点 [x, y]`);
    num(p[0], `${at}.at[0]`);
    num(p[1], `${at}.at[1]`, 0, TERRAIN_H);
  }
  return cleanMark({ ...raw, id }) ?? bad(`${at} 不是合格的标记`);
}

/** 整批算好;不合格抛 PluginApiError(bad-args / limit / unavailable)。params = 这个世界的参数(量改完以后的存档有多大) */
export function planChanges(edits: WorldEdits, civ: Civ | null, raw: unknown, params: WorldParams): PlannedChanges {
  const changes = list(argsOf(raw).changes, 'changes', CHANGES_MAX);
  let names = edits.names;
  let aiNames = edits.aiNames;
  let interventions = edits.interventions;
  let marks = edits.marks ?? [];
  const keys: string[] = [];
  const result: ApplyResult = { applied: 0, skipped: 0, marks: [] };
  changes.forEach((c, i) => {
    const at = `changes[${i}]`;
    if (!isRec(c)) return bad(`${at} 要是对象`);
    if (approxBytes(c, CHANGE_MAX_BYTES) > CHANGE_MAX_BYTES) over(`${at} 太大`);
    if (c.kind === 'name') {
      const h = needCiv(civ);
      const key = c.key;
      const r = typeof key === 'string' ? resolveKey(h, key) : null;
      if (!r || typeof key !== 'string') return bad(`${at}.key 在这个世界里找不到`);
      if (c.name !== null && typeof c.name !== 'string') return bad(`${at}.name 要是字或 null(null = 恢复原名)`);
      const eastern = (r.kind === 'polity' || r.kind === 'dynasty') && !!h.polities[r.id]?.eastern;
      const name = c.name === null ? '' : cleanName(r.kind, c.name, eastern, Infinity);
      if (chars(name) > NAME_MAX) over(`${at}.name 最多 ${NAME_MAX} 个字`);
      if ((names[key] ?? '') === name) {
        result.skipped++;
        return;
      }
      if (names === edits.names) names = { ...names };
      if (name) names[key] = name;
      else delete names[key];
      aiNames = markAiName({ ...edits, names, aiNames }, key, name || null, false);
      keys.push(key);
    } else if (c.kind === 'mark') {
      if (marks.length >= MARKS_MAX) over(`标记最多 ${MARKS_MAX} 个`);
      const id = nextMarkId(marks);
      const m = checkMark(c.mark, `${at}.mark`, id);
      if (m.regions && markRegionTotal(marks) + m.regions.length > MARK_REGIONS_TOTAL) over(`所有标记一共最多圈 ${MARK_REGIONS_TOTAL} 个州`);
      marks = [...marks, m];
      result.marks.push(id);
    } else if (c.kind === 'intervention') {
      needCiv(civ);
      if (!isRec(c.v)) return bad(`${at}.v 要是对象`);
      // 照大纲推演、推演插件自己记的几样去掉:插件交上来的就是作者自己下的
      const { plot: _p, guide: _g, plugin: _q, ...plain } = c.v;
      if (plain.kind === 'policy') {
        delete plain.power;
        delete plain.unrest;
        delete plain.look;
      }
      const r = checkIntervention(plain);
      if ('error' in r) return r.limit ? over(`${at}.v 的 ${r.error}`) : bad(`${at}.v 的 ${r.error}`);
      const v = r.ok;
      const k = JSON.stringify(v);
      if (interventions.some((x) => JSON.stringify(x) === k)) {
        result.skipped++;
        return;
      }
      if (interventions.length >= PLUGIN_INTERVENTIONS_MAX) over(`干预最多 ${PLUGIN_INTERVENTIONS_MAX} 条`);
      interventions = [...interventions, v];
      keys.push(...ivKeys(v));
    } else return bad(`${at}.kind 只能是 name、mark、intervention`);
    result.applied++;
  });
  if (names !== edits.names && Object.keys(names).length > PLUGIN_NAMES_MAX) over(`改名最多 ${PLUGIN_NAMES_MAX} 个`);
  if (!result.applied) return { next: edits, result, keys };
  const next: WorldEdits = { ...edits, names, interventions };
  if (aiNames) next.aiNames = aiNames;
  else delete next.aiNames;
  if (marks.length) next.marks = marks;
  if (saveText(makeSave(params, next, '')).length > SAVE_MAX_BYTES - SAVE_ROOM) over('改完以后存档太大,存不下');
  return { next, result, keys };
}
