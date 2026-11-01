/**
 * 当前世界的用户修改(阶段 4,格式见 gen/edits.ts 的 WorldEdits):改名、干预、地形修改、草图、地形大事、作者标记、改旗、作者的人物。
 * 和 civView.ts 一样的小 store(get / set / use)。换世界(种子 / 参数变了)时 App 调 clearEdits 清空。
 *
 * 这里只管内存里的这一份;存进浏览器 / 存成文件在 saveStore.ts(经 subscribeEdits 订阅,修改一变就自动存),
 * 读档时 App 先按存档的参数生成,再 setEdits(存档里的修改)。
 *
 * 撤销 / 重做(⌘Z / ⇧⌘Z,见 undo.ts):改名、改旗、干预、地形大事、作者标记、作者的人物、AI 改写每次都记一步(改之前、改之后两份),只记这次打开网页以后、这个世界上的;
 * 读档、换世界(setEdits / clearEdits)、创建世界(clearEditHistory)清空。地形修改、草图、地名风格、推演年数、拓荒、起源、天灾、规则不记:只在新建世界时能改,工具有自己的"撤销一笔"。
 * 纪年、月份(一年几个月、月份的名字)也不记:只换年份的写法,在世界设定里随时改回来。文明种子、用的哪张地图在新开历史时定,之后不改(只在第一次推完时补上地图的校验)。
 * 逐年推演的进度、从第几年起、推进设置、导播跟着谁也不记(撤销别的时照现在的留着)。
 */
import { createListeners } from './createStore';
import {
  EMPTY_EDITS,
  MARKS_MAX,
  cleanAdvance,
  cleanFollow,
  cleanCivSeed,
  endFields,
  MARK_REGIONS_TOTAL,
  cleanIntervention,
  cleanMark,
  OUTLINE_PLOTS_MAX,
  cleanOutline,
  markRegionTotal,
  sameAdvance,
  sameFollow,
  sameMark,
  markAiName,
  nextMarkId,
  type Advance,
  type AdvanceSettings,
  type AuthorMark,
  type FollowRef,
  type Intervention,
  type Outline,
  type Plot,
  type PlotReview,
  type PlayState,
  type TerrainOp,
  type Upheaval,
  type WorldEdits,
} from '../gen/edits';
import { TERRAIN_MAX_OPS, UPHEAVALS_MAX, cleanTerrainOp, cleanUpheaval } from '../gen/terrainOps';
import { SKETCH_MAX_STROKES, cleanSketch, cleanSketchImage, cleanSketchStroke, encodeLayer, sketchCoast, sketchFill, type SketchEdit, type SketchFill, type SketchStroke } from '../gen/sketch';
import { PLATE_MAX_OPS, cleanPlateImage, cleanPlateOp, type PlateImage, type PlateOp } from '../gen/plateOps';
import { CHARACTERS_MAX, cleanCharacter, nextCharacterId, sameCharacter, type AuthorCharacter } from '../gen/characters';
import { showToast } from './toastStore';
import { cleanMix, sameMix, type NameMix } from '../gen/names/mix';
import { cleanEra, cleanMonthNames, cleanMonths, monthNamesInUse, monthsOf, sameEra, sameMonthNames, type Era, type MonthNames } from '../gen/era';
import { cleanFrontier, cleanOrigins, sameFrontier, sameOrigins, type Frontier, type Origins } from '../gen/civ/frontier';
import { cleanCalamity, type Calamity } from '../gen/civ/calamity';
import { newWorldRules, sameRuleSet, type RuleSet } from '../gen/civ/ruleSet';

let state: WorldEdits = EMPTY_EDITS;
const subs = createListeners();
const emit = subs.emit;

export function getEdits(): WorldEdits {
  return state;
}

/** 整个换掉(读档用;撤销记录清空)。传进来的对象之后别再改它 */
export function setEdits(next: WorldEdits) {
  past = [];
  future = [];
  era++;
  resetSubs.emit();
  put(next, false);
}

/** 整个换掉时(换世界、读档)要跟着清的东西(比如待推演的单子) */
const resetSubs = createListeners();
export function onEditsReset(f: () => void): () => void {
  return resetSubs.subscribe(f);
}

/** 整个换掉过几次(换了世界、读档):记着"这一笔是什么时候加的"的地方据此作废旧记录 */
let era = 0;
export function editsEra(): number {
  return era;
}

/** 换成 next;改历史的修改被拦下(historyGate)= false。读档(setEdits)不拦 */
function put(next: WorldEdits, gated = true): boolean {
  if (next === state) return true;
  if (gated && historyBlocked(next)) return false;
  state = next;
  emit();
  return true;
}

/**
 * 改历史之前问一声(App 在照原样打开的旧世界上挂上):干预、地形大事、地形修改、草图、地名风格、推演年数、拓荒、起源变了
 * 都要用现在的规则重新推演。gate 拿到改之后的修改,返回 true = 这次不改(App 问作者要不要另存一份,在那一份上改)
 */
