/**
 * 开发者模式:开关(记在这个浏览器里)、载入正在写的插件、重新载入、日志。
 * 载入的插件不进插件仓库,只在这个页面里跑;它存的数据(store.local、store.world)只放在内存里,刷新网页就没了。
 * 载入的是推演插件:不开起来,能「试推」(后台在这个世界上从第 0 年推几百年,不改世界,见 plugin/devTry.ts)。
 */
import { exportNotes } from '../../ai/library';
import { cleanNoteList } from '../../authorNotes';
import { buildChronicle } from '../../gen/civ/story/chronicle';
import { commitPluginEdits } from '../../plugin/editsCommit';
import { PluginRefused, startPluginHost, type PluginHost, type PluginSource } from '../../plugin/host';
import { PLUGIN_FILE_EXT, openPluginFile, type OpenedPlugin, type PluginManifest } from '../../plugin/pluginFile';
import { worldPluginOf } from '../../plugin/pluginWorld';
import { memoryStore, type PluginDataStore } from '../../plugin/store';
import { createStore } from '../createStore';
import { getEdits } from '../editsStore';
import { currentWorld } from '../saveStore';
import { devCardOn, devTryRunner, pluginWorld } from './devSlot';
import { setLiveLayer } from './layerState';
import { viewOf, watchView } from './pluginView';
import { addedLines, devStopText, isSim, isTool, type DevLevel, type DevLog } from './pluginText';
import type { DevTryResult } from '../../plugin/devTry';
import type { SimPluginFile } from '../../plugin/pluginWorld';
import { getSimNow } from '../world/simNow';
import type { DevTool } from './tools/toolRun';
import { verdictOf } from './verdict';

const KEY = 'civ-atlas:plugin-dev';
/** 日志最多留几条,多了丢最早的 */
const LOGS_MAX = 500;
/** 插件跑起来以后多久问一声还在不在,也是等它回话的时限 */
const PING_MS = 5000;

function readMode(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

const mode = createStore(readMode());
export const useDevMode = (): boolean => mode.use();

export function setDevMode(on: boolean): void {
  mode.set(on);
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // 存不下就只管这一次
  }
  if (!on) closeDev();
}

export interface DevPlugin {
  file: string;
  /** 读出来的清单;文件坏了、还没读出来 = null */
  manifest: PluginManifest | null;
  /** 最近一次载入:哪一刻、是不是重新载入、开起来用了多久(没开起来 = null);还没载入完 = null */
  load: { at: number; again: boolean; ms: number | null } | null;
  busy: boolean;
  /** 照记的先后 */
  logs: DevLog[];
  /** 记着文件,重新载入直接再读(Chrome、Edge);false = 要再选一次 */
  reread: boolean;
  /** 载入的是推演插件:试推(不是 = null) */
  sim: DevSim | null;
}

/** 试推几年;推到一半存下再接着推 */
export const DEV_TRY_YEARS = 300;

export interface DevTried {
  at: number;
  file: string;
  /** 带的插件(按出手的先后):编号 → 名字;dev = 载入的这个 */
  plugins: { id: string; name: string; dev: boolean }[];
  /** 世界用的推演插件本机对不上,只带了载入的这个 */
  alone: boolean;
  result: DevTryResult | null;
  /** 网站这头没推成(线程出错、世界换了) */
  error?: string;
}

export interface DevSim {
  /** 正在试推:推到哪了(0–1);没在推 = null */
  pct: number | null;
  last: DevTried | null;
}

const state = createStore<DevPlugin | null>(null);
export const useDevPlugin = (): DevPlugin | null => state.use();

export interface DevAsk {
  opened: OpenedPlugin;
  file: string;
  answer: (ok: boolean) => void;
}
const asking = createStore<DevAsk | null>(null);
export const useDevAsk = (): DevAsk | null => asking.use();

interface FileHandle {
  getFile(): Promise<File>;
}
type OpenPicker = (o: object) => Promise<FileHandle[]>;

let host: PluginHost | null = null;
/** 载入的推演插件(试推带它) */
let simFile: SimPluginFile | null = null;
/** 第几次试推:停下、关掉、重新载入时加一,之前那次交回来不要 */
let tries = 0;
let pinger: ReturnType<typeof setInterval> | null = null;
let handle: FileHandle | null = null;
/** 用的人最近一次同意的清单:重新载入时要的东西没多就不再问 */
let granted: PluginManifest | null = null;
let run = 0;
/** 关掉一次加一:关掉以前没载入完的那次作废 */
let epoch = 0;

let queued: DevLog[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const add = queued;
  queued = [];
  state.update((s) => s && { ...s, logs: [...s.logs, ...add].slice(-LOGS_MAX) });
}

/** 插件一下打很多条时攒一攒再画 */
function log(r: number, level: DevLevel, text: string) {
  queued.push({ at: Date.now(), level, text, run: r });
  flushTimer ??= setTimeout(flush, 50);
}

