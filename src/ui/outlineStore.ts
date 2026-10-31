/**
 * 大纲(格式见 gen/edits.ts 文件头"大纲";照大纲推演见 gen/outline.ts)的界面状态。
 * 大纲本身记在修改里(editsStore 的 setOutlinePlots / putOutlineResult);这里只管界面:
 *
 * - run:正在照大纲推演的这一次(第几次、查完几条、到现在的批改、正在查哪一条 / 在试第几版引法 / 在第几年硬改)。App 接后台线程(setOutlineRunner),
 *   界面调 askOutline(先问多认真地试)→ startOutline / stopOutline。
 * - ask:「照大纲推演」先弹的那一下(多认真地试:快 / 标准 / 细 / 自己填);选的那档记在浏览器里,下次默认选它。
 * - edit:正在编的那一条(概览「大纲」页右边滑出的一栏;手机整页)。草稿放在这里,不放在组件里:在地图上点、圈州时概览先收起,回来接着编。
 * - filter:大纲页上方按结果筛(全部 / 照着发生了 / 硬改的 / 做不到 / 只讲故事)。
 * - focus:从大纲点过来看的那一条(情节编号)和点过来时选中的东西:选中的还是它,卡片顶上一条「‹ 大纲 第 N 条」、地图上一块小牌子、
 *   时间轴上那一条的记号放大写号;换选了别的、取消选中就不看了。
 * 不碰 DOM,单测直接测。
 */
import { createListeners } from './createStore';
import { OUTLINE_TRIES_MAX, PLOT_ID_MAX, type Plot, type PlotKind, type PlotRedo, type PlotReview, type PlotStatus } from '../gen/edits';
import { onEditsReset } from './editsStore';
import type { MapSelection } from './civView';

/** 正在照大纲推演的这一次 */
export interface OutlineRun {
  /** 第几次照大纲推演(后台线程只认最新的) */
  oid: number;
  /** 查完了几条、一共几条 */
  done: number;
  total: number;
  /** 到现在的批改(按查的先后) */
  review: readonly PlotReview[];
  /** 正在查的那一条(情节编号;还没开始查 = null)、它没自然发生时在第几年硬改(还在查 = null) */
  at: number | null;
  fix: number | null;
  /** 正在那一条试第几版引法、最多几版(没在试 = null) */
  trial: { n: number; of: number } | null;
}

/** 正在编的那一条:草稿(新加的还没选种类时 kind 不给)、新加的放在第几个位置(改原有的 = −1) */
export interface OutlineEdit {
  draft: PlotDraft;
  /** 新加的:插在第几个位置(改原有的 = −1) */
  at: number;
}

/**
 * 编的时候的草稿:种类可以还没选;编的时候顺带记着的(去世那一条先选的国家)不进大纲。
 * was = 大纲搬过来以后对不上、要重新指的那几项原来叫什么(编的时候写在上面对照;那几项在草稿里空着,要填的不填不让存)
 */
export type PlotDraft = Omit<Plot, 'kind' | 'redo'> & { kind?: PlotKind; pickA?: string; was?: PlotRedo };

export type OutlineFilter = PlotStatus | 'all';

/** 从大纲点过来看的那一条:情节编号、点过来时选中的东西 */
export interface OutlineFocus {
  plot: number;
  sel: MapSelection;
}

export interface OutlineState {
  run: OutlineRun | null;
  /** 开着「照大纲推演」先问的那一下 */
  ask: boolean;
  edit: OutlineEdit | null;
  filter: OutlineFilter;
  focus: OutlineFocus | null;
}

let S: OutlineState = { run: null, ask: false, edit: null, filter: 'all', focus: null };
const subs = createListeners();
function patch(p: Partial<OutlineState>) {
  S = { ...S, ...p };
  subs.emit();
}
export function getOutlineUi(): OutlineState {
  return S;
}
export function subscribeOutlineUi(f: () => void): () => void {
  return subs.subscribe(f);
}
export function useOutlineUi(): OutlineState {
  return subs.use(getOutlineUi);
}

// ---------------------------------------------------------------------------
// 照大纲推演

/** App 接到后台线程上的开始(tries = 每条最多试几版引法)/ 叫停 */
export interface OutlineRunner {
  start: (tries: number) => void;
  stop: () => void;
}
let runner: OutlineRunner | null = null;
export function setOutlineRunner(r: OutlineRunner | null) {
  runner = r;
}
/** 照大纲推演(在推着的、逐年推演里、世界还没好:App 那边不理) */
export function startOutline(tries: number) {
  runner?.start(tries);
}
/** 叫停照大纲推演(世界还是推之前那样) */
export function stopOutline() {
  runner?.stop();
}

// ---------------------------------------------------------------------------
// 多认真地试