let historyGate: ((next: WorldEdits) => boolean) | null = null;
export function setHistoryGate(f: ((next: WorldEdits) => boolean) | null) {
  historyGate = f;
}
const HISTORY_KEYS = ['interventions', 'upheavals', 'terrain', 'sketch', 'nameMix', 'endYear', 'endTick', 'frontier', 'origins', 'civSeed', 'calamity', 'rules'] as const;
/** 两份修改里,推演用到的部分不一样 */
export function historyDiffers(a: WorldEdits, b: WorldEdits): boolean {
  return HISTORY_KEYS.some((k) => a[k] !== b[k] && JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}
function historyBlocked(next: WorldEdits): boolean {
  return historyDiffers(state, next) && askHistory(next);
}
/** 要改成 next(会改历史)之前问一声:被拦下 = true(App 接着问作者) */
export function askHistory(next: WorldEdits): boolean {
  return !!historyGate && historyGate(next);
}

// ---------------------------------------------------------------------------
// 撤销 / 重做

/** 记下的一步:改之前、改之后;助手执行的一轮带上轮次(撤销 / 重做要经过助手那边,对话里的"已执行 / 已撤销"跟着变) */
export interface EditStep {
  before: WorldEdits;
  after: WorldEdits;
  turn?: { id: number; kind: 'apply' | 'undo' };
}

/** 最多记多少步(再早的丢掉) */
export const HISTORY_MAX = 100;
let past: EditStep[] = [];
let future: EditStep[] = [];
/** 正在撤销 / 重做:这时的修改不另记一步 */
let replaying = false;

/** 改一处,记一步(用户自己的修改都走这里;读档用 setEdits) */
export function commitEdits(next: WorldEdits, turn?: EditStep['turn']): boolean {
  if (next === state) return true;
  if (historyBlocked(next)) return false;
  if (!replaying) {
    past.push({ before: state, after: next, turn });
    if (past.length > HISTORY_MAX) past.shift();
    future = [];
  }
  return put(next, false);
}

export function canUndoEdit(): boolean {
  return past.length > 0;
}
export function canRedoEdit(): boolean {
  return future.length > 0;
}

/**
 * 撤销 / 重做一步:取出最近的一步交给 run 去做(run 里改修改照常走 commitEdits / put,不会另记一步),做完放进另一边。
 * 没有可做的 = false
 */
export function stepEdits(dir: 'undo' | 'redo', run: (s: EditStep) => void): boolean {
  const s = (dir === 'undo' ? past : future).pop();
  if (!s) return false;
  replaying = true;
  try {
    run(s);
  } finally {
    replaying = false;
  }
  (dir === 'undo' ? future : past).push(s);
  return true;
}

/** 把修改换成 next,不记一步(撤销 / 重做时用) */
export function replaceEdits(next: WorldEdits): boolean {
  return put(next);
}

/**
 * 把 now 里"从 from 变成 to"那一步的改动做一遍(撤销 = from 是改之后、to 是改之前;重做反过来)。
 * 之后没再改过(now 就是 from)= 正好变成 to;改过别的 = 只动这一步碰过的:
 * 改过的名字还是 from 里那样的才换回去,from 里多出来的干预 / 地形去掉,to 里有、现在没有的放回原来的位置。
 * 列表变了一律换成新数组(App 按数组是不是读档套上的那一份来认"自动恢复",撤销回去不能被当成恢复)
 */
export function revertEdits(now: WorldEdits, from: WorldEdits, to: WorldEdits): WorldEdits {
  const names = moveMap(now.names, from.names, to.names) ?? {};
  const aiNames = moveMap(now.aiNames, from.aiNames, to.aiNames);
  const interventions = moveList(now.interventions, from.interventions, to.interventions);
  const terrain = moveList(now.terrain, from.terrain, to.terrain);
  const upheavals = moveList(now.upheavals ?? [], from.upheavals ?? [], to.upheavals ?? []);
  const marks = moveById(now.marks, from.marks, to.marks);
  const flags = moveMap(now.flags, from.flags, to.flags);
  const characters = moveById(now.characters, from.characters, to.characters);
  // 大纲:这一步改过大纲、之后没再改过的,换回 to 那样(整份换;之后又改过的不动)
  const outlineMoved = JSON.stringify(from.outline ?? null) !== JSON.stringify(to.outline ?? null) && JSON.stringify(now.outline ?? null) === JSON.stringify(from.outline ?? null);
  const outline = outlineMoved ? to.outline : now.outline;
  const sameUps = upheavals === (now.upheavals ?? []) || (!upheavals.length && !now.upheavals);
  if (names === now.names && aiNames === now.aiNames && interventions === now.interventions && terrain === now.terrain && sameUps && marks === now.marks && flags === now.flags && characters === now.characters && outline === now.outline)
    return now;
  const out: WorldEdits = { names, interventions, terrain };
  // 草图、地名风格、推演年数、拓荒、起源、纪年、月份不记撤销步(见文件头),照现在的留着
  if (now.sketch) out.sketch = now.sketch;
  if (now.nameMix) out.nameMix = now.nameMix;
  if (now.endYear) out.endYear = now.endYear;
  if (now.endTick) out.endTick = now.endTick;
  if (now.frontier) out.frontier = now.frontier;
  if (now.calamity) out.calamity = now.calamity;
  if (now.rules) out.rules = now.rules;
  if (now.origins) out.origins = now.origins;
  if (now.civSeed !== undefined) out.civSeed = now.civSeed;
  if (now.map) out.map = now.map;
  if (now.era) out.era = now.era;
  if (now.months !== undefined) out.months = now.months;
  if (now.monthNames) out.monthNames = now.monthNames;
  // 逐年推演的进度、从第几年起、另开的几支、推进设置也不记撤销步(进度只往前走;设置随时能改回来)
  if (now.play) out.play = now.play;
  if (now.playFrom !== undefined) out.playFrom = now.playFrom;
  if (now.branches) out.branches = now.branches;
  if (now.advance) out.advance = now.advance;
  // 导播跟着谁只管看,不记撤销步,照现在的留着
  if (now.follow) out.follow = now.follow;
  if (upheavals.length) out.upheavals = sameUps ? now.upheavals : upheavals;
  if (aiNames && Object.keys(aiNames).length) out.aiNames = aiNames;
  if (marks?.length) out.marks = marks;
  if (flags && Object.keys(flags).length) out.flags = flags;
  if (characters?.length) out.characters = characters;
  if (outline) out.outline = outline;
  return out;
}

/**
 * 标记、作者的人物那一半:按编号认同一个 —— 从 from 到 to 这一步新建的(to 有、from 没有)去掉,删掉的放回原来的位置,
 * 改过的换回 to 那样(现在还是 from 那样的才换;之后又改过的不动)。都没动 = 原数组
 */
function moveById<M extends { id: number }>(now: readonly M[] | undefined, from: readonly M[] | undefined, to: readonly M[] | undefined): M[] | undefined {
  const N = now ?? [];
  const F = new Map((from ?? []).map((m) => [m.id, m]));
  const T = new Map((to ?? []).map((m) => [m.id, m]));
  const same = (a: M | undefined, b: M | undefined) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));
  let out: M[] | null = null;
  const list = () => (out ??= N.slice());
  for (const id of new Set([...F.keys(), ...T.keys()])) {
    const f = F.get(id);
    const t = T.get(id);
    if (same(f, t)) continue;
    const i = (out ?? N).findIndex((m) => m.id === id);
    const cur = i >= 0 ? (out ?? N)[i] : undefined;
    if (!same(cur, f)) continue;
    if (t && i >= 0) list()[i] = t;
    else if (t) list().splice(Math.min(list().length, (to ?? []).indexOf(t)), 0, t);
    else list().splice(i, 1);
  }
  return out ?? (now as M[] | undefined);
}