export function clearDevLogs(): void {
  queued = [];
  state.update((s) => {
    if (!s) return s;
    const last = s.sim?.last;
    return { ...s, logs: [], ...(s.sim && last?.result ? { sim: { ...s.sim, last: { ...last, result: { ...last.result, logs: [] } } } } : {}) };
  });
}

function stopHost() {
  const h = host;
  host = null;
  if (pinger) clearInterval(pinger);
  pinger = null;
  h?.stop();
}

/** 插件存进世界的数据跟着打开的那个世界(看的年份跨过地形大变时地图换了一份,还是同一个世界) */
const worldStores = new Map<string, PluginDataStore>();
const worldStore = (): PluginDataStore => {
  const id = currentWorld()?.id ?? '';
  let st = worldStores.get(id);
  if (!st) worldStores.set(id, (st = memoryStore()));
  return st;
};
const devWorldStore: PluginDataStore = {
  get: (pid) => worldStore().get(pid),
  set: (pid, d) => worldStore().set(pid, d),
};

/** 收起小卡、停掉载入的插件 */
export function closeDev(): void {
  epoch++;
  stopHost();
  if (toolsLoaded) void loadTools().then((m) => m.stopDevTool());
  asking.get()?.answer(false);
  asking.set(null);
  handle = null;
  granted = null;
  simFile = null;
  tries++;
  queued = [];
  state.set(null);
  devCardOn.set(false);
}

let toolsLoaded = false;
const loadTools = () => {
  toolsLoaded = true;
  return import('./tools/toolRun');
};

function source(r: number, tool: DevTool | null): PluginSource {
  return {
    ...(tool ? { pick: tool.pick } : {}),
    world: () => pluginWorld.world,
    civ: () => pluginWorld.civ,
    edits: () => getEdits(),
    title: () => currentWorld()?.title || '未命名世界',
    chronicle: () => (pluginWorld.civ ? buildChronicle(pluginWorld.civ) : null),
    view: () => viewOf(pluginWorld),
    watchView,
    notes: () => {
      const id = currentWorld()?.id;
      return id ? cleanNoteList(exportNotes(id)) : [];
    },
    commit: (next, keys) => {
      const why = commitPluginEdits(next, keys);
      log(r, 'site', why ? `没照插件的要求改：${why}` : `照插件的要求改了你写的东西（${keys.length} 处），能撤销`);
      return why;
    },
  };
}

function ask(opened: OpenedPlugin, file: string): Promise<boolean> {
  return new Promise((resolve) => {
    asking.set({
      opened,
      file,
      answer: (ok) => {
        asking.set(null);
        resolve(ok);
      },
    });
  });
}

