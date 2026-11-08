/**
 * 开着的插件(同一时间一个):点开工具 = 开插件(顶层代码从头跑),关掉插件卡 = 停。
 * 插件交来的面板、请用的人点的、提的修改、出的问题都记在这里,插件卡和地图那边照着画。
 */
import { fullChronicle, fullChronicleCached } from '../../../gen/civ/story/religionText';
import { applyNames, type KeyKind, type WorldEdits } from '../../../gen/edits';
import { exportNotes } from '../../../ai/library';
import { cleanNoteList } from '../../../authorNotes';
import { PluginApiError } from '../../../plugin/check';
import { commitPluginEdits } from '../../../plugin/editsCommit';
import { planChanges } from '../../../plugin/edit';
import { startPluginHost, type PickAnswer, type PickRequest, type PluginHost, type PluginSource } from '../../../plugin/host';
import { PluginFileError } from '../../../plugin/pluginFile';
import { localDataStore } from '../../../plugin/pluginData';
import { loadPlugin, type InstalledPlugin } from '../../../plugin/pluginStore';
import { MESSAGES_PER_SECOND, MESSAGE_MAX_BYTES } from '../../../plugin/protocol';
import type { PluginDataStore } from '../../../plugin/store';
import type { PanelNode, ViewInfo } from '../../../plugin/types';
import { getCivShow, getCivTime, getSelection, subscribeCivTime, subscribeSelection } from '../../civView';
import { createStore } from '../../createStore';
import { commitEdits, editsEra, getEdits, historyDiffers, revertEdits } from '../../editsStore';
import { selectionKey } from '../../flyTo';
import { setPolityPick } from '../../Interventions';
import { fillOf } from '../../mapLayers';
import { stopPlacing } from '../../markStore';
import { getProjection } from '../../projectionStore';
import { noteRewrite } from '../../rewriteStore';
import { currentWorld } from '../../saveStore';
import { clearToast, showToast } from '../../toastStore';
import { toolCard, toolCellPick, toolRunning, type ToolsProps } from '../toolsState';
import { verdictOf } from '../verdict';
import { batchParts, keyName, refusalOf, sayBatch, sayBusy, sayDone, type Refusal } from './toolSay';

/** 停下的原因:slow 没反应(几秒);crashed 出错(site = 网站查到的,不是插件自己报的);blocked 网站停用了 */
export type ToolTrouble = { kind: 'slow'; secs: number } | { kind: 'crashed'; text: string; site?: boolean } | { kind: 'blocked'; why: string; day: string };

/** 插件请用的人在地图上点:一处 / 框一片 */
export interface ToolPick {
  kind: 'cell' | 'box';
  hint: string;
  /** 交给插件(null = 用的人不点了) */
  done: (a: PickAnswer | null) => void;
}

/** 框选的框(世界坐标:中心、宽高) */
export interface ToolBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface ToolRun {
  plugin: InstalledPlugin;
  phase: 'starting' | 'running' | 'stopped';
  panel: PanelNode[] | null;
  trouble: ToolTrouble | null;
  /** 刚提的修改没照办 */
  refusal: Refusal | null;
  pick: ToolPick | null;
  /** 上一次框的框:再请框选时还在,能挪、改大小 */
  box: ToolBox | null;
}

export const toolRun = createStore<ToolRun | null>(null);

toolRun.subscribe(() => {
  const r = toolRun.get();
  toolCard.set(!!r);
  toolRunning.set(!!r && r.phase !== 'stopped');
  const p = r?.pick;
  toolCellPick.set(p?.kind === 'cell' ? { done: (cell) => p.done({ cell }) } : null);
});

/** 隔多久问插件一声、多久没回算没反应 */
const PING_EVERY_MS = 2000;
export const SLOW_MS = 5000;
/** 插件代码顶层多久没跑完算没反应(沙箱的默认值) */
const START_MS = 10_000;

let seq = 0;
let host: PluginHost | null = null;

function patch(my: number, p: Partial<ToolRun>) {
  const r = toolRun.get();
  if (my === seq && r) toolRun.set({ ...r, ...p });
}

/** 存进世界要先问用的人、记进世界仓库,这一版还没接上:回插件「还不能」,不假装存好了 */
const noWorldStore: PluginDataStore = {
  get: () => {
    throw new PluginApiError('unavailable', '网站这一版还不能把插件的数据存进世界');
  },
  set: () => {
    throw new PluginApiError('unavailable', '网站这一版还不能把插件的数据存进世界');
  },
};

