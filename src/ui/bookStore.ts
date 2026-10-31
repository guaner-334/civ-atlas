/**
 * 成书:生成史书的状态 —— 选项窗口、后台写作、阅读。纯状态,不碰 DOM(单测里用假 AI 跑完整流程)。
 *
 *   openHistoryBook({ polity?, life? })  打开"生成史书"窗口(给了国家就默认写那一国;国家面板的"写国史"用;
 *                                 给了 life 就多一个"某某列传""某朝某氏家传",默认写它)
 *   writeLife(scope, written)     人物卡「更多 → 让 AI 写列传」、世系图「让 AI 写这一朝的家传」:写过了直接打开那篇,
 *                                 没设置 AI 提示条"还没有设置 AI · 去设置",否则打开窗口(写什么停在这一篇)
 *   startBook(opts)               开始写:窗口关上,写作在后台进行(可以接着看地图、拖时间轴);同一时间只写一部
 *                                 没设置 AI → 提示条"还没有设置 AI · 去设置";失败 → 提示条报错 + 重试
 *                                 (分章写到一半出错的:写好的几章留着,重试从断的那章接着写,见 kept)
 *   stopBook()                    停下正在写的(写到一半的不存)
 *   openBookReader(key | null)    阅读:已写好的那部(笔记的键;看的是它正在用的那版)/ null = 正在写(或刚写完)的那部
 *                                 写过的再写一遍不覆盖,算这一部的新一版(ai/history.ts 的 bookVersions;阅读页能翻看旧版)
 *   useBook()                     React:整个状态(窗口、阅读、正在写的那部、上次选的文体篇幅)
 *   useBookReader()               React:只看阅读那一块
 *
 * 写、存、比对历史指纹都在 ai/history.ts;这里只管"哪一部在写、写到哪、写完了没"。
 * 界面:BookDialog.tsx(选项窗口)、BookReader.tsx(阅读)、Corners.tsx 的 BookChip(右上的进度)。
 */
import { useSyncExternalStore } from 'react';
import type { Civ } from '../gen/civ/types';
import { getAiStatus, openAiSettings } from '../ai/client';
import { AiError } from '../ai/types';
import { joinWritten, listHistoryNotes, writeHistory, type WrittenCall } from '../ai/history';
import { useNotesVersion } from '../ai/library';
import { BOOK_LENGTHS, BOOK_STYLES, HISTORY_STYLES, textLength, type HistoryLength, type HistoryStyle } from '../ai/prompts/history';
import {
  LIFE_STYLES,
  bookLoadScope,
  bookNoteKey,
  bookPrompts,
  bookStoreScope,
  isLifeScope,
  lifeLength,
  type BookOptions,
  type BookPrompts,
  type BookStoredScope,
  type LifeScope,
  type LifeSource,
} from '../ai/prompts/lives';
import { clearToast, showToast } from './toastStore';
import { currentWorld, useSavesVersion } from './saveStore';
import { currentEra } from './editsStore';
import { eraText, type Era } from '../gen/era';

export interface BookJob {
  /** 每开始写一部加一 */
  id: number;
  status: 'writing' | 'done' | 'stopped' | 'error';
  /** 写进哪个世界(saveStore 的世界编号) */
  world: string;
  opts: BookOptions;
  /** 笔记的键(写完存成这里的新一版;同一个"写什么 + 文体 + 篇幅"是同一部) */
  key: string;
  /** 书名(不带书名号):"世界通史" / "大昌史" / "世祖苏珩羽传" */
  title: string;
  /** "第 0—3000 年" */
  range: string;
  /** 这一部要写多少字(史料不够时比所选篇幅少) */
  chars: number;
  /** 到目前为止写出来的全文(Markdown) */
  text: string;
  /** 正在写第几次调用(0 起)/ 一共几次(长篇一章一次) */
  call: number;
  calls: number;
  error?: AiError;
  /** 写完之后点开读过了:右上的"已完成 · 打开"收起 */
  seen?: boolean;
}

export interface BookState {
  dialog: {
    open: boolean;
    /** 打开时默认写的国家(国家面板的"写国史");null = 默认整个世界 */
    polity: number | null;
    /** 从人物卡、世系图进来:多一个"某某列传""某朝某氏家传",默认写它;别处打开 = null */
    life: LifeScope | null;
    /** 每次打开加一(默认值只在打开那一刻套用) */
    stamp: number;
  };
  reader: {
    open: boolean;
    /** 读哪一部:笔记的键;null = 正在写(或刚写完)的那部 */
    key: string | null;
    stamp: number;
  };
  job: BookJob | null;
  /** 上次选的文体、篇幅(下次打开窗口还是它) */
  prefs: { style: HistoryStyle; length: HistoryLength };
  /** 列传、家传上次选的文体(史书体 / 白话讲述 / 传说故事;篇幅只有一档) */
  lifeStyle: HistoryStyle;
  /** 上次点"开始生成"时还没设置 AI:设置好再打开窗口,照原来选的 */
  pending: BookOptions | null;
}

