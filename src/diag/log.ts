/**
 * 问题记录:页面出错、意外关闭、每次 AI 调用成没成功、助手每一步用工具成没成功,记在这台设备的浏览器里,不会自动发出去。
 * 用户在「更多 → 问题记录」里看最近几天的次数和出过的问题,自己点导出(先看全文,再复制或下载)。
 *
 * - 存在 localStorage('civ-atlas-diag'):每记一条马上同步写,页面紧接着崩掉也留得住;最多 MAX_ENTRIES 条、合计约 MAX_CHARS 字,从最旧的删
 * - 只记排查要用的:说明、代码位置、耗时、错误类型、用量;不记密钥、令牌、AI 写的字、作者写的字(AI 的全文另在「AI 设置 → 调用记录」)
 * - 出错说明截短、遮掉像密钥的字(scrub),网址只留路径
 * - 同一个错连着出(比如每一帧都抛)只记一条,次数记在 n 上
 * - 存不下、浏览器不让存时只记在内存里(这次打开的页面里还能看)
 *
 * 别的功能要记自己的事(比如 AI 写完以后的检查)调 recordDiag,kind 用自己的名字;界面上只列 PROBLEM_KINDS 里的几种,导出里全有。
 * 纯逻辑,不碰 DOM;存储可以换(单测用 setDiagStorage)。
 */
import { useSyncExternalStore } from 'react';

export const DIAG_KEY = 'civ-atlas-diag';
export const MAX_ENTRIES = 300;
export const MAX_CHARS = 200_000;
/** 出错说明最长多少字 */
export const MSG_MAX = 300;
/** 同一个错多久以内再出算连着出 */
const REPEAT_MS = 10_000;

/** 当时在做什么(出错、意外关闭的那条带上) */
export interface DiagContext {
  /** "生成世界""推演历史""导出回放视频""AI:写史书" */
  doing?: string;
  /** 在看哪一年 */
  year?: number;
  /** 种子 + 参数(同存档的 worldKey) */
  world?: string;
  /** 地图图层 */
  layer?: string;
}

export interface DiagErrorEntry extends DiagContext {
  kind: 'error';
  at: string;
  /** 哪里报上来的:页面脚本 / 没接住的 Promise / 后台线程 */
  src: 'window' | 'promise' | 'worker';
  message: string;
  /** 出错的代码位置,最里面的在前:"Overview.tsx:212" */
  stack?: string[];
  /** 连着出了几次(1 次不写) */
  n?: number;
}

export interface DiagCrashEntry extends DiagContext {
  kind: 'crash';
  /** 最后一次听到它的时间 */
  at: string;
  /** 那次打开网页的时间 */
  started: string;
  /** 浏览器给的已用内存(MB;只有 Chrome 系有) */
  heapMB?: number;
}

export interface DiagAiEntry {
  kind: 'ai';
  at: string;
  feature: string;
  provider: string;
  model: string;
  ok: boolean;
  /** 失败的错误类型(AiErrorCode) */
  code?: string;
  ms: number;
  tokensIn?: number;
  tokensOut?: number;
  /** 模型要调用的工具个数 */
  toolCalls?: number;
}

export interface DiagToolEntry {
  kind: 'tool';
  at: string;
  tool: string;
  ok: boolean;
  /** 没做成的原因:没有这个工具 / 参数不是合法的 JSON / 执行时出错 */
  why?: 'no-tool' | 'bad-args' | 'failed';
  ms: number;
}

/** 别的功能记的事:kind 自己起名,其余字段随意(只放数字、短字和是非,不放正文) */
export interface DiagOtherEntry {
  kind: string;
  at: string;
  [k: string]: unknown;
}

export type DiagEntry = DiagErrorEntry | DiagCrashEntry | DiagAiEntry | DiagToolEntry | DiagOtherEntry;

/** 记的时候 at 可以不给(= 现在) */
export type DiagInput = DiagEntry extends infer T ? (T extends DiagEntry ? Omit<T, 'at'> & { at?: string } : never) : never;

/** 界面上列出来的几种问题 */
export const PROBLEM_KINDS = ['crash', 'error', 'ai', 'tool'] as const;

/** 能读写字符串的存储(localStorage 的那一小部分) */
export interface DiagStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function defaultStorage(): DiagStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let storage: DiagStorage | null | undefined;
let list: DiagEntry[] | null = null;
/** 存进浏览器了;false = 只在内存里 */
let persistent = false;
const subs = new Set<() => void>();
let snap: DiagState | null = null;