/** Chrome、Edge 能记住选的文件:选一个(取消 = null);别的浏览器 = undefined,由调用的地方用 <input type="file"> 选 */
export async function pickDevFile(): Promise<{ file: File; handle: FileHandle } | null | undefined> {
  const open = (globalThis as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker;
  if (typeof open !== 'function') return undefined;
  try {
    const [h] = await open.call(globalThis, { types: [{ description: '插件文件', accept: { 'application/octet-stream': [PLUGIN_FILE_EXT] } }] });
    return { file: await h.getFile(), handle: h };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return null;
    return undefined;
  }
}

/** 记着文件的:再读一次载入;没记着 = false,由调用的地方让用的人再选一次 */
export async function reloadDev(): Promise<boolean> {
  const h = handle;
  const s = state.get();
  if (!h || !s || s.busy) return !!h;
  const my = epoch;
  let file: File;
  try {
    file = await h.getFile();
  } catch (e) {
    if (my === epoch) log(++run, 'error', `读不了 ${s.file}：${(e as Error)?.message ?? e}`);
    return true;
  }
  if (my === epoch && handle === h) await loadDev(file, h);
  return true;
}

/** 读文件、查、第一次(或者要的东西多了)先问、换掉正在跑的那个 */
export async function loadDev(file: File, h: FileHandle | null): Promise<void> {
  const prev = state.get();
  if (prev?.busy) return;
  const my = epoch;
  const again = !!prev;
  handle = h;
  tries++;
  state.set({ file: file.name, manifest: prev?.manifest ?? null, load: prev?.load ?? null, busy: true, logs: prev?.logs ?? [], reread: !!h, sim: null });
  devCardOn.set(true);
  const done = (r: number, ms: number | null, manifest?: PluginManifest) => {
    if (my !== epoch) return;
    state.update((s) => s && { ...s, manifest: manifest ?? s.manifest, load: { at: Date.now(), again, ms }, busy: false });
    if (r) flush();
  };

  let opened: OpenedPlugin;
  try {
    opened = await openPluginFile(file);
  } catch (e) {
    if (my !== epoch) return;
    stopHost();
    log(++run, 'error', (e as Error)?.message ?? String(e));
    return done(run, null);
  }
  if (my !== epoch) return;
  const blocked = verdictOf(opened.sum, opened.manifest.id).blocked;
  if (blocked) {
    stopHost();
    log(++run, 'error', `网站停用了这一版：${blocked.why}`);
    return done(run, null, opened.manifest);
  }
  if (!granted || addedLines(granted, opened.manifest).length > 0) {
    const ok = await ask(opened, file.name);
    if (my !== epoch) return;
    if (!ok) {
      if (!granted) return closeDev();
      state.update((s) => s && { ...s, busy: false });
      return;
    }
    granted = opened.manifest;
  }

  stopHost();
  const r = ++run;
  if (isSim(opened.manifest)) {
    // 推演插件不开起来:记下文件,试推时交给推演线程
    if (toolsLoaded) void loadTools().then((m) => m.stopDevTool());
    const t0 = performance.now();
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      if (my !== epoch) return;
      log(r, 'error', `读不了 ${file.name}：${(e as Error)?.message ?? e}`);
      return done(r, null, opened.manifest);
    }
    if (my !== epoch || run !== r) return;
    simFile = { id: opened.manifest.id, sum: opened.sum, bytes };
    state.update((s) => s && { ...s, sim: { pct: null, last: null } });
    return done(r, performance.now() - t0, opened.manifest);
  }
  simFile = null;
  // 要了面板或点选的(工具):插件卡、点选和「工具」里开的一样
  let tool: DevTool | null = null;
  if (isTool(opened.manifest)) {
    const m = await loadTools().catch(() => null);
    if (my !== epoch || run !== r) return;
    tool = m?.beginDevTool(opened, () => void reloadDev()) ?? null;
  }
  const t0 = performance.now();
  try {
    const started = await startPluginHost({
      plugin: opened.manifest,
      code: opened.code,
      source: source(r, tool),
      stores: { world: devWorldStore },
      sink: {
        ...(tool ? { panel: tool.panel } : {}),
        layer: (id, layer) => {
          if (layer && run !== r) return;
          setLiveLayer({ pluginId: opened.manifest.id, plugin: opened.manifest.name, record: worldPluginOf(opened), dev: true }, id, layer);
        },
        log: (text, level) => log(r, level ?? 'info', text),
        failed: (call, code, text) => {
          if (code !== 'cancelled') log(r, 'warn', `${call} 没成：${text}`);
        },
      },
      onStop: (reason, detail) => {
        tool?.stopped(reason, detail);
        if (reason === 'crashed' && detail) log(r, 'error', detail);
        const t = devStopText(reason, detail);
        if (t) log(r, 'site', t);
        if (run === r) stopHost();
      },
    });
    if (my !== epoch || run !== r) return started.stop();
    host = started;
    tool?.attach(started);
    pinger = setInterval(() => void started.sandbox.ping(PING_MS).catch(() => {}), PING_MS);
    done(r, performance.now() - t0, opened.manifest);
  } catch (e) {
    if (e instanceof PluginRefused) log(r, 'error', e.message);
    done(r, null, opened.manifest);
  }
}

/** 试推带的推演插件:地图上这个世界用的,载入的这个换掉同一个编号的那个(滑条照世界的),没选它就加在最后;世界用的本机对不上就只带它 */
function tryFiles(dev: SimPluginFile, name: string): { files: SimPluginFile[]; plugins: DevTried['plugins']; alone: boolean } {
  const now = getSimNow();
  const mine = now && now.id === currentWorld()?.id ? now : null;
  const alone = !!mine && !mine.files;
  const list = mine?.files && mine.files.length ? mine.files : [];
  const files = list.map((f) => (f.id === dev.id ? { ...f, sum: dev.sum, bytes: dev.bytes } : f));
  if (!files.some((f) => f.id === dev.id)) files.push(dev);
  const names = new Map((mine?.list ?? []).map((p) => [p.id, p.name ?? p.id]));
  return { files, plugins: files.map((f) => ({ id: f.id, name: f.id === dev.id ? name : (names.get(f.id) ?? f.id), dev: f.id === dev.id })), alone };
}

/** 试推:后台在地图上这个世界上带着载入的推演插件从第 0 年推 DEV_TRY_YEARS 年(不改世界) */
export async function tryDev(): Promise<void> {
  const s = state.get();
  const run = devTryRunner();
  if (!s?.sim || s.sim.pct !== null || s.busy || !simFile || !run) return;
  const my = ++tries;
  const { files, plugins, alone } = tryFiles(simFile, s.manifest?.name ?? simFile.id);
  const put = (sim: DevSim) => my === tries && state.update((x) => (x?.sim ? { ...x, sim } : x));
  put({ pct: 0, last: s.sim.last });
  const base = { at: 0, file: s.file, plugins, alone };
  try {
    const result = await run(files, DEV_TRY_YEARS, (pct) => put({ pct, last: s.sim!.last }));
    put({ pct: null, last: { ...base, at: Date.now(), result } });
  } catch (e) {
    put({ pct: null, last: { ...base, at: Date.now(), result: null, error: (e as Error)?.message ?? String(e) } });
  }
}

/** 不等这次试推了(后台推完的不要) */
export function stopTry(): void {
  const s = state.get();
  if (!s?.sim || s.sim.pct === null) return;
  tries++;
  state.update((x) => (x?.sim ? { ...x, sim: { ...x.sim, pct: null } } : x));
}