const initial = (): BookState => ({
  dialog: { open: false, polity: null, life: null, stamp: 0 },
  reader: { open: false, key: null, stamp: 0 },
  job: null,
  prefs: { style: BOOK_STYLES[0], length: BOOK_LENGTHS[1] },
  lifeStyle: LIFE_STYLES[0],
  pending: null,
});

let state: BookState = initial();
const subs = new Set<() => void>();
function set(patch: Partial<BookState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function getBook(): BookState {
  return state;
}

export function useBook(): BookState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getBook,
    getBook,
  );
}

/** React:只看阅读开没开、读哪一部(写作进度变了不跟着重新渲染;浏览器的后退记不记一步看它,见 nav.ts) */
export function useBookReader(): BookState['reader'] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state.reader,
    () => state.reader,
  );
}

// ---------------------------------------------------------------------------
// 窗口

/** 打开"生成史书"窗口;给了国家就默认写"这一国"(国家面板、编年史);给了 life 就默认写这一篇列传 / 家传 */
export function openHistoryBook(opt: { polity?: number | null; life?: LifeScope | null } = {}) {
  set({ dialog: { open: true, polity: opt.polity ?? null, life: opt.life ?? null, stamp: state.dialog.stamp + 1 }, reader: { ...state.reader, open: false } });
}

export function closeHistoryBook() {
  if (state.dialog.open) set({ dialog: { ...state.dialog, open: false } });
}

export function setBookPrefs(p: Partial<BookState['prefs']>) {
  set({ prefs: { ...state.prefs, ...p } });
}

export function setLifeStyle(style: HistoryStyle) {
  if (state.lifeStyle !== style) set({ lifeStyle: style });
}

/** 阅读:key = 笔记的键;null = 正在写(或刚写完)的那部。读的是刚写完的那部 = 右上的"已完成 · 打开"收起 */
export function openBookReader(key: string | null) {
  const j = state.job;
  const job = j && j.status === 'done' && (key === null || key === j.key) ? { ...j, seen: true } : j;
  set({ reader: { open: true, key: key ?? (j && j.status === 'done' ? j.key : null), stamp: state.reader.stamp + 1 }, dialog: { ...state.dialog, open: false }, job });
}

export function closeBookReader() {
  if (state.reader.open) set({ reader: { ...state.reader, open: false } });
}

// ---------------------------------------------------------------------------
// 写

/**
 * 写的时候用哪个世界的历史(界面挂载时交进来:改名之后是改过名的那份);
 * src = 列传、家传要的人物卡、作者的人物(ui/lifeSource.ts;不给 = 只能写史书)
 */
let ctx: { civ: Civ; world: string; src: LifeSource | null } | null = null;
export function setBookContext(civ: Civ | null, world: string | null, src: LifeSource | null = null) {
  ctx = civ && world ? { civ, world, src } : null;
}

/** 列传、家传的材料从哪取(窗口、阅读页算材料、比对指纹用) */
export function getBookSource(): LifeSource | null {
  return ctx?.src ?? null;
}

let seq = 0;
let abort: AbortController | null = null;
const TOAST = 'book';

/**
 * 分章写到一半出错时已经写好的几章(篇):重试同一部书(同一个世界、同一个键、材料一字不差)时交给 writeHistory,
 * 从断的那章接着写,前面的不再写。只留最近一部、只在内存里(刷新页面就没了);写完、停下、换世界、开始写别的就丢掉
 */
let kept: { world: string; key: string; material: string; written: WrittenCall[] } | null = null;

/** 这一部的材料(核对重试时历史有没有变:改名、干预、改地形重推之后对不上,就从头写) */
function materialOf(pr: BookPrompts): string {
  return [pr.system, ...pr.calls.map((c) => `${c.title}\n${c.head}\n${c.body}`)].join('\n');
}

/** 书名加书名号;世界起了名字时,通史写成"某某通史" */
export function bookTitleText(title: string, scope: { kind: string }, worldTitle?: string | null, era: Era | undefined = currentEra()): string {
  const t = scope.kind === 'world' && worldTitle && title === '世界通史' ? `${worldTitle}通史` : title;
  // 一段时代的书名写着"第 1200—1500 年史":按纪年写
  return `《${eraText(t, era)}》`;
}

/** 分几次写时一次写的叫什么:纪传体一篇、编年体一卷,其余一章 */
export function bookUnit(style: HistoryStyle): string {
  return style === 'biography' ? '篇' : (HISTORY_STYLES[style].unit ?? '章');
}

