/**
 * 「全部存成文件」:「我的世界」里的世界一起存成一个文件;「打开存档文件」选这个文件,全部放回「我的世界」。
 *
 * ```json
 * { "app": "文明与地图", "bundle": 1, "savedAt": "2026-10-05T08:00:00.000Z",
 *   "worlds": [ { "id": "wk3j9x2m1a", "save": { …和单个世界的存档文件一样… }, "meta": { "draft": true, "alive": 13 },
 *                 "thumb": "data:image/jpeg;base64,…", "notes": [ …AI 写的史书、名字由来… ] } ] }
 * ```
 *
 * - bundle:这种文件的格式版本(不兼容的变化时加一;比自己新的不读,提示刷新页面)
 * - id:存的时候这个世界的编号(放回来都换新编号;没建完的世界记着的底稿编号跟着换)。可以没有
 * - save:和单个世界的存档文件(gen/savefile.ts)一模一样,读的时候同样过 parseSave
 * - meta:卡片上的几样(还在新建、现存几国、新建时的底稿);thumb:缩略图;notes:AI 写的东西(ai/library.ts)。都可以没有
 *
 * 存:「我的世界」里的全部世界;正在看的那个没能存进浏览器(存储满了)的,用页面里的那份,一次都没存进去的也放进去。
 * 放回来:逐个放进「我的世界」(都是新编号;建好的先放,没建完的后放,好把底稿编号换成新的)。
 * 已经有一模一样的(参数、修改、名字、底稿出处都相同;没建完的和建好的分开算)不重复放,那边缺的 AI 写的东西、缩略图、现存几国补上,
 * 上次没能写进浏览器(存储满了)的 AI 写的东西再写一次;
 * 放满了(MAX_WORLDS)、浏览器存不下就停,不为它删别的世界。登录了的,放回来的世界照常同步进账号。
 */
import { SAVE_APP, fileBaseName, parseSave, type SaveFile } from '../gen/savefile';
import { exportNotes, notesSaved, replaceNotes, type AiNote } from '../ai/library';
import {
  MAX_WORLDS,
  cleanSyncMeta,
  currentSave,
  currentUnsaved,
  currentWorld,
  fillMissing,
  listWorlds,
  newWorldId,
  notify,
  putSyncedWorld,
  sameSave,
  type SyncMeta,
} from './saveStore';

/** 这种文件的格式版本 */
export const BUNDLE_FORMAT = 1;
/** 文件最大多少字节(缩略图、AI 写的东西都在里面,比单个世界的存档大得多) */
const MAX_BYTES = 64 * 1024 * 1024;
/** 一个世界最多带几条 AI 写的东西、每条最长多少字 */
const MAX_NOTES = 5000;
const NOTE_MAX = 200_000;
/** 一条 AI 写的东西除了正文以外另记的字段(史书的书目等),最多这么长 */
const NOTE_EXTRA_MAX = 20_000;
/** 缩略图最长多少字(网页自己截的 480×240 只有几十 KB) */
const THUMB_MAX = 1_000_000;

export interface BundleWorld {
  /** 存的时候的编号(换底稿编号用);没有 = 不知道 */
  id?: string;
  save: SaveFile;
  meta: SyncMeta;
  thumb: string | null;
  notes: AiNote[];
}