export interface DiagState {
  /** 新的在前 */
  entries: readonly DiagEntry[];
  persistent: boolean;
}

/** 换存储(单测;传 null = 只在内存);换了以后重新读 */
export function setDiagStorage(s: DiagStorage | null): void {
  storage = s;
  list = null;
  snap = null;
}

const valid = (e: unknown): e is DiagEntry => !!e && typeof (e as DiagEntry).kind === 'string' && typeof (e as DiagEntry).at === 'string';

function load(): DiagEntry[] {
  if (list) return list;
  if (storage === undefined) storage = defaultStorage();
  list = [];
  persistent = false;
  if (!storage) return list;
  try {
    const raw = storage.getItem(DIAG_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(v)) list = v.filter(valid);
    persistent = true;
  } catch {
    // 读不出来(坏了 / 不让读):从空的开始,下次写的时候覆盖
    persistent = !!storage;
  }
  return list;
}

/** 写之前重读一遍:同时开着几个标签页时,别的页面刚记的不会被这一页旧的那份盖掉 */
function fresh(): DiagEntry[] {
  if (persistent && storage) {
    try {
      const raw = storage.getItem(DIAG_KEY);
      const v = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(v)) list = v.filter(valid);
    } catch {
      // 读不出来就用手上这份
    }
  }
  return load();
}

function save() {
  const l = load();
  if (!storage) return;
  let text = JSON.stringify(l);
  // 太大就从最旧的删
  while (text.length > MAX_CHARS && l.length > 1) {
    l.splice(Math.max(1, Math.floor(l.length * 0.8)));
    text = JSON.stringify(l);
  }
  try {
    storage.setItem(DIAG_KEY, text);
    persistent = true;
  } catch {
    // 存不下:存一半试试;还不行就只在内存里记(内存里那份不删)
    const half = l.slice(0, Math.max(1, Math.floor(l.length / 2)));
    try {
      storage.setItem(DIAG_KEY, JSON.stringify(half));
      l.length = half.length;
      persistent = true;
    } catch {
      persistent = false;
    }
  }
}

function emit() {
  snap = null;
  for (const f of subs) f();
}

// ---------------------------------------------------------------------------
// 遮掉不该带出去的字

/** 遮密钥的(AI 设置里填的密钥;启动时由 ai/settings 那边接上,这个文件不读设置) */
let scrubber: (s: string) => string = (s) => s;
export function setDiagScrubber(f: (s: string) => string): void {
  scrubber = f;
}