/** 一部书的写法:"纪传体，约一万字""编年体，约三万字，分 5 章" */
export function bookHow(j: Pick<BookJob, 'opts' | 'chars' | 'calls'>): string {
  const W: Record<number, string> = { 3000: '约三千字', 10000: '约一万字', 30000: '约三万字' };
  return `${HISTORY_STYLES[j.opts.style].label}，${W[j.chars] ?? `约 ${j.chars} 字`}${j.calls > 1 ? `，分 ${j.calls} 章` : ''}`;
}

/**
 * 写到哪了(0–1):按字数和第几章估,写完 = 1。
 * AI 还没回第一个字(开头几秒在读材料)= 0:右上的进度条画成来回滑动的一小段(states.css),不停在最左
 */
export function bookProgress(j: BookJob): number {
  if (j.status === 'done') return 1;
  if (j.status === 'writing' && !j.text && j.call === 0) return 0;
  const byText = j.chars > 0 ? textLength(j.text) / j.chars : 0;
  const byCall = j.calls > 0 ? j.call / j.calls : 0;
  return Math.max(0.02, Math.min(0.97, Math.max(byText, byCall)));
}

function notConfigured(text = '还没有设置 AI') {
  showToast({
    id: TOAST,
    kind: 'warn',
    text,
    action: {
      label: '去设置',
      onClick: () => {
        clearToast(TOAST);
        openAiSettings();
      },
    },
  });
}

/**
 * 开始写一部(窗口关上,后台写)。返回是否开始了:
 * 没设置 AI(提示条 + "去设置")、已经在写别的、这个范围里没有史事 = false。
 * 同一部上次分章写到一半出错、历史没变:从断的那章接着写(提示条、阅读页的"重试"都走这里)
 */
export function startBook(opts: BookOptions): boolean {
  const c = ctx;
  if (!c || state.job?.status === 'writing') return false;
  if (!getAiStatus().ready) {
    // 窗口关上(提示条在窗口下面会被挡住);设置好 AI 再点"成书",还是这次选的
    set({ pending: opts, dialog: { ...state.dialog, open: false }, reader: { ...state.reader, open: false } });
    notConfigured();
    return false;
  }
  const life = isLifeScope(opts.scope);
  const pr = bookPrompts(c.civ, opts, c.src);
  if (pr.empty || !pr.calls.length) {
    showToast({ id: TOAST, kind: 'warn', text: life ? '找不到要写的人了' : '这段历史里没有史事可写' });
    return false;
  }
  clearToast(TOAST);
  const id = ++seq;
  const key = bookNoteKey(bookStoreScope(c.civ, opts.scope, c.src), opts.style, opts.length);
  // 这一部上次分章写到一半出错(材料没变):写好的几章留着,从断的那章接着写
  const material = materialOf(pr);
  const resume = kept && kept.world === c.world && kept.key === key && kept.material === material ? kept.written : [];
  kept = { world: c.world, key, material, written: resume };
  const job: BookJob = {
    id,
    status: 'writing',
    world: c.world,
    opts,
    key,
    title: pr.title,
    range: pr.range,
    chars: pr.chars,
    text: joinWritten(resume),
    call: Math.min(resume.length, pr.calls.length - 1),
    calls: pr.calls.length,
  };
  const ac = new AbortController();
  abort = ac;
  set({ job, dialog: { ...state.dialog, open: false }, ...(life ? { lifeStyle: opts.style } : { prefs: { style: opts.style, length: opts.length } }), pending: null });

  // 进度:AI 一个字一个字地回,攒一下再刷新显示
  let pending: { text: string; call: number; calls: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const p = pending;
    const j = state.job;
    if (p && j && j.id === id && j.status === 'writing') set({ job: { ...j, text: p.text, call: p.call, calls: p.calls } });
  };
  const finish = (patch: Partial<BookJob>) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (abort === ac) abort = null;
    const j = state.job;
    if (!j || j.id !== id) return null;
    const next = { ...j, ...patch };
    set({ job: next });
    return next;
  };

  writeHistory(c.civ, opts, {
    world: c.world,
    src: c.src,
    signal: ac.signal,
    written: resume,
    onProgress: (p) => {
      pending = p;
      if (!timer) timer = setTimeout(flush, 120);
    },
    onWritten: (w) => {
      if (kept && state.job?.id === id) kept = { ...kept, written: w };
    },
  }).then(
    (note) => {
      // 正在读这一部(边写边看):写完接着看存好的那部
      const reading = state.reader.open && state.reader.key === null;
      if (finish({ status: 'done', text: note.text, key: note.key, call: job.calls - 1, seen: reading })) kept = null;
      if (reading) set({ reader: { ...state.reader, key: note.key } });
    },
    (e) => {
      const err = e instanceof AiError ? e : new AiError('other', `写史书失败:${e instanceof Error ? e.message : String(e)}`);
      const done = finish({ status: err.code === 'aborted' ? 'stopped' : 'error', error: err, text: pending?.text ?? state.job?.text ?? '' });
      if (!done) return;
      // 停下 = 写到一半的不要了;出错 = 写好的几章留着(kept),重试接着写
      if (err.code === 'aborted') {
        kept = null;
        return;
      }
      reportError(done, err);
    },
  );
  return true;
}