/** 键值表那一半(改名、AI 起名的记号、改过的旗):from 到 to 变了的键,现在还是 from 那样的才换成 to 那样;都没动 = 原对象 */
function moveMap<T>(now: Record<string, T> | undefined, from: Record<string, T> | undefined, to: Record<string, T> | undefined): Record<string, T> | undefined {
  const N = now ?? {};
  const F = from ?? {};
  const T = to ?? {};
  const same = (a: T | undefined, b: T | undefined) => a === b || JSON.stringify(a) === JSON.stringify(b);
  let out = now;
  for (const k of new Set([...Object.keys(F), ...Object.keys(T)])) {
    if (same(F[k], T[k]) || !same(N[k], F[k])) continue;
    if (out === now) out = { ...N };
    if (k in T) out![k] = T[k];
    else delete out![k];
  }
  return out;
}

/** 列表那一半:from 有 to 没有的从 now 去掉(各去一次);to 有 from 没有、now 里也没有的放回它在 to 里的位置 */
function moveList<T>(now: readonly T[], from: readonly T[], to: readonly T[]): T[] {
  const key = (x: T) => JSON.stringify(x);
  const drop = without(from, to);
  const add = without(to, from);
  if (!drop.length && !add.length) return now as T[];
  // 之后没再改过这一项(现在和 from 一模一样):正好换成 to(一模一样的有几条时,也不会认错撤销的是哪一条)
  if (now.length === from.length && now.every((x, i) => x === from[i] || key(x) === key(from[i]))) return to.slice();
  const out = without(now, drop);
  // 一模一样的可以有几条(同一处放了两次):按条数比,现在已经和 to 里一样多的不再放
  const count = (list: readonly T[]) => {
    const m = new Map<string, number>();
    for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
    return m;
  };
  const have = count(out);
  const want = count(to);
  for (const x of add) {
    const k = key(x);
    if ((have.get(k) ?? 0) >= (want.get(k) ?? 0)) continue;
    out.splice(Math.min(out.length, to.indexOf(x)), 0, x);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  return out.length === now.length && out.every((x, i) => x === now[i]) ? (now as T[]) : out;
}

/** 去掉 list 里和 drop 一样的那几条(各去一次) */
function without<T>(list: readonly T[], drop: readonly T[]): T[] {
  const left = drop.map((x) => JSON.stringify(x));
  return list.filter((x) => {
    const i = left.indexOf(JSON.stringify(x));
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

/** 清空撤销记录(点了"创建世界":新建时的修改从此不能撤销) */
export function clearEditHistory() {
  past = [];
  future = [];
}

export function useEdits(): WorldEdits {
  return subs.use(getEdits);
}

/** 不经过 React 订阅 */
export function subscribeEdits(f: (e: WorldEdits) => void): () => void {
  return subs.subscribe(() => f(state));
}

// ---- 能不能改(助手"先在地图上看看"时) ----

/**
 * 改名、下令之前问一声(App 在助手"先在地图上看看"时挂上):面板里这时是试推演的历史,那里的国家、城
 * 不一定是现在这份历史里的同一个,用它的键改会落到别的东西上或者落空。gate 返回不能改的原因(能改 = null)
 */
let gate: ((keys: string[]) => string | null) | null = null;
export function setEditGate(f: ((keys: string[]) => string | null) | null) {
  gate = f;
}
/** 这几个键现在能不能改:不能 = 原因 */
export function editBlock(keys: readonly string[]): string | null {
  return gate ? gate(keys.filter(Boolean)) : null;
}
/** 一条干预点到的键(国家、对方、城、州;饥荒选的几州;立约、划中立地的另几国等) */
export function interventionKeys(v: Intervention): string[] {
  const o = v as Partial<Record<'a' | 'b' | 'city' | 'region', string>>;
  const regions = v.kind === 'disaster' || v.kind === 'boost' ? (v.regions ?? []) : [];
  // 立约、划中立地:另几国,居间的国家、同时划的中立地
  // 大迁徙、不许迁:那一族;大迁徙的目的地
  const more = v.kind === 'treaty' ? [...v.ps, v.by, v.zone] : v.kind === 'neutral' ? v.ps : v.kind === 'trek' ? [v.folk, v.to] : v.kind === 'stay' ? [v.folk] : [];
  return [o.a, o.b, o.city, o.region, ...regions, ...more].filter((k): k is string => typeof k === 'string');
}

/**
 * 改名:name 为空(或 null)= 恢复默认(从 names 里去掉这个键)。现在不能改(editBlock)= 提示条说原因,不改。
 * from = 'ai':从 AI 起名里挑的,记一笔(名字旁标"AI 写",见 gen/edits.ts 的 aiNames);别的改名把这一笔去掉。
 * fallback = 生成时的名字:之前自己改过名、又从 AI 候选里挑回了生成时的名字,照样算 AI 起的(改名表里写明这个名字),
 * 导出"换回原名"时回到自己改的那个
 */
export function setName(key: string, name: string | null, from?: 'ai', fallback?: string) {
  const why = editBlock([key]);
  if (why) {
    showToast({ id: 'edit-block', kind: 'warn', text: why });
    return;
  }
  if (from === 'ai' && !name && fallback && key in state.names) name = fallback;
  const names = { ...state.names };
  if (name) names[key] = name;
  else if (key in names) delete names[key];
  else return;
  const aiNames = markAiName(state, key, name, from === 'ai');
  if (aiNames === state.aiNames && names[key] === state.names[key] && Object.keys(names).length === Object.keys(state.names).length) return;
  const { aiNames: _, ...rest } = state;
  commitEdits(aiNames ? { ...rest, names, aiNames } : { ...rest, names });
}

/**
 * 改旗:keys 里的几面换成 code(旗的写法,见 gen/civ/flags.ts 的 encodeFlag);code 为 null = 去掉这几面(恢复自动配的)。
 * 每次记一步(⌘Z 撤销)。现在不能改(editBlock)= 提示条说原因,不改
 */
export function setFlags(keys: readonly string[], code: string | null) {
  const why = editBlock([...keys]);
  if (why) {
    showToast({ id: 'edit-block', kind: 'warn', text: why });
    return;
  }
  const flags = { ...(state.flags ?? {}) };
  let changed = false;
  for (const k of keys) {
    if (code ? flags[k] === code : !(k in flags)) continue;
    if (code) flags[k] = code;
    else delete flags[k];
    changed = true;
  }
  if (!changed) return;
  const { flags: _, ...rest } = state;
  commitEdits(Object.keys(flags).length ? { ...rest, flags } : rest);
}

/**
 * 干预(阶段 4):加一条(清理过的;不合格的、和已有的一模一样的、现在不能改的不加)。返回是否加上了(下令的面板先问 editBlock 说原因)。
 * App 看到干预列表变了就在后台从第 0 年重推文明
 */
export function addIntervention(v: Intervention): boolean {
  const c = cleanIntervention(v);
  if (!c || editBlock(interventionKeys(c))) return false;
  const key = JSON.stringify(c);
  if (state.interventions.some((x) => JSON.stringify(x) === key)) return false;
  return commitEdits({ ...state, interventions: [...state.interventions, c] });
}

/** 干预:去掉第 i 条(下标越界 = 不动) */
export function removeIntervention(i: number) {
  if (!(i >= 0 && i < state.interventions.length)) return;
  commitEdits({ ...state, interventions: state.interventions.filter((_, j) => j !== i) });
}

/**
 * 待推演的单子一次推演:几条干预、几件地形大事一起加进去,只记一步(⌘Z 一次撤掉整批)、App 只重推一次。
 * 不合格的、和已有的一模一样的、现在不能改的干预不加;地形大事加到 UPHEAVALS_MAX 件为止。返回真加上了的;
 * 改历史被拦下(照原样打开的旧世界,App 问要不要另存一份)= null,一条都没加
 */
export function addEditsBatch(ivs: readonly Intervention[], ups: readonly Upheaval[]): { ivs: Intervention[]; ups: Upheaval[] } | null {
  const have = new Set(state.interventions.map((x) => JSON.stringify(x)));
  const addIvs: Intervention[] = [];
  for (const v of ivs) {
    const c = cleanIntervention(v);
    if (!c || editBlock(interventionKeys(c))) continue;
    const k = JSON.stringify(c);
    if (have.has(k)) continue;
    have.add(k);
    addIvs.push(c);
  }
  const list = state.upheavals ?? [];
  const addUps: Upheaval[] = [];
  for (const u of ups) {
    const c = cleanUpheaval(u);
    if (c && list.length + addUps.length < UPHEAVALS_MAX) addUps.push(c);
  }
  if (!addIvs.length && !addUps.length) return { ivs: [], ups: [] };
  const next: WorldEdits = { ...state, interventions: addIvs.length ? [...state.interventions, ...addIvs] : state.interventions };
  if (addUps.length) next.upheavals = [...list, ...addUps];
  if (!commitEdits(next)) return null;
  return { ivs: addIvs, ups: addUps };
}

/** 撤掉一整批(推完提示上的"撤销"):这几条干预、这几件地形大事各去掉一份 */
export function removeEditsBatch(ivs: readonly Intervention[], ups: readonly Upheaval[]) {
  const drop = <T,>(list: readonly T[], gone: readonly T[]): T[] => {
    const left = gone.map((x) => JSON.stringify(x));
    return list.filter((x) => {
      const i = left.indexOf(JSON.stringify(x));
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    });
  };
  const interventions = drop(state.interventions, ivs);
  const upheavals = drop(state.upheavals ?? [], ups);
  if (interventions.length === state.interventions.length && upheavals.length === (state.upheavals ?? []).length) return;
  const next: WorldEdits = { ...state, interventions, upheavals };
  if (!upheavals.length) delete next.upheavals;
  commitEdits(next);
}

/**
 * 地形大事:加一件(清理过的;不合格的、已满 UPHEAVALS_MAX 件的不加)。返回加上的那一件(没加 = null)。
 * App 看到地形大事变了就在后台从那一年起重推(那一年以前不变)
 */
export function addUpheaval(u: Upheaval): Upheaval | null {
  const c = cleanUpheaval(u);
  const list = state.upheavals ?? [];
  if (!c || list.length >= UPHEAVALS_MAX) return null;
  return commitEdits({ ...state, upheavals: [...list, c] }) ? c : null;
}

/** 地形大事:去掉第 i 件(下标越界 = 不动;一件不剩就去掉这一项) */
export function removeUpheaval(i: number) {
  const list = state.upheavals ?? [];
  if (!(i >= 0 && i < list.length)) return;
  const next: WorldEdits = { ...state, upheavals: list.filter((_, j) => j !== i) };
  if (!next.upheavals!.length) delete next.upheavals;
  commitEdits(next);
}

/**
 * 地形修改(阶段 4):加一处(清理过的;不合格的、已满 TERRAIN_MAX_OPS 处的不加)。返回是否加上了。
 * App 看到地形修改变了就在后台带着新的地形重新生成世界、重推文明
 */
export function addTerrainOp(op: TerrainOp): boolean {
  const c = cleanTerrainOp(op);
  if (!c || state.terrain.length >= TERRAIN_MAX_OPS) return false;
  return put({ ...state, terrain: [...state.terrain, c] });
}

/** 地名风格(新建世界时配,不记撤销步):每种语感几份;undefined / 一份都没有 = 自动,去掉这一项 */
export function setNameMix(mix: NameMix | undefined) {
  const next = cleanMix(mix);
  if (sameMix(next, state.nameMix)) return;
  const { nameMix: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, nameMix: next } : rest);
}

/**
 * 推演年数(新建世界时定,不记撤销步):推到第几年;undefined = 开关关着,去掉这一项。
 * 开着拖到 3000 年记成 3000(开关还开着;推演、存档都和没开一样,存档里不写)。
 * 带小数的(年中停下存回的普通世界再推 N 年、撤销再推)推到那一年的那一格:拆成整数年和年内第几格(edits.ts 的 endFields)
 */
export function setEndYear(year: number | undefined) {
  const next = year === undefined || !Number.isFinite(year) ? undefined : endFields(year);
  if (next?.endYear === state.endYear && next?.endTick === state.endTick) return;
  const { endYear: _old, endTick: _tick, ...rest } = state;
  void _old;
  void _tick;
  put(next ? { ...rest, ...next } : rest);
}

/** 拓荒(新建世界时定,不记撤销步):民族扩散、国家扩张、地形难走程度;undefined / 都是默认 = 去掉这一项 */
export function setFrontier(f: Frontier | undefined) {
  const next = cleanFrontier(f);
  if (sameFrontier(next, state.frontier)) return;
  const { frontier: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, frontier: next } : rest);
}

/** 「天灾」(新建世界时定,不记撤销步):多 / 很多;undefined = 平常,去掉这一项 */
export function setCalamity(c: Calamity | undefined) {
  const next = cleanCalamity(c);
  if (next === state.calamity) return;
  const { calamity: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, calamity: next } : rest);
}

/**
 * 这个世界用的一套规则(新建世界时定,不记撤销步;整套存进世界,盖上现在的换算版本,gen/civ/ruleSet.ts);undefined / 和官方一样 = 官方规则,去掉这一项
 */
export function setRules(r: RuleSet | undefined) {
  const next = newWorldRules(r);
  if (sameRuleSet(next, state.rules, true)) return;
  const { rules: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, rules: next } : rest);
}