/** 停下来的原因换成卡片上的说法;我们自己叫停的 = null */
function troubleOf(reason: string, detail: string): ToolTrouble | null {
  if (reason === 'stopped') return null;
  if (reason === 'start-timeout') return { kind: 'slow', secs: START_MS / 1000 };
  if (reason === 'unresponsive') {
    const ms = Number(/(\d+) ms/.exec(detail)?.[1]);
    return { kind: 'slow', secs: Math.round((Number.isFinite(ms) && ms > 0 ? ms : SLOW_MS) / 1000) };
  }
  if (reason === 'crashed') return { kind: 'crashed', text: detail.replace(/^Uncaught /, '').replace(/^Error: /, '') || '没说是什么错' };
  if (reason === 'flood') return { kind: 'crashed', site: true, text: `它一秒里发给网站的话超过 ${MESSAGES_PER_SECOND} 条` };
  if (reason === 'oversize') return { kind: 'crashed', site: true, text: `它一次发给网站的东西超过约 ${Math.round(MESSAGE_MAX_BYTES / 1024 / 1024)} MB` };
  return { kind: 'crashed', site: true, text: '它发了网站不认得的话' };
}

/** 停掉开着的插件,卡片一起拿掉 */
export function stopTool(): void {
  seq++;
  const r = toolRun.get();
  host?.stop();
  host = null;
  r?.pick?.done(null);
  if (r) toolRun.set(null);
  clearToast('plugin-pick');
}

/** 当前年份(取整,夹在历史里) */
function yearNow(p: ToolsProps): number {
  const end = p.civ?.endYear ?? 0;
  return Math.floor(Math.min(end, Math.max(0, getCivTime().year ?? end)));
}

function viewOf(p: ToolsProps): ViewInfo {
  const sel = getSelection().sel;
  let visible: ViewInfo['visible'] = null;
  const f = getProjection() === 'equirect' ? p.api.current?.frame() : null;
  const a = f?.pt(0, 0);
  const b = f?.pt(1000, 1000);
  if (f && a && b && b[0] > a[0]) {
    const k = (b[0] - a[0]) / 1000;
    visible = { x0: -a[0] / k, y0: -a[1] / k, x1: (f.w - a[0]) / k, y1: (f.h - a[1]) / k };
  }
  const key = sel && p.raw ? selectionKey(p.raw, sel) : '';
  return { year: yearNow(p), selected: sel ? { kind: sel.kind, id: sel.id, ...(key ? { key } : {}) } : null, visible, layer: fillOf(getCivShow()) };
}

/** 开一个工具(先停掉开着的);env = 地图那边最新的一份 */
export async function startTool(plugin: InstalledPlugin, env: () => ToolsProps): Promise<void> {
  stopTool();
  const my = seq;
  const verdict = verdictOf(plugin.current.sum);
  const base: ToolRun = { plugin, phase: 'starting', panel: null, trouble: null, refusal: null, pick: null, box: null };
  if (verdict.blocked) {
    toolRun.set({ ...base, phase: 'stopped', trouble: { kind: 'blocked', ...verdict.blocked } });
    return;
  }
  toolRun.set(base);
  // 同一个插件这一次打开:改历史被拦下问过一次以后不再弹窗问
  const asked = { history: false };
  const live = () => my === seq;
  try {
    const opened = await loadPlugin(plugin.id);
    if (!live()) return;
    const name = opened.manifest.name;
    const source: PluginSource = {
      world: () => env().world,
      civ: () => env().civ,
      edits: getEdits,
      title: () => currentWorld()?.title ?? '',
      chronicle: () => {
        const c = env().civ;
        return c && fullChronicleCached(c) ? fullChronicle(c) : null;
      },
      notes: () => {
        const id = currentWorld()?.id;
        return id ? cleanNoteList(exportNotes(id)) : [];
      },
      view: () => viewOf(env()),
      watchView: (fn) => {
        const a = subscribeCivTime(() => fn());
        const b = subscribeSelection(fn);
        return () => {
          a();
          b();
        };
      },
      pick: (req, signal) => (live() ? askPick(my, req, signal) : Promise.resolve(null)),
      // 开到一半关掉了(插件顶层代码排着的调用开好以后才发出来):不再照它改
      commit: (next, keys) => (live() ? commitBatch(name, next, keys, asked, env) : '插件已经停了'),
    };
    const h = await startPluginHost({
      plugin: opened.manifest,
      code: opened.code,
      source,
      sink: {
        panel: (nodes) => patch(my, { panel: nodes }),
        layer: () => {},
        refused: (args, e) => {
          const p = env();
          const check = (c: unknown) => {
            try {
              planChanges(getEdits(), p.civ, { changes: [c] }, p.world.params);
              return null;
            } catch (x) {
              return x instanceof PluginApiError ? x.message : null;
            }
          };
          patch(my, { refusal: refusalOf(args, e.message, check) });
        },
      },
      stores: { local: localDataStore, world: noWorldStore },
      onStop: (reason, detail) => {
        const t = troubleOf(reason, detail);
        if (!live() || !t) return;
        toolRun.get()?.pick?.done(null);
        clearToast('plugin-pick');
        host = null;
        patch(my, { phase: 'stopped', trouble: t, panel: null, refusal: null, pick: null });
      },
    });
    if (!live()) return h.stop();
    host = h;
    patch(my, { phase: 'running' });
    void watch(my, h);
  } catch (e) {
    if (!live() || toolRun.get()?.phase === 'stopped') return;
    const text = e instanceof PluginFileError && e.kind === 'newer' ? '它要用到这一版网站还没有的东西' : e instanceof Error && e.name === 'PluginRefused' ? e.message : '没能打开它';
    patch(my, { phase: 'stopped', trouble: { kind: 'crashed', site: true, text } });
  }
}