/** 写失败:顶部提示条报错,带"重试"(没设置 AI 的带"去设置") */
function reportError(j: BookJob, err: AiError) {
  if (err.code === 'not-configured') return notConfigured(err.message.length <= 24 ? err.message : '还没有设置 AI');
  const retry = {
    label: '重试',
    onClick: () => {
      clearToast(TOAST);
      startBook(j.opts);
    },
  };
  const name = bookTitleText(j.title, j.opts.scope, currentWorld()?.title);
  if (err.code === 'content-filter') {
    showToast({
      id: TOAST,
      kind: 'warn',
      text: `${name}没写完`,
      more: ['内容被 AI 服务商的审核拦下了（已自动换成更克制的写法重写过一次），可以重试或换个文体'],
      action: retry,
    });
    return;
  }
  showToast({ id: TOAST, kind: 'error', text: `${name}没写完`, more: [err.message], action: retry });
}

/** 停下正在写的(写到一半的不存;旧的几版不动) */
export function stopBook() {
  abort?.abort();
}

/** 换了世界:停下正在写的(写到的存不进别的世界),右上的进度收起 */
export function resetBookForWorld() {
  abort?.abort();
  abort = null;
  kept = null;
  set({ job: null, reader: { ...state.reader, open: false }, dialog: { ...state.dialog, open: false } });
}

// ---------------------------------------------------------------------------
// 列传、家传的入口

/** 两个"写什么"是不是同一个人(同一朝):推演里的人、一朝按稳定键,作者的人物按编号 + 生年 */
function sameLife(a: BookStoredScope, b: BookStoredScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'person' && b.kind === 'person') return !!a.key && a.key === b.key;
  if (a.kind === 'character' && b.kind === 'character') return a.id === b.id && a.born === b.born;
  if (a.kind === 'house' && b.kind === 'house') return !!a.key && a.key === b.key && a.dynasty === b.dynasty;
  return false;
}

/** 这个世界里给他(这一朝)写过的、最近的那篇:笔记的键;没写过 = null */
export function lifeNoteKey(civ: Civ, world: string, scope: LifeScope): string | null {
  const s = bookStoreScope(civ, scope, ctx?.src);
  return listHistoryNotes(world).find((n) => sameLife(n.book.scope, s))?.key ?? null;
}

/** React:给他(这一朝)写过的那篇(人物卡「更多」里那一项右边写"已写");写好、删掉了跟着变 */
export function useLifeNote(civ: Civ, scope: LifeScope | null): string | null {
  useNotesVersion();
  useSavesVersion();
  const w = currentWorld();
  return scope && w ? lifeNoteKey(civ, w.id, scope) : null;
}

/**
 * 「让 AI 写列传」「让 AI 写这一朝的家传」:written = 已经写过的那篇(人物卡上的「已写」),直接打开读(阅读页里有「重写」);
 * 还没设置 AI:提示条"还没有设置 AI · 去设置"(设置好再点「成书」,窗口里还是这一篇);否则打开窗口,写什么停在这一篇
 */
export function writeLife(scope: LifeScope, written: string | null = null, from?: Civ) {
  if (written) return openBookReader(written);
  // 卡片用的那份历史和写书的不是同一份(正看着助手试推演的结果):按稳定键换成写书那份里的人、那一朝;
  // 只在试推演里有的(现在的历史里没有):不写(编号在现在的历史里可能是别人)
  const c = ctx;
  if (from && c && from !== c.civ && scope.kind !== 'character') {
    const s = bookLoadScope(c.civ, bookStoreScope(from, scope, c.src), c.src);
    if (!s || !isLifeScope(s)) {
      showToast({ id: TOAST, kind: 'warn', text: `${scope.kind === 'house' ? '这一朝' : '这个人'}只在试推演的结果里,现在的历史里还没有,写不了` });
      return;
    }
    scope = s;
  }
  if (!getAiStatus().ready) {
    set({ pending: { scope, style: state.lifeStyle, length: lifeLength(scope) } });
    notConfigured();
    return;
  }
  openHistoryBook({ life: scope });
}

/** 单测用 */
export function _resetBook() {
  abort?.abort();
  abort = null;
  ctx = null;
  kept = null;
  state = initial();
  subs.forEach((f) => f());
}