/** 自己选的文明起源(新建世界时定,不记撤销步);undefined / 一处也没有 = 自动,去掉这一项 */
export function setOrigins(o: Origins | undefined) {
  const next = cleanOrigins(o);
  if (sameOrigins(next, state.origins)) return;
  const { origins: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, origins: next } : rest);
}

/** 文明种子(新建世界、打造文明时定,不记撤销步);undefined = 跟着地图种子,去掉这一项 */
export function setCivSeed(seed: number | undefined) {
  const next = cleanCivSeed(seed);
  if (next === state.civSeed) return;
  const { civSeed: _old, ...rest } = state;
  void _old;
  put(next !== undefined ? { ...rest, civSeed: next } : rest);
}

/** 复制出去的文字抬头写的种子(civSeed = 推演用的种子,即 civ.seed):有自己的文明种子写"文明种子 N",没有的就是地图种子"种子 N" */
export function seedTag(civSeed: number): string {
  return cleanCivSeed(state.civSeed) !== undefined ? `文明种子 ${civSeed}` : `种子 ${civSeed}`;
}

/** 新开的历史第一次推完:补上用的那张地图的校验(只是记录,不记撤销步、不算改历史);不是新开的、已经有了的不动 */
export function setMapSum(sum: string) {
  const map = state.map;
  if (!map || map.sum) return;
  put({ ...state, map: { ...map, sum } }, false);
}