export interface Bundle {
  worlds: BundleWorld[];
  /** 读不出来、跳过了的世界 */
  bad: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 文件名:文明与地图-全部世界-2026-10-05.json(按本地日期) */
export function bundleFileName(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${fileBaseName({ title: '全部世界', seed: 0 })}-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}.json`;
}

/** 「我的世界」里的全部世界 → 文件内容;一个都没有 = null。正在看的那个最新的改动没存进浏览器(存储满了)的,用页面里的 */
export function bundleText(at = new Date()): { text: string; count: number } | null {
  const cur = currentWorld();
  const fresh = cur && currentUnsaved() ? currentSave() : null;
  const one = (id: string, save: SaveFile, w: { draft: boolean; alive?: number; base?: SyncMeta['base'] }, thumb: string | null) => {
    const meta: SyncMeta = {};
    if (w.draft) meta.draft = true;
    if (w.alive !== undefined) meta.alive = w.alive;
    if (w.draft && w.base) meta.base = w.base;
    const notes = exportNotes(id);
    return { id, save, meta, ...(thumb ? { thumb } : {}), ...(notes.length ? { notes } : {}) };
  };
  const list = listWorlds();
  const worlds = list.map((w) => one(w.id, fresh && cur?.id === w.id ? { ...fresh, savedAt: at.toISOString() } : w.save, w, w.thumb));
  // 正在看的这个一次都没能存进浏览器(存储满了):页面里这份是唯一的一份,也放进去
  if (cur && fresh && !list.some((w) => w.id === cur.id)) {
    worlds.unshift(one(cur.id, { ...fresh, savedAt: at.toISOString() }, { draft: cur.kind === 'draft', alive: cur.alive, base: cur.base }, null));
  }
  if (!worlds.length) return null;
  const text = JSON.stringify({ app: SAVE_APP, bundle: BUNDLE_FORMAT, savedAt: at.toISOString(), worlds }, null, 2) + '\n';
  return { text, count: worlds.length };
}

function cleanNotes(v: unknown): AiNote[] {
  if (!Array.isArray(v)) return [];
  const out: AiNote[] = [];
  const keys = new Set<string>();
  for (const x of v) {
    if (out.length >= MAX_NOTES) break;
    if (!isObj(x)) continue;
    const { key, kind, title, text, createdAt, provider, model, ...rest } = x;
    if (typeof key !== 'string' || !key || keys.has(key) || typeof kind !== 'string' || typeof text !== 'string' || text.length > NOTE_MAX) continue;
    keys.add(key);
    out.push({
      // 各功能自己另记的(史书的书目、释名写的时候的名字……)原样带上,用的时候各功能自己再检查;太大的不要
      ...(JSON.stringify(rest).length <= NOTE_EXTRA_MAX ? rest : {}),
      key: key.slice(0, 200),
      kind: kind.slice(0, 40),
      title: typeof title === 'string' ? title.slice(0, 200) : '',
      text,
      createdAt: typeof createdAt === 'string' && !Number.isNaN(Date.parse(createdAt)) ? createdAt : '',
      provider: typeof provider === 'string' ? provider.slice(0, 80) : '',
      model: typeof model === 'string' ? model.slice(0, 120) : '',
    });
  }
  return out;
}

/**
 * 读文件:不是「全部存成文件」存的(比如单个世界的存档)= null,交给 parseSave;
 * 是这种文件但读不了 = 中文错误;个别世界坏了的跳过、记个数
 */
export function parseBundle(text: string): { ok: true; bundle: Bundle } | { ok: false; error: string } | null {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.app !== SAVE_APP || raw.bundle === undefined) return null;
  const f = raw.bundle;
  if (typeof f !== 'number' || !Number.isInteger(f) || f < 1) return { ok: false, error: '文件坏了:缺少格式版本' };
  if (f > BUNDLE_FORMAT) return { ok: false, error: '这个文件来自更新版本的「文明与地图」,请刷新页面换到最新版再打开' };
  if (!Array.isArray(raw.worlds)) return { ok: false, error: '文件坏了:里面没有世界' };
  const worlds: BundleWorld[] = [];
  let bad = 0;
  for (const x of raw.worlds) {
    const r = isObj(x) ? parseSave(JSON.stringify(x.save ?? null)) : null;
    if (!r?.ok || !isObj(x)) {
      bad++;
      continue;
    }
    const thumb = typeof x.thumb === 'string' && x.thumb.length <= THUMB_MAX && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x.thumb) ? x.thumb : null;
    const id = typeof x.id === 'string' && x.id.length <= 64 ? x.id : undefined;
    worlds.push({ ...(id ? { id } : {}), save: r.save, meta: cleanSyncMeta(x.meta), thumb, notes: cleanNotes(x.notes) });
  }
  return { ok: true, bundle: { worlds, bad } };
}

export interface ImportResult {
  /** 放进来的世界编号 */
  added: string[];
  /** 已经有一模一样的、没重复放的 */
  same: number;
  /** 其中补上了缺的 AI 写的东西、缩略图的 */
  filled: number;
  /** 没放进去的(放满了、存不下) */
  left: number;
  /** 为什么没放进去:"full" 放满了、"storage" 浏览器存不下 */
  why?: 'full' | 'storage';
  /** AI 写的东西有没能存进浏览器的 */
  notesLost: boolean;
}

/** 已经有的同一个世界:文件里有、这边缺的 AI 写的东西(按条)、缩略图、现存几国补上;返回补了没有、AI 写的东西存进去没有 */
function fillFrom(id: string, w: BundleWorld): { filled: boolean; notesOk: boolean } {
  let filled = fillMissing(id, { thumb: w.thumb, alive: w.meta.alive });
  let notesOk = true;
  const have = exportNotes(id);
  const keys = new Set(have.map((n) => n.key));
  const more = w.notes.filter((n) => !keys.has(n.key));
  // 上次没能写进浏览器(存储满了)、只在页面里的,这次再写一遍
  const unsaved = !notesSaved(id);
  if (more.length || unsaved) {
    notesOk = replaceNotes(id, [...have, ...more]);
    if (more.length || notesOk) filled = true;
  }
  return { filled, notesOk };
}

/** 放回「我的世界」(见文件头) */
export function importBundle(b: Bundle): ImportResult {
  const have = listWorlds().map((w) => ({ id: w.id, save: w.save, draft: w.draft }));
  let count = have.length;
  const res: ImportResult = { added: [], same: 0, filled: 0, left: 0, notesLost: false };
  /** 文件里的编号 → 现在的编号(放进来的、原来就有的) */
  const ids = new Map<string, string>();
  // 建好的先放:没建完的放的时候,它的底稿已经有了新编号
  const order = [...b.worlds.filter((w) => !w.meta.draft), ...b.worlds.filter((w) => w.meta.draft)];
  for (const w of order) {
    const draft = !!w.meta.draft;
    const dup = have.find((h) => h.draft === draft && sameSave(h.save, w.save));
    if (dup) {
      if (w.id) ids.set(w.id, dup.id);
      res.same++;
      const f = fillFrom(dup.id, w);
      if (f.filled) res.filled++;
      if (!f.notesOk) res.notesLost = true;
      continue;
    }
    if (res.why) {
      res.left++;
      continue;
    }
    if (count >= MAX_WORLDS) {
      res.why = 'full';
      res.left++;
      continue;
    }
    const id = newWorldId();
    const base = w.meta.base;
    const meta: SyncMeta = base && ids.has(base.id) ? { ...w.meta, base: { ...base, id: ids.get(base.id)! } } : w.meta;
    if (!putSyncedWorld(id, { save: JSON.stringify(w.save), meta, thumb: w.thumb })) {
      res.why = 'storage';
      res.left++;
      continue;
    }
    if (w.id) ids.set(w.id, id);
    if (w.notes.length && !replaceNotes(id, w.notes)) res.notesLost = true;
    have.push({ id, save: w.save, draft });
    count++;
    res.added.push(id);
  }
  return res;
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 「我的世界」里点「全部存成文件」 */
export function downloadAll() {
  const b = bundleText();
  if (!b) return notify({ kind: 'error', text: '「我的世界」里还没有世界' });
  const name = bundleFileName();
  download(b.text, name);
  (window as unknown as { __wfBundle?: { name: string; count: number; bytes: number } }).__wfBundle = { name, count: b.count, bytes: new Blob([b.text]).size };
  notify({ kind: 'ok', dot: true, text: `${b.count} 个世界已存成一个文件`, more: [`${name}；以后点「打开存档文件」选它，这些世界都会回来`] });
}

/** 「打开存档文件」选的是「全部存成文件」存的文件:放回来、说一声,返回 true;不是这种文件 = false(按单个世界的存档读) */
export function openBundleText(text: string, fileName?: string): boolean {
  const r = parseBundle(text);
  if (!r) return false;
  if (!r.ok) {
    notify({ kind: 'error', text: fileName ? `打不开 ${fileName}` : '打不开这个文件', more: [r.error] });
    return true;
  }
  const { worlds, bad } = r.bundle;
  if (!worlds.length) {
    notify({ kind: 'error', text: fileName ? `打不开 ${fileName}` : '打不开这个文件', more: [bad ? `里面的 ${bad} 个世界都读不出来` : '这个文件里没有世界'] });
    return true;
  }
  const res = importBundle(r.bundle);
  const more: string[] = [];
  if (res.same) more.push(res.added.length ? `${res.same} 个原来就有，没重复放` : '');
  if (res.filled) more.push(`${res.filled} 个原来就有的补上了缺的 AI 写的东西或缩略图`);
  if (res.left) more.push(`还有 ${res.left} 个没放进去：${res.why === 'full' ? `「我的世界」最多存 ${MAX_WORLDS} 个世界，先删掉几个再打开一次` : '浏览器存储已满，先删掉几个世界再打开一次'}`);
  if (bad) more.push(`${bad} 个世界读不出来，跳过了`);
  if (res.notesLost) more.push('有的 AI 写的东西没能放回来（浏览器存储已满）');
  const lines = more.filter(Boolean);
  if (res.added.length) {
    notify({ kind: res.left || bad || res.notesLost ? 'warn' : 'ok', text: `已放回 ${res.added.length} 个世界`, more: lines });
  } else if (res.left) {
    notify({ kind: 'error', text: '没能放回来', more: lines });
  } else {
    notify({ kind: bad ? 'warn' : 'ok', text: '这些世界都已经在「我的世界」里了', more: lines });
  }
  return true;
}
