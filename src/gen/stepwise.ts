/**
 * 逐年推演的数据(纯计算,不碰 DOM;界面、worker、Node 里都能用)。进度(play)、从第几年起(playFrom)、推进设置(advance)的格式见 edits.ts 文件头。
 *
 * - 从推演模式的一个世界第 T 年开始(startStepwise):全部修改照带(改名、标记、地形、地形大事……),进度停在第 T 年年初、还没下过命令。
 *   作者在 T 年以后(from ≥ T)下过的干预默认都带着,到那一年照样发生:不加命令时逐年推演出来的历史和推演模式那条一模一样。
 *   laterInterventions 列出这几条,drop 给出不带的(只是那几条不发生;去掉的那条后面的干预在列表里往前挪一位,
 *   史事 intervene 的 war 列跟着变,别的不变)。T 年以前的干预是已经发生的历史,不能去掉。
 * - 带着的干预到了那一年生没生效、没生效为什么(interventionFate):对象到时候已经不在了的不生效,说明原因。
 * - 存回推演模式(stepwiseToNormal):"种子 + 到现在为止的干预串"变成一个普通世界的修改 —— 干预 = 作者的干预后面接上一路下过的命令
 *   (先后不变),推演年数 = 现在那一年。打开它(从第 0 年推到那一年)和逐年推演到"现在"一样
 *   (多出来的只是"现在"那一年第一刻的事:逐年推演停在那一刻之前),之后能照普通世界接着再推 N 年(worker 的 extend)。
 *
 * 一步走几年、走完停不停在 ui/stepwisePlan.ts。
 */
import type { Civ } from './civ/types';
import { interventionOutcome } from './civ/chronicle';
import { polityName } from './civ/growth';
import {
  END_YEAR_MAX,
  END_YEAR_MIN,
  cleanEndYear,
  cleanIntervention,
  cleanPlay,
  playInterventions,
  resolveKey,
  type Intervention,
  type WorldEdits,
} from './edits';

/** 能从第几年开始:取整、夹到 [0, END_YEAR_MAX](不是有限数 = 0) */
export function stepwiseYear(year: number): number {
  return Number.isFinite(year) ? Math.min(END_YEAR_MAX, Math.max(0, Math.round(year))) : 0;
}

/** 世界里推演用的干预(作者的干预后面接上逐年推演下过的命令;没在逐年推演 = 作者的干预),没清理(认不出的也在,下标和修改里一致) */
function allInterventions(edits: WorldEdits): readonly unknown[] {
  const play = cleanPlay(edits.play);
  return play ? [...edits.interventions, ...play.commands] : edits.interventions;
}

/**
 * 从第 year 年开始逐年推演时会带着的干预:第 year 年和以后(from ≥ year)才生效的那几条,按列表先后。
 * index = 在 edits.interventions 里的下标(edits 已经在逐年推演 = 在"作者的干预 + 命令串"里的下标),startStepwise 的 drop 用它
 */
export function laterInterventions(edits: WorldEdits, year: number): { index: number; v: Intervention }[] {
  const T = stepwiseYear(year);
  const out: { index: number; v: Intervention }[] = [];
  allInterventions(edits).forEach((x, index) => {
    const v = cleanIntervention(x);
    if (v && v.from >= T) out.push({ index, v });
  });
  return out;
}

/**
 * 从推演模式的世界 edits 第 year 年开始逐年推演:新世界的修改(edits 不改)。
 * - 进度 play = { year: T, commands: [] }(T = stepwiseYear(year)),从第几年起 playFrom = T;推演年数(endYear)去掉(逐年推演推到哪由 play 定)
 * - 作者的干预照带;drop = 不带的那几条(laterInterventions 的 index;T 年以前的不能去掉,给了也不管)
 * - 别的修改(改名、标记、人物、改旗、地形、草图、地形大事、纪年、推进设置……)照带
 * edits 已经在逐年推演:先照存回推演模式(stepwiseToNormal)把命令串并进干预,再从第 T 年开始
 */
export function startStepwise(edits: WorldEdits, year: number, drop: readonly number[] = []): WorldEdits {
  const T = stepwiseYear(year);
  const gone = new Set(drop);
  const list = allInterventions(edits);
  const interventions = list.filter((x, i) => {
    if (!gone.has(i)) return true;
    const v = cleanIntervention(x);
    return !v || v.from < T;
  }) as Intervention[];
  const { play: _play, playFrom: _from, endYear: _end, ...rest } = edits;
  return { ...rest, interventions, play: { year: T, commands: [] }, ...(T > 0 ? { playFrom: T } : {}) };
}

/**
 * 存回推演模式:逐年推演中的世界 → 一个普通世界的修改(edits 不改)。干预 = 作者的干预后面接上命令串(playInterventions,先后不变),
 * 推演年数 = play.year(至少 END_YEAR_MIN:在第 0 年存回的推到第 1 年);去掉 play、playFrom,别的修改(含推进设置)照带。
 * 存成新世界还是盖掉原来的由界面定(默认存成新世界)。没在逐年推演的(没有合格的 play)原样返回(有不合格的 play、playFrom 就去掉)
 */
export function stepwiseToNormal(edits: WorldEdits): WorldEdits {
  const play = cleanPlay(edits.play);
  if (!play && edits.play === undefined && edits.playFrom === undefined) return edits;
  const { play: _play, playFrom: _from, endYear, ...rest } = edits;
  if (!play) return { ...rest, ...(endYear !== undefined ? { endYear } : {}) };
  const years = cleanEndYear(Math.max(END_YEAR_MIN, play.year));
  return { ...rest, interventions: [...playInterventions(edits.interventions, play)], ...(years !== undefined ? { endYear: years } : {}) };
}

/**
 * 一条干预在这份历史里怎么样了:'later' = 还没到那一年(from 比 civ.endYear 晚);'done' = 生效了;
 * 'void' = 到了那一年但没生效,why = 原因("那一年某国已亡""某国第 812 年才立国""新历史里没有这个国家"……)。
 * annal = 它那条史事 intervene 在 civ.annals 里的下标(对象不在、连史事都没记 = −1)。i = 在 civ.interventions 里的下标
 */
export type InterventionFate = { state: 'later' } | { state: 'done'; annal: number } | { state: 'void'; annal: number; why: string };

export function interventionFate(civ: Civ, i: number): InterventionFate {
  const v = civ.interventions?.[i];
  if (!v) return { state: 'void', annal: -1, why: '没有这条干预' };
  if (v.from > civ.endYear) return { state: 'later' };
  const r = interventionOutcome(civ, i);
  if (r.annal >= 0) return r.ok ? { state: 'done', annal: r.annal } : { state: 'void', annal: r.annal, why: r.why ?? '没有生效' };
  if (v.kind === 'found') return { state: 'void', annal: -1, why: '没有生效' };
  const k = resolveKey(civ, v.a);
  if (!k || k.kind !== 'polity') return { state: 'void', annal: -1, why: '新历史里没有这个国家' };
  const p = civ.polities[k.id];
  if (p.founded > v.from) return { state: 'void', annal: -1, why: `${polityName(p, p.founded) || p.name}第 ${Math.floor(p.founded)} 年才立国` };
  if (p.ended !== undefined && p.ended <= v.from) {
    const name = polityName(p, p.ended - 1 / 512) || p.name;
    return { state: 'void', annal: -1, why: `${name}第 ${Math.floor(p.ended)} 年已亡` };
  }
  return { state: 'void', annal: -1, why: '没有生效' };
}
