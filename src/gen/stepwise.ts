/**
 * 逐年推演的数据(纯计算,不碰 DOM;界面、worker、Node 里都能用)。进度(play)、从第几年起(playFrom)、推进设置(advance)的格式见 edits.ts 文件头。
 *
 * - 从推演模式的一个世界第 T 年开始(startStepwise):全部修改照带(改名、标记、地形、地形大事……),进度停在第 T 年年初、还没下过命令。
 *   作者在 T 年以后(from ≥ T)下过的干预默认都带着,到那一年照样发生:不加命令时逐年推演出来的历史和推演模式那条一模一样。
 *   laterInterventions 列出这几条,drop 给出不带的(只是那几条不发生;去掉的那条后面的干预在列表里往前挪一位,
 *   史事 intervene 的 war 列跟着变,别的不变)。T 年以前的干预是已经发生的历史,不能去掉。
 * - 带着的干预到了那一年生没生效、没生效为什么(interventionFate):对象到时候已经不在了的不生效,说明原因。
 * - 从这一年重新演绎(rewindStepwise):逐年推演中倒回以前的某一年,那一年和以后下过的干预不要了,从那里接着走。
 * - 存回推演模式(stepwiseToNormal):"种子 + 到现在为止的干预串"变成一个普通世界的修改 —— 干预 = 作者的干预后面接上一路下过的命令
 *   (先后不变),推演年数 = 现在那一年。打开它(从第 0 年推到那一年)和逐年推演到"现在"一样
 *   (多出来的只是"现在"那一年第一刻的事:逐年推演停在那一刻之前),之后能照普通世界接着再推 N 年(worker 的 extend)。
 *   只存当前这一支,另开的几支不带。
 * - 支线(格式见 edits.ts 文件头"支线"):从以前的某一年另开一支(forkBranch,只记一笔,不在用),切到某一支(switchBranch:
 *   那一支换成进度,原来的那一支留在列表里;之后照进度从第 0 年重推),改名(renameBranch)、删掉(deleteBranch,当前这一支不能删),
 *   列出几支(branchList)。当前这一支的过去变了(切换、重新演绎)时别的几支跟着换记法,每一支完整的进度不变:
 *   切回哪一支,推出来的都和带着它那串命令从第 0 年推到它走到的那年一样。
 *
 * 一步走几年、走完停不停在 ui/stepwisePlan.ts。
 */
import type { Civ } from './civ/types';
import { interventionOutcome } from './civ/chronicle';
import { polityName } from './civ/growth';
import {
  BRANCH_ID_MAX,
  END_YEAR_MAX,
  END_YEAR_MIN,
  cleanEndYear,
  cleanIntervention,
  cleanBranchName,
  cleanBranchNote,
  cleanBranches,
  cleanPlay,
  playFromOf,
  playInterventions,
  resolveKey,
  type Intervention,
  type PlayBranch,
  type PlayBranches,
  type PlayState,
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
 * 从推演模式的世界 edits 第 year 年开始逐年推演:新世界的修改(edits 不改)。另开的几支不带。
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
  const { play: _play, playFrom: _from, endYear: _end, branches: _branches, ...rest } = edits;
  return { ...rest, interventions, play: { year: T, commands: [] }, ...(T > 0 ? { playFrom: T } : {}) };
}

/**
 * 从第 year 年重新演绎(倒回;edits 不改):逐年推演中的世界回到第 T 年年初(T = year 取整到那一年,夹到 [0, 现在];
 * 停在第 T 年 = 那一年年初,和逐年推演停下的那一年一样,这一年的事还没发生),从那里接着一步步往下走。
 * - 一路下过的干预(命令串)里 T 年和以后才生效的(from ≥ T)一起不要,按先后列在 dropped;T 年以前的照旧
 * - 另开的几支照旧留着(换记法,完整的进度不变;要把原来这条留成一支,先 forkBranch 再 switchBranch)
 * - 作者在推演模式里的干预照带:T 年以后的到那一年照样发生(和从第 T 年开始逐年推演一样)
 * - T 比这次起演的那一年还早:"从第几年起演绎"改成 T(第 0 年 = 不写);推进设置等别的修改照带
 * 没在逐年推演(没有合格的进度)= null。倒回以后不加干预时,推出来的和推演模式里带着同样干预推到那一年一模一样
 */
export function rewindStepwise(edits: WorldEdits, year: number): { edits: WorldEdits; dropped: Intervention[] } | null {
  const play = cleanPlay(edits.play);
  if (!play) return null;
  const T = Number.isFinite(year) ? Math.min(play.year, Math.max(0, Math.floor(year))) : 0;
  const keep = play.commands.filter((v) => v.from < T);
  const dropped = play.commands.filter((v) => v.from >= T);
  const start = Math.min(playFromOf(edits), T);
  const { play: _play, playFrom: _from, branches, ...rest } = edits;
  const bs = cleanBranches(branches, play);
  const next: WorldEdits = { ...rest, play: { year: T, commands: keep }, ...(start > 0 ? { playFrom: start } : {}) };
  return { edits: bs ? withBranches(next, { ...bs, list: rebase(bs.list, play, T) }) : next, dropped };
}