/**
 * 推进设置(逐年推演怎么往下走;随时能改,不记撤销步、不改历史):整个交进来,清理过再放进修改(全是默认 = 去掉这一项)。
 * 格式见 gen/edits.ts 文件头"推进设置"
 */
export function setAdvance(a: Partial<Advance> | AdvanceSettings | undefined) {
  const next = cleanAdvance(a);
  if (sameAdvance(next, state.advance)) return;
  const { advance: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, advance: next } : rest, false);
}

/**
 * 导播跟着谁(随时能改,不记撤销步、不改历史):null = 全世界的大事。不合格的(种类不对、键不是对应种类的)当 null。
 * 格式见 gen/edits.ts 文件头"导播跟着谁"
 */
export function setFollow(f: FollowRef | null) {
  const next = f ? cleanFollow(f) : undefined;
  if (sameFollow(next, state.follow)) return;
  const { follow: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, follow: { kind: next.kind, key: next.key } } : rest, false);
}

/**
 * 逐年推演走完一步:进度换成 play(推到哪年 + 一路下过的命令)。不记撤销步(进度只往前走);
 * App 记着这份历史就是按它推的,不会因为进度变了再重推一遍
 */
export function putPlay(play: PlayState) {
  if (state.play === play) return;
  put({ ...state, play }, false);
}

/**
 * 整个换成 next,不记撤销步、不清撤销记录、不问改历史的那一声(新建的世界选了「演绎」:创建以后换成从第 0 年起逐年推演)
 */
export function putEditsQuiet(next: WorldEdits) {
  put(next, false);
}

/** 纪年(随时能改,不记撤销步):undefined = 按第几年写,去掉这一项。不合格的(名字空、太长,元年超范围)不改 */
export function setEra(era: Era | undefined) {
  const next = era === undefined ? undefined : cleanEra(era);
  if (era !== undefined && !next) return;
  if (sameEra(next, state.era)) return;
  const { era: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, era: next } : rest);
}

const getEra = () => state.era;

/** 当前世界的纪年(没设 = undefined:按第几年写);只在纪年变了时重新渲染 */
export function useEra(): Era | undefined {
  return subs.use(getEra);
}

/** 不经过 React 订阅时读纪年 */
export function currentEra(): Era | undefined {
  return state.era;
}

/** 一年几个月(随时能改,不记撤销步):0 = 只写年;12 = 默认,去掉这一项。不合格的不改 */
export function setMonths(n: number) {
  const next = cleanMonths(n);
  if (next === undefined && n !== 12) return;
  if (next === cleanMonths(state.months)) return;
  const { months: _old, ...rest } = state;
  void _old;
  put(next !== undefined ? { ...rest, months: next } : rest);
}

const getMonths = () => monthsOf(state.months);

/** 当前世界一年几个月(0 = 只写年);只在它变了时重新渲染 */
export function useMonths(): number {
  return subs.use(getMonths);
}

/** 不经过 React 订阅时读一年几个月 */
export function currentMonths(): number {
  return monthsOf(state.months);
}

/** 月份的名字(随时能改,不记撤销步):undefined / 一个名字都没有 = 去掉这一项(都写数字)。换回「数字」传 off: true,名字留着 */
export function setMonthNames(mn: MonthNames | undefined) {
  const next = cleanMonthNames(mn);
  if (sameMonthNames(next, state.monthNames)) return;
  const { monthNames: _old, ...rest } = state;
  void _old;
  put(next ? { ...rest, monthNames: next } : rest);
}