/** 多认真地试的几档:每条最多试几版引法;自己填 = own */
export const OUTLINE_TIERS = [
  { id: 'fast', name: '快', tries: 4 },
  { id: 'std', name: '标准', tries: 12 },
  { id: 'fine', name: '细', tries: 30 },
] as const;
export type OutlineTier = (typeof OUTLINE_TIERS)[number]['id'] | 'own';
/** 自己填:最少、最多几版,默认几版 */
export const OUTLINE_OWN_MIN = 1;
export const OUTLINE_OWN_DEFAULT = 20;
export { OUTLINE_TRIES_MAX as OUTLINE_OWN_MAX };

/** 上次选的哪一档、自己填的几版(记在浏览器里) */
export interface OutlineTries {
  tier: OutlineTier;
  own: number;
}
const TRIES_KEY = 'wenming-ditu:outline-tries';
const TIER_IDS: readonly OutlineTier[] = [...OUTLINE_TIERS.map((t) => t.id), 'own'];
/** 自己填的几版:取整,夹在 1…最多(空的、不是正数 = 默认几版) */
export const clampOwn = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(OUTLINE_TRIES_MAX, Math.max(OUTLINE_OWN_MIN, Math.round(n))) : OUTLINE_OWN_DEFAULT);
export function loadOutlineTries(): OutlineTries {
  try {
    const v = JSON.parse(localStorage.getItem(TRIES_KEY) ?? 'null') as Partial<OutlineTries> | null;
    if (v && typeof v === 'object') return { tier: TIER_IDS.includes(v.tier as OutlineTier) ? (v.tier as OutlineTier) : 'std', own: typeof v.own === 'number' ? clampOwn(v.own) : OUTLINE_OWN_DEFAULT };
  } catch {
    /* 存不了 / 坏了:用默认 */
  }
  return { tier: 'std', own: OUTLINE_OWN_DEFAULT };
}
export function saveOutlineTries(t: OutlineTries) {
  try {
    localStorage.setItem(TRIES_KEY, JSON.stringify(t));
  } catch {
    /* 隐私模式:只管这一次 */
  }
}
/** 这一档每条最多试几版 */
export const triesOf = (t: OutlineTries) => (t.tier === 'own' ? clampOwn(t.own) : OUTLINE_TIERS.find((x) => x.id === t.tier)!.tries);

/** 点「照大纲推演」:先问多认真地试(在推着就不问) */
export function askOutline() {
  if (!S.run && !S.ask) patch({ ask: true });
}
/** 不问了(取消、开始推演) */
export function closeOutlineAsk() {
  if (S.ask) patch({ ask: false });
}

/** App:开始 / 有了进度 / 推完或停下(null) */
export function setOutlineRun(run: OutlineRun | null) {
  patch({ run });
}

// ---------------------------------------------------------------------------
// 编一行

/** 开始编:新加一条(at = 插在第几个位置)或改原有的那一条(要重新指的几项挪进 was,存的时候不再带着) */
export function editPlot(draft: PlotDraft & { redo?: PlotRedo }, at = -1) {
  const { redo, ...rest } = draft;
  patch({ edit: { draft: redo ? { ...rest, was: redo } : rest, at } });
}
/** 改草稿里的几项(没在编 = 不动) */
export function patchDraft(p: Partial<PlotDraft>) {
  if (!S.edit) return;
  const draft = { ...S.edit.draft, ...p };
  for (const k of Object.keys(p) as (keyof PlotDraft)[]) if (p[k] === undefined) delete draft[k];
  patch({ edit: { ...S.edit, draft } });
}
/** 不编了(取消、好了以后) */
export function closeEdit() {
  if (S.edit) patch({ edit: null });
}

export function setOutlineFilter(filter: OutlineFilter) {
  if (S.filter !== filter) patch({ filter });
}

/** 从大纲点过来看的那一条(null = 不看了) */
export function setOutlineFocus(focus: OutlineFocus | null) {
  if (S.focus !== focus) patch({ focus });
}
/** 现在选中的还是点过来时选的那个 */
export const focusHolds = (f: OutlineFocus | null, sel: MapSelection | null): f is OutlineFocus => !!f && !!sel && f.sel.kind === sel.kind && f.sel.id === sel.id;

/** 新情节的编号:用过的最大的 + 1(满了从 1 起找空的) */
export function nextPlotId(plots: readonly Pick<Plot, 'id'>[]): number {
  let max = 0;
  for (const p of plots) max = Math.max(max, p.id);
  if (max < PLOT_ID_MAX) return max + 1;
  const used = new Set(plots.map((p) => p.id));
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

// ---------------------------------------------------------------------------
// 找更合的世界(大纲页右上;App 接:新建一个世界、打开照故事找世界那一页,大纲里的国家先列成故事里的国家)

let finder: (() => void) | null = null;
export function setOutlineFinder(f: (() => void) | null) {
  finder = f;
}
/** 点了「找更合的世界」 */
export function findForOutline() {
  finder?.();
}

/** 换了世界:界面状态都作废(推着的那一次 App 自己收) */
export function resetOutlineUi() {
  patch({ ask: false, edit: null, filter: 'all', focus: null });
}
onEditsReset(resetOutlineUi);