/**
 * 存回推演模式:逐年推演中的世界 → 一个普通世界的修改(edits 不改)。干预 = 作者的干预后面接上命令串(playInterventions,先后不变),
 * 推演年数 = play.year(至少 END_YEAR_MIN:在第 0 年存回的推到第 1 年);去掉 play、playFrom 和另开的几支(只存当前这一支),别的修改(含推进设置)照带。
 * 存成新世界还是盖掉原来的由界面定(默认存成新世界)。没在逐年推演的(没有合格的 play)原样返回(有不合格的 play、playFrom 就去掉)。
 * 进度推过了 END_YEAR_MAX 的存不回(普通世界最多推到那一年,存回去会丢掉后面的历史)= null;照 ui/stepwisePlan.ts 的 nextStep 走不会走过那一年
 */
export function stepwiseToNormal(edits: WorldEdits): WorldEdits | null {
  const play = cleanPlay(edits.play);
  if (!play && edits.play === undefined && edits.playFrom === undefined && edits.branches === undefined) return edits;
  const { play: _play, playFrom: _from, branches: _branches, endYear, ...rest } = edits;
  if (!play) return { ...rest, ...(endYear !== undefined ? { endYear } : {}) };
  if (play.year > END_YEAR_MAX) return null;
  const years = cleanEndYear(Math.max(END_YEAR_MIN, play.year));
  return { ...rest, interventions: [...playInterventions(edits.interventions, play)], ...(years !== undefined ? { endYear: years } : {}) };
}

// ---------------------------------------------------------------------------
// 支线(格式见 edits.ts 文件头"支线")

/** 一支完整的进度:当前这一支(cur)命令串里早于 from 的几条 + 这一支自己的 */
export function branchPlay(cur: PlayState, b: Pick<PlayBranch, 'from' | 'year' | 'commands'>): PlayState {
  return { year: b.year, commands: [...cur.commands.filter((v) => v.from < b.from), ...b.commands] };
}

/**
 * 当前这一支换了(cur → 新的进度,两份在第 F 年以前的命令一样):别的几支换成相对新进度的记法 ——
 * from 晚于 F 的改成 F,补上原来借当前这一支的那几条(F 年和以后、早于原来的 from);每一支完整的进度不变
 */
function rebase(list: readonly PlayBranch[], cur: PlayState, F: number): PlayBranch[] {
  return list.map((b) => (b.from <= F ? b : { ...b, from: F, commands: branchPlay(cur, b).commands.filter((v) => v.from >= F) }));
}

/** 放回修改里(edits 不改):list 是空的、当前这一支没起名、编号是 1 = 去掉这一项 */
function withBranches(edits: WorldEdits, bs: PlayBranches): WorldEdits {
  const { branches: _old, ...rest } = edits;
  return !bs.list.length && !bs.name && bs.id === 1 ? rest : { ...rest, branches: bs };
}

/** 当前这一支的进度和清理过的支线(没另开过 = 只有当前这一支,编号 1);没在逐年推演 = null */
function branchesOf(edits: WorldEdits): { cur: PlayState; bs: PlayBranches } | null {
  const cur = cleanPlay(edits.play);
  if (!cur) return null;
  return { cur, bs: cleanBranches(edits.branches, cur) ?? { id: 1, list: [] } };
}

/** 列表里的一支(branchList) */
export interface BranchInfo {
  /** 编号(另开的先后) */
  id: number;
  /** 名字;没有 = 没起名 */
  name?: string;
  /** 是不是当前这一支 */
  current: boolean;
  /** 从第几年起和当前这一支不一样(当前这一支没有) */
  from?: number;
  /** 走到第几年年初 */
  year: number;
  /** 从第几年起演绎 */
  playFrom: number;
  /** 完整的进度(推演时接在作者的干预后面) */
  play: PlayState;
  /** 切走时记下的最后一件大事(当前这一支没有:由界面按现在的历史写) */
  last?: string;
}

/** 所有的支(连当前这一支),按编号排(= 另开的先后)。没在逐年推演 = [] */
export function branchList(edits: WorldEdits): BranchInfo[] {
  const r = branchesOf(edits);
  if (!r) return [];
  const { cur, bs } = r;
  const out: BranchInfo[] = [
    { id: bs.id, ...(bs.name ? { name: bs.name } : {}), current: true, year: cur.year, playFrom: playFromOf(edits), play: cur },
    ...bs.list.map((b) => ({
      id: b.id,
      ...(b.name ? { name: b.name } : {}),
      current: false,
      from: b.from,
      year: b.year,
      playFrom: b.playFrom ?? 0,
      play: branchPlay(cur, b),
      ...(b.last ? { last: b.last } : {}),
    })),
  ];
  return out.sort((a, b) => a.id - b.id);
}