const getMonthNameSet = () => state.monthNames;

/** 记着的月份名字(世界设定里填的那一份,换回了「数字」的也在);只在它变了时重新渲染 */
export function useMonthNameSet(): MonthNames | undefined {
  return subs.use(getMonthNameSet);
}

const getMonthNames = () => monthNamesInUse(state.monthNames);

/** 现在写出来用的月份名字(第 i 个 = 第 i + 1 月;'' / 没有 = 写数字);没起名、选了「数字」= undefined */
export function useMonthNames(): readonly string[] | undefined {
  return subs.use(getMonthNames);
}

/** 不经过 React 订阅时读现在用的月份名字 */
export function currentMonthNames(): readonly string[] | undefined {
  return monthNamesInUse(state.monthNames);
}

/** 地形修改:撤销最后一处 */
export function undoTerrainOp(): boolean {
  if (!state.terrain.length) return false;
  return put({ ...state, terrain: state.terrain.slice(0, -1) });
}

/** 地形修改:全部清除(地形回到种子原本的样子) */
export function clearTerrain() {
  if (!state.terrain.length) return;
  put({ ...state, terrain: EMPTY_EDITS.terrain });
}

// ---- 草图(新建世界时「编辑地形」涂的;格式见 gen/edits.ts 文件头"地形草图") ----

/** 把草图换成 next(清理过;一笔没有、没涂的又交给程序 = 去掉这个字段)。App 看到草图变了就在后台照新的草图重新生成 */
export function putSketch(next: SketchEdit | null): boolean {
  const c = next ? cleanSketch(next) : null;
  const { sketch: _, ...rest } = state;
  void _;
  return put(c ? { ...rest, sketch: c } : rest);
}

/** 新开一张草图:没涂的地方 rest,海岸线 coast、程序补全 fill(不给 = 默认) */
function freshSketch(rest: SketchEdit['rest'], coast?: number, fill?: SketchFill | 'free'): SketchEdit {
  return { rest, ...(coast === undefined ? {} : { coast }), ...(fill && fill !== 'free' ? { fill } : {}), strokes: [] };
}

/**
 * 草图:加一笔(清理过的;不合格的、已满 SKETCH_MAX_STROKES 笔的不加)。还没有草图时新开一张,海岸线用 coast、程序补全用 fill(不给 = 默认)。
 * 返回是否加上了
 */
export function addSketchStroke(stroke: SketchStroke, coast?: number, fill?: SketchFill | 'free'): boolean {
  const c = cleanSketchStroke(stroke);
  const now = state.sketch;
  if (!c || (now?.strokes.length ?? 0) >= SKETCH_MAX_STROKES) return false;
  const base: SketchEdit = now ?? freshSketch('auto', coast, fill);
  return putSketch({ ...base, strokes: [...base.strokes, c] });
}

/**
 * 草图:加擦掉的一笔,地形修改同时换成 terrain(擦掉碰到的火山、湖、河去掉以后的;一次换上,只重新生成一遍)。
 * 加不上(不合格、已满)时什么都不动,返回 false
 */
export function addEraseStroke(stroke: SketchStroke, terrain: readonly TerrainOp[], coast?: number, fill?: SketchFill | 'free'): boolean {
  const c = cleanSketchStroke(stroke);
  const now = state.sketch;
  if (!c || (now?.strokes.length ?? 0) >= SKETCH_MAX_STROKES) return false;
  const base: SketchEdit = now ?? freshSketch('auto', coast, fill);
  const sk = cleanSketch({ ...base, strokes: [...base.strokes, c] });
  const { sketch: _, ...rest } = state;
  void _;
  put(sk ? { ...rest, terrain: [...terrain], sketch: sk } : { ...rest, terrain: [...terrain] });
  return true;
}

/** 撤销擦掉的一笔:草图去掉最后一笔,地形修改换回 terrain(擦掉之前的) */
export function undoEraseStroke(terrain: readonly TerrainOp[]) {
  const now = state.sketch;
  const sk = now?.strokes.length ? cleanSketch({ ...now, strokes: now.strokes.slice(0, -1) }) : now;
  const { sketch: _, ...rest } = state;
  void _;
  put(sk ? { ...rest, terrain: [...terrain], sketch: sk } : { ...rest, terrain: [...terrain] });
}

/** 草图:撤销最后一笔 */
export function undoSketchStroke(): boolean {
  const now = state.sketch;
  if (!now?.strokes.length) return false;
  return putSketch({ ...now, strokes: now.strokes.slice(0, -1) });
}

/**
 * 草图:照手绘图生成时,导入的图认出来的格子图(LAYER_W × LAYER_H)是整颗星球的底子 —— 铺在所有笔画底下,没盖到的地方都是海;
 * 已经有的换掉(「换一张」),笔画留着。还没有草图时新开一张,海岸线、程序补全用 coast、fill(不给 = 默认)。一格也没盖到的不导入;返回是否导入了
 */
export function setSketchBase(name: string, layer: Uint8Array, coast?: number, fill?: SketchFill | 'free'): boolean {
  const now = state.sketch;
  const image = cleanSketchImage({ name, cells: encodeLayer(layer) }, now?.strokes.length ?? 0);
  if (!image) return false;
  const base: SketchEdit = now ?? freshSketch('sea', coast, fill);
  return putSketch({ ...base, rest: 'sea', image });
}

/** 草图:清掉所有笔画(导入的图、海岸线、没涂的地方留着) */
export function clearSketchStrokes() {
  const now = state.sketch;
  if (now?.strokes.length) putSketch({ ...now, strokes: [] });
}

/** 草图:全部清除(连同"没涂的地方都是海",回到程序原本的星球) */
export function clearSketch() {
  if (state.sketch) putSketch(null);
}