/** 每隔一会儿问插件一声:SLOW_MS 内没回就停掉(沙箱自己停,停的原因是 unresponsive) */
async function watch(my: number, h: PluginHost) {
  while (my === seq && !h.sandbox.stopped) {
    await new Promise((r) => setTimeout(r, PING_EVERY_MS));
    if (my !== seq || h.sandbox.stopped) return;
    if (typeof document !== 'undefined' && document.hidden) continue;
    try {
      await h.sandbox.ping(SLOW_MS);
    } catch {
      return;
    }
  }
}

function askPick(my: number, req: PickRequest, signal: AbortSignal): Promise<PickAnswer | null> {
  if (req.kind === 'cells') return Promise.reject(new PluginApiError('unavailable', '网站这一版还不能一次点好几块,先用 pick.cell 或 pick.box'));
  // 请用的人点的时候,放标记、在地图上选目标先收起(抢同一下点击)
  stopPlacing();
  setPolityPick(null);
  return new Promise((resolve) => {
    let over = false;
    const pick: ToolPick = {
      kind: req.kind as 'cell' | 'box',
      hint: req.hint,
      done: (a) => {
        if (over) return;
        over = true;
        const r = toolRun.get();
        if (r?.pick === pick) patch(my, { pick: null });
        resolve(a);
      },
    };
    signal.addEventListener('abort', () => pick.done(null));
    patch(my, { pick });
  });
}

/** 正在请用的人点:不点了(退出、Esc、开始放标记……) */
export function cancelPick(): void {
  toolRun.get()?.pick?.done(null);
}

/** 框选:记下这次的框(下次再请框选时还在),交给插件 */
export function pickBox(box: ToolBox, answer: PickAnswer): void {
  const r = toolRun.get();
  if (!r?.pick || r.pick.kind !== 'box') return;
  toolRun.set({ ...r, box });
  r.pick.done(answer);
}

/** 用的人动了插件面板上的控件 */
export function panelAction(id: string, value?: unknown): void {
  host?.panelAction(id, value);
}

/** 没照办的那块:知道了 */
export function dismissRefusal(): void {
  const r = toolRun.get();
  if (r?.refusal) toolRun.set({ ...r, refusal: null });
}

/** 插件的一批修改照办:记一步撤销,顶上说改了什么;下了命令的等推完再说 */
function commitBatch(plugin: string, next: WorldEdits, keys: string[], asked: { history: boolean }, env: () => ToolsProps): string | null {
  const before = getEdits();
  const p = env();
  const year = yearNow(p);
  let after: typeof p.civ | undefined;
  const parts = batchParts(before, next, (key, when) => {
    let civ = p.civ;
    if (when === 'after') civ = after ??= p.raw ? applyNames(p.raw, next.names) : null;
    const r = civ ? keyName(civ, key, year) : '';
    const kind = /^(polity|dynasty|settlement|place|culture|region|faith|person|treaty|trade):/.exec(key)?.[1];
    return kind ? { kind: kind as KeyKind, name: r } : null;
  });
  const history = historyDiffers(before, next);
  const era = editsEra();
  const undo = () => undoBatch(plugin, before, next, era);
  if (history) noteRewrite({ kind: 'apply', turn: -1, before, after: next, edits: next, undo, say: { busy: sayBusy(plugin, parts), done: (from, failed) => sayDone(plugin, parts, from, failed) } });
  const why = commitPluginEdits(next, keys, asked);
  if (why) return why;
  if (!history) showToast({ id: 'resim-done', kind: 'ok', ...sayBatch(plugin, parts), action: { label: '撤销', act: 'plugin-undo', onClick: undo }, ttl: 7000 });
  return null;
}

/** 撤销插件的一批(之后又改过别的,只撤这一批碰过的);换了世界、读过档的不撤(era = 照办那一刻的) */
function undoBatch(plugin: string, before: WorldEdits, after: WorldEdits, era: number) {
  if (editsEra() !== era) return clearToast('resim-done');
  const now = getEdits();
  const back = revertEdits(now, after, before);
  if (back === now) return clearToast('resim-done');
  const history = historyDiffers(now, back);
  const text = `已撤销插件「${plugin}」的修改`;
  if (history) noteRewrite({ kind: 'undo', turn: -1, before, after, edits: back, say: { done: (from) => ({ text: `${text}，从${from}起重新推演` }) } });
  if (!commitEdits(back)) return;
  if (history) clearToast('resim-done');
  else showToast({ id: 'resim-done', kind: 'ok', text, ttl: 4000 });
}