/** 出错说明:遮密钥、网址只留路径、长串数字字母遮掉、截短 */
export function cleanText(s: string, max = MSG_MAX): string {
  let t = scrubber(String(s));
  t = t
    .replace(/\b(?:blob|data):[^\s'")]+/g, '[本地数据]')
    .replace(/\bhttps?:\/\/[^\s'")]+/g, (u) => {
      try {
        return new URL(u).pathname;
      } catch {
        return '[网址]';
      }
    })
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/\b(?:Bearer|token[=:])\s*[A-Za-z0-9._~+/=-]{12,}/gi, '[令牌]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 调用栈 → 最里面的几处代码位置("Overview.tsx:212""index-abc123.js:1:5821"),不带网址 */
export function stackFrames(stack: string | undefined, max = 6): string[] {
  if (!stack) return [];
  const out: string[] = [];
  for (const line of stack.split('\n')) {
    const m = /([^/\\\s()@]+\.(?:[cm]?[jt]sx?))(?:\?[^:\s)]*)?:(\d+)(?::(\d+))?/.exec(line);
    if (!m) continue;
    out.push(`${m[1]}:${m[2]}${m[3] ? `:${m[3]}` : ''}`);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 记

/** 记一条(at 不给 = 现在) */
export function recordDiag(e: DiagInput): void {
  const l = fresh();
  const entry = { ...e, at: e.at ?? new Date().toISOString() } as DiagEntry;
  l.unshift(entry);
  if (l.length > MAX_ENTRIES) l.length = MAX_ENTRIES;
  save();
  emit();
}

/** 记一次出错:同一个错 10 秒内又出,只在上一条上加次数 */
export function recordError(src: DiagErrorEntry['src'], message: string, stack: string | undefined, ctx: DiagContext = {}): void {
  const l = fresh();
  const msg = cleanText(message || '(没有说明)');
  const frames = stackFrames(stack);
  const last = l.find((e) => e.kind === 'error') as DiagErrorEntry | undefined;
  // 说明一样、出错的地方也一样才算同一个错
  const same = last && last.message === msg && last.src === src && (last.stack ?? []).join() === frames.join();
  if (last && same && Date.now() - Date.parse(last.at) < REPEAT_MS) {
    last.n = (last.n ?? 1) + 1;
    save();
    emit();
    return;
  }
  recordDiag({ kind: 'error', src, message: msg, ...(frames.length ? { stack: frames } : {}), ...cleanCtx(ctx) });
}

/** 当时在做什么:只留有的几项 */
export function cleanCtx(c: DiagContext): DiagContext {
  const out: DiagContext = {};
  if (c.doing) out.doing = cleanText(c.doing, 60);
  if (typeof c.year === 'number' && Number.isFinite(c.year)) out.year = Math.round(c.year);
  if (c.world) out.world = cleanText(c.world, 200);
  if (c.layer) out.layer = c.layer;
  return out;
}

export function clearDiag(): void {
  load();
  list = [];
  save();
  emit();
}

export function getDiag(): DiagState {
  if (!snap) snap = { entries: load().slice(), persistent };
  return snap;
}

export function useDiag(): DiagState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getDiag,
    getDiag,
  );
}

// ---------------------------------------------------------------------------
// 看

export interface DiagSummary {
  errors: number;
  crashes: number;
  /** AI 真的发出去了的调用(没设置好、用户自己停下的不算) */
  ai: { total: number; ok: number };
  tools: { total: number; ok: number };
}

/** 不算进 AI 成功率的失败:没设置好(根本没发出去)、用户自己停下 */
const NOT_A_CALL = new Set(['not-configured', 'aborted']);

/** 最近 days 天的次数 */
export function summarize(entries: readonly DiagEntry[], days = 7, now = Date.now()): DiagSummary {
  const since = now - days * 86_400_000;
  const s: DiagSummary = { errors: 0, crashes: 0, ai: { total: 0, ok: 0 }, tools: { total: 0, ok: 0 } };
  for (const e of entries) {
    if (Date.parse(e.at) < since) continue;
    if (e.kind === 'error') s.errors += (e as DiagErrorEntry).n ?? 1;
    else if (e.kind === 'crash') s.crashes++;
    else if (e.kind === 'ai') {
      const a = e as DiagAiEntry;
      if (!a.ok && a.code && NOT_A_CALL.has(a.code)) continue;
      s.ai.total++;
      if (a.ok) s.ai.ok++;
    } else if (e.kind === 'tool') {
      s.tools.total++;
      if ((e as DiagToolEntry).ok) s.tools.ok++;
    }
  }
  return s;
}

/** 界面上列的"出的问题":意外关闭、出错、AI 调用失败(不含没设置好、自己停下)、工具没用成 */
export function isProblem(e: DiagEntry): boolean {
  if (e.kind === 'crash' || e.kind === 'error') return true;
  if (e.kind === 'ai') return !(e as DiagAiEntry).ok && !NOT_A_CALL.has((e as DiagAiEntry).code ?? '');
  if (e.kind === 'tool') return !(e as DiagToolEntry).ok;
  return false;
}

/** 导出文件开头的那些:网站版本、哪个网站、设备 */
export interface DiagEnv {
  version: string;
  generator: number;
  site: string;
  device: Record<string, unknown>;
}

/** 导出成 JSON 文本(用户先看全文再决定复制或下载) */
export function exportDiagJson(env: DiagEnv, entries: readonly DiagEntry[] = getDiag().entries, now = new Date()): string {
  const s = summarize(entries, 7, now.getTime());
  return JSON.stringify(
    {
      app: '文明与地图',
      kind: '问题记录',
      exportedAt: now.toISOString(),
      site: env.site,
      version: env.version,
      generator: env.generator,
      device: env.device,
      summary7d: { errors: s.errors, crashes: s.crashes, ai: [s.ai.total, s.ai.ok], tools: [s.tools.total, s.tools.ok] },
      count: entries.length,
      entries,
    },
    null,
    2,
  );
}