/** 地形和草图一起清掉,算一次修改(只问一次、要么都清要么都不清);keepImage:草图只清笔画(连同板块的改动),导入的图、海岸线留着。返回是否清了 */
export function clearTerrainAndSketch(keepImage: boolean): boolean {
  const { sketch: now, ...rest } = state;
  const keep = !!(keepImage && now?.image);
  if (!rest.terrain.length && (!now || (keep && !now.strokes.length && !now.plates))) return true;
  // 板块的改动也算笔画,一起清掉
  const { plates: _, ...img } = now ?? { rest: 'auto', strokes: [] };
  void _;
  const sketch = now && keep ? cleanSketch({ ...img, strokes: [] }) : null;
  return put({ ...rest, terrain: EMPTY_EDITS.terrain, ...(sketch ? { sketch } : {}) });
}

/** 草图:没涂的地方交给程序('auto')、不长新陆地('noNewLand')还是都是海('sea')。还没有草图时新开一张,海岸线、程序补全用 coast、fill */
export function setSketchRest(rest: SketchEdit['rest'], coast?: number, fill?: SketchFill | 'free') {
  const now = state.sketch;
  if ((now?.rest ?? 'auto') === rest) return;
  putSketch({ ...(now ?? freshSketch(rest, coast, fill)), rest });
}

/** 草图:程序补全随意发挥('free')、只补细节('detail')还是完全照画('exact');还没有草图时不动(画第一笔时带上) */
export function setSketchFill(fill: SketchFill | 'free') {
  const now = state.sketch;
  if (!now || sketchFill(now) === fill) return;
  const { fill: _, ...rest } = now;
  void _;
  putSketch(fill === 'free' ? rest : { ...rest, fill });
}

/** 草图:海岸线贴着画(0)、适中(SKETCH_COAST)还是曲折(1) */
export function setSketchCoast(coast: number) {
  const now = state.sketch;
  if (sketchCoast(now) === coast) return;
  putSketch({ ...(now ?? { rest: 'auto', strokes: [] }), coast });
}

/**
 * 草图:加一处板块的改动(编辑地形「板块」页;清理过的,不合格的、已满 PLATE_MAX_OPS 处的不加)。
 * 还没有草图时新开一张(海岸线、程序补全用 coast、fill)。返回是否加上了
 */
export function addPlateOp(op: PlateOp, coast?: number, fill?: SketchFill | 'free'): boolean {
  const c = cleanPlateOp(op);
  const now = state.sketch;
  const ops = now?.plates?.ops ?? [];
  if (!c || ops.length >= PLATE_MAX_OPS) return false;
  const base: SketchEdit = now ?? freshSketch('auto', coast, fill);
  return putSketch({ ...base, plates: { ...base.plates, ops: [...ops, c] } });
}

/** 草图:撤销最后一处板块的改动 */
export function undoPlateOp(): boolean {
  const now = state.sketch;
  if (!now?.plates?.ops.length) return false;
  return putSketch({ ...now, plates: { ...now.plates, ops: now.plates.ops.slice(0, -1) } });
}

/** 草图:板块相撞时造不造山(还没有草图时新开一张,海岸线、程序补全用 coast、fill) */
export function setPlateOrogeny(on: boolean, coast?: number, fill?: SketchFill | 'free') {
  const now = state.sketch;
  if ((now?.plates?.orogeny !== false) === on) return;
  const base: SketchEdit = now ?? freshSketch('auto', coast, fill);
  const { orogeny: _, ...pl } = base.plates ?? { ops: [] };
  void _;
  putSketch({ ...base, plates: on ? pl : { ...pl, orogeny: false } });
}

/**
 * 草图:照一张图分板块(null = 去掉)。换了分法,之前的板块改动(指的是原来的板块)一起清掉,造山开关留着。
 * 还没有草图时新开一张(海岸线、程序补全用 coast、fill)。返回清掉了几处改动;没换成(格子不合格)= -1
 */
export function setPlateImage(img: PlateImage | null, coast?: number, fill?: SketchFill | 'free'): number {
  const now = state.sketch;
  const c = img ? cleanPlateImage(img) : null;
  if (img && !c) return -1;
  if (!c && !now?.plates?.image) return 0;
  const dropped = now?.plates?.ops.length ?? 0;
  const base: SketchEdit = now ?? freshSketch('auto', coast, fill);
  const off = base.plates?.orogeny === false;
  return putSketch({ ...base, plates: { ops: [], ...(c ? { image: c } : {}), ...(off ? { orogeny: false as const } : {}) } }) ? dropped : -1;
}

// ---- 作者标记 ----

/** 把标记换成 list(空 = 去掉这个字段),记一步 */
function commitMarks(list: AuthorMark[]) {
  const { marks: _, ...rest } = state;
  commitEdits(list.length ? { ...rest, marks: list } : rest);
}

/** 加上(换上)这个标记后,所有标记圈的州加起来超过 MARK_REGIONS_TOTAL */
function regionsOver(m: AuthorMark): boolean {
  return !!m.regions && markRegionTotal(state.marks, m.id) + m.regions.length > MARK_REGIONS_TOTAL;
}

/** 加一个标记(清理过的;编号按现有最大的 + 1 重新给)。返回新标记的编号;不合格、已经有 MARKS_MAX 个、圈的州一共超过 MARK_REGIONS_TOTAL = −1 */
export function addMark(m: Omit<AuthorMark, 'id'>): number {
  if ((state.marks?.length ?? 0) >= MARKS_MAX) return -1;
  const id = nextMarkId(state.marks);
  const c = cleanMark({ ...m, id });
  if (!c || regionsOver(c)) return -1;
  commitMarks([...(state.marks ?? []), c]);
  return id;
}

/** 改一个标记(整个换成 m,编号不变;找不到、不合格、没变、圈的州一共超过 MARK_REGIONS_TOTAL = 不动)。返回改没改 */
export function updateMark(m: AuthorMark): boolean {
  const list = state.marks ?? [];
  const i = list.findIndex((x) => x.id === m.id);
  const c = cleanMark(m);
  if (i < 0 || !c || sameMark(c, list[i]) || regionsOver(c)) return false;
  commitMarks(list.map((x, j) => (j === i ? c : x)));
  return true;
}

/** 删一个标记(找不到 = 不动)。返回删掉的那个 */
export function removeMark(id: number): AuthorMark | null {
  const list = state.marks ?? [];
  const m = list.find((x) => x.id === id);
  if (!m) return null;
  commitMarks(list.filter((x) => x !== m));
  return m;
}