/**
 * 从第 year 年另开一支(edits 不改):只记一笔 —— 新的一支停在第 T 年年初,T 年以前和当前这一支一样,还没下命令;
 * 不切过去,不用重推。T = year 取整到那一年,夹到 [0, 现在];从第几年起演绎 = 当前这一支的和 T 里早的那个(同 rewindStepwise)。
 * 返回新的修改和新的一支的编号(最大的加一);没在逐年推演、编号用完了 = null。要从那一年接着演绎,再 switchBranch 过去
 */
export function forkBranch(edits: WorldEdits, year: number, name?: string): { edits: WorldEdits; id: number } | null {
  const r = branchesOf(edits);
  if (!r) return null;
  const { cur, bs } = r;
  const T = Number.isFinite(year) ? Math.min(cur.year, Math.max(0, Math.floor(year))) : 0;
  const id = bs.list.reduce((m, b) => Math.max(m, b.id), bs.id) + 1;
  if (id > BRANCH_ID_MAX) return null;
  const nm = cleanBranchName(name);
  const start = Math.min(playFromOf(edits), T);
  const b: PlayBranch = { id, ...(nm ? { name: nm } : {}), from: T, year: T, commands: [], ...(start > 0 ? { playFrom: start } : {}) };
  return { edits: withBranches(edits, { ...bs, list: [...bs.list, b] }), id };
}

/**
 * 切到编号 id 的那一支(edits 不改):它完整的进度换成 play、它的从第几年起换成 playFrom;原来的当前这一支留在列表里
 * (last = 它现在的最后一件大事,列表里显示;可以不给),别的几支换记法。之后照新的 play 从第 0 年重推,
 * 和带着那串命令一口气推到那一年一样。已经是当前这一支 = 原样返回;没有这一支、没在逐年推演 = null
 */
export function switchBranch(edits: WorldEdits, id: number, last?: string): WorldEdits | null {
  const r = branchesOf(edits);
  if (!r) return null;
  const { cur, bs } = r;
  if (id === bs.id) return edits;
  const b = bs.list.find((x) => x.id === id);
  if (!b) return null;
  const F = b.from;
  const from = playFromOf(edits);
  const note = cleanBranchNote(last);
  const old: PlayBranch = {
    id: bs.id,
    ...(bs.name ? { name: bs.name } : {}),
    from: F,
    year: cur.year,
    commands: cur.commands.filter((v) => v.from >= F),
    ...(from > 0 ? { playFrom: from } : {}),
    ...(note ? { last: note } : {}),
  };
  const list = [...rebase(bs.list.filter((x) => x !== b), cur, F), old].sort((x, y) => x.id - y.id);
  const { play: _play, playFrom: _from, ...rest } = edits;
  const next: WorldEdits = { ...rest, play: branchPlay(cur, b), ...(b.playFrom ? { playFrom: b.playFrom } : {}) };
  return withBranches(next, { id: b.id, ...(b.name ? { name: b.name } : {}), list });
}

/** 给编号 id 的那一支(当前这一支也行)改名(edits 不改):名字清理过,空 = 去掉名字。没有这一支、没在逐年推演 = null */
export function renameBranch(edits: WorldEdits, id: number, name: string): WorldEdits | null {
  const r = branchesOf(edits);
  if (!r) return null;
  const { bs } = r;
  const nm = cleanBranchName(name);
  if (id === bs.id) return withBranches(edits, { id, ...(nm ? { name: nm } : {}), list: bs.list });
  const i = bs.list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const { id: _id, name: _name, ...o } = bs.list[i];
  const list = bs.list.slice();
  list[i] = { id, ...(nm ? { name: nm } : {}), ...o };
  return withBranches(edits, { ...bs, list });
}

/** 删掉编号 id 的那一支(edits 不改;别的几支不受影响)。当前这一支不能删;没有这一支、没在逐年推演 = null */
export function deleteBranch(edits: WorldEdits, id: number): WorldEdits | null {
  const r = branchesOf(edits);
  if (!r || id === r.bs.id) return null;
  const list = r.bs.list.filter((x) => x.id !== id);
  if (list.length === r.bs.list.length) return null;
  return withBranches(edits, { ...r.bs, list });
}

/**
 * 一条干预在这份历史里怎么样了:'later' = 还没到那一年(from 比 civ.endYear 晚);'done' = 生效了;
 * 'void' = 到了那一年但没生效,why = 原因("那一年某国已亡""某国第 812 年才立国""新历史里没有这个国家";即位还有"他第 1520 年才出生"……)。
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