/** 把删掉的标记放回去(删除提示条上的"撤销"):编号已经被占了 = 换一个新编号;at = 放回列表里的位置。返回编号,放不回去 = −1 */
export function restoreMark(m: AuthorMark, at: number): number {
  const list = state.marks ?? [];
  // 已经放回来了(比如先按了 Ctrl+Z):不再放一份
  const same = list.find((x) => x.id === m.id);
  if (same && sameMark(same, m)) return m.id;
  if (list.length >= MARKS_MAX) return -1;
  const id = same ? nextMarkId(list) : m.id;
  const c = cleanMark({ ...m, id });
  if (!c || regionsOver(c)) return -1;
  const next = list.slice();
  next.splice(Math.min(Math.max(0, at), next.length), 0, c);
  commitMarks(next);
  return id;
}

// ---- 作者的人物 ----

/** 这次打开以后删掉过的人物编号:新人物不用(放回去时还能用原编号,撤销、亲友都对得上) */
const retiredCharacterIds = new Set<number>();

/** 把人物换成 list(空 = 去掉这个字段),记一步;ivs = 干预列表一起换(改 / 删人物时他的即位跟着改,只记一步、只重推一次)。返回改没改 */
function commitCharacters(list: AuthorCharacter[], ivs?: Intervention[]): boolean {
  const { characters: _, ...rest } = state;
  const next = ivs ? { ...rest, interventions: ivs } : rest;
  return commitEdits(list.length ? { ...next, characters: list } : next);
}

/** 加一个人物(清理过的;编号按用过的最大的 + 1 重新给,见 nextCharacterId)。返回新人物的编号;不合格、已经有 CHARACTERS_MAX 个 = −1 */
export function addCharacter(c: Omit<AuthorCharacter, 'id'>): number {
  if ((state.characters?.length ?? 0) >= CHARACTERS_MAX) return -1;
  const id = nextCharacterId(state.characters, retiredCharacterIds);
  const x = cleanCharacter({ ...c, id });
  if (!x) return -1;
  commitCharacters([...(state.characters ?? []), x]);
  return id;
}

/**
 * 改一个人物(整个换成 c,编号不变;找不到、不合格、没变 = 不动)。返回改没改。
 * ivs = 干预列表一起换成这个(他的即位跟着改:crownInfo.ts 的 crownEditAsk);改历史被拦下 = 都不改
 */
export function updateCharacter(c: AuthorCharacter, ivs?: Intervention[]): boolean {
  const list = state.characters ?? [];
  const i = list.findIndex((x) => x.id === c.id);
  const x = cleanCharacter(c);
  if (i < 0 || !x || (!ivs && sameCharacter(x, list[i]))) return false;
  return commitCharacters(
    list.map((y, j) => (j === i ? x : y)),
    ivs,
  );
}

/** 删一个人物(找不到 = 不动;别的人物亲友里的他留着,界面上不列)。返回删掉的那个;ivs = 干预列表一起换(连他的即位一起去掉) */
export function removeCharacter(id: number, ivs?: Intervention[]): AuthorCharacter | null {
  const list = state.characters ?? [];
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  if (!commitCharacters(
    list.filter((x) => x !== c),
    ivs,
  ))
    return null;
  retiredCharacterIds.add(c.id);
  return c;
}

/**
 * 把删掉的人物放回去(删除提示条上的"撤销"):编号已经被占了 = 换一个新编号;at = 放回列表里的位置。返回编号,放不回去 = −1。
 * ivs = 干预列表一起换(连即位一起去掉的,即位放回去)
 */
export function restoreCharacter(c: AuthorCharacter, at: number, ivs?: Intervention[]): number {
  const list = state.characters ?? [];
  const same = list.find((x) => x.id === c.id);
  if (same && sameCharacter(same, c)) return !ivs || commitCharacters(list, ivs) ? c.id : -1;
  if (list.length >= CHARACTERS_MAX) return -1;
  const id = same ? nextCharacterId(list, retiredCharacterIds) : c.id;
  const x = cleanCharacter({ ...c, id });
  if (!x) return -1;
  const next = list.slice();
  next.splice(Math.min(Math.max(0, at), next.length), 0, x);
  // 换了新编号:即位里记的是原来的编号,对不上了,不放回去
  return commitCharacters(next, id === c.id ? ivs : undefined) ? id : -1;
}

// ---- 大纲(格式见 gen/edits.ts 文件头"大纲") ----

/**
 * 大纲换成 plots(清理过;一条不剩 = 去掉这一项;超过 OUTLINE_PLOTS_MAX 条不收),记一步。上一次照大纲推演的批改跟着去掉(改了大纲,批改对不上了;
 * 硬改出来的干预留着,下次照大纲推演时重新算)。ivs = 干预列表一起换(删一条情节时连它硬改出来的那几条一起去掉)。
 * 改历史被拦下 = false
 */
export function setOutlinePlots(plots: readonly Plot[], ivs?: Intervention[]): boolean {
  // 满了还加(加一条、复制):不收,说一声(不然读进来时的清理会悄悄丢掉最后一条)
  if (plots.length > OUTLINE_PLOTS_MAX) {
    showToast({ id: 'outline-max', kind: 'warn', text: `大纲最多 ${OUTLINE_PLOTS_MAX} 条`, more: ['删掉几条再加'] });
    return false;
  }
  const { outline: _old, ...rest } = state;
  void _old;
  const o = cleanOutline({ plots });
  const next: WorldEdits = ivs ? { ...rest, interventions: ivs } : rest;
  return commitEdits(o ? { ...next, outline: { plots: o.plots } } : next);
}

/**
 * 照大纲推演好了:干预列表(作者的 + 硬改出来的)、批改一起换,记一步(⌘Z 回到推之前)。
 * plots = 推的时候那一份大纲(推的时候大纲没改过才会走到这里)
 */
export function putOutlineResult(plots: readonly Plot[], review: readonly PlotReview[], ivs: Intervention[]): boolean {
  const o: Outline | undefined = cleanOutline({ plots, review });
  if (!o) return false;
  return commitEdits({ ...state, interventions: ivs, outline: o });
}

/** 换了新世界:修改一律作废 */
export function clearEdits() {
  retiredCharacterIds.clear();
  setEdits(EMPTY_EDITS);
}
