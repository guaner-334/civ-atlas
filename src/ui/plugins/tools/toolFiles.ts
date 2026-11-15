/**
 * 插件卡最上面网站的那一块:插件交来的文件等用的人点「保存」、插件请用的人选文件。
 * 下载只在用的人点「保存」的那一下做(浏览器只认用的人亲手点的)。纯状态,不碰 DOM。
 */
import { extOf, openRefusal, type OpenRequest, type PickedFile, type SaveOffer } from '../../../plugin/userFile';
import { createStore } from '../../createStore';
import { sizeText } from '../pluginWords';

export type FileSave = { phase: 'ask'; file: SaveOffer; replaced: boolean; done: (saved: boolean) => void } | { phase: 'saved'; name: string };

export type FileOpen = { phase: 'ask'; req: OpenRequest; bad: { why: 'type' | 'big'; name: string; size: number } | null; done: (f: PickedFile | null) => void } | { phase: 'given'; name: string; size: number };

export const fileStrip = createStore<{ save: FileSave | null; open: FileOpen | null }>({ save: null, open: null });

/** 存好了、交给它了:几秒后自己收起 */
export const DONE_MS = 4000;

function put(p: Partial<{ save: FileSave | null; open: FileOpen | null }>) {
  fileStrip.set({ ...fileStrip.get(), ...p });
}

function later(key: 'save' | 'open', v: FileSave | FileOpen) {
  setTimeout(() => {
    if (fileStrip.get()[key] === v) put({ [key]: null });
  }, DONE_MS);
}

/** 插件交来一个文件:出「保存」;signal 断了(换成新的一份、插件停了)就收起 */
export function askSave(file: SaveOffer & { replaced: boolean }, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let over = false;
    const ask: FileSave = {
      phase: 'ask',
      file: { name: file.name, mime: file.mime, kind: file.kind, bytes: file.bytes },
      replaced: file.replaced,
      done: (saved) => {
        if (over) return;
        over = true;
        if (fileStrip.get().save === ask) put({ save: null });
        resolve(saved);
      },
    };
    if (signal.aborted) return resolve(false);
    signal.addEventListener('abort', () => ask.done(false), { once: true });
    put({ save: ask });
  });
}

/** 用的人点了「保存」:download 在这一下里调 */
export function saveNow(download: (blob: Blob, name: string) => void): void {
  const s = fileStrip.get().save;
  if (s?.phase !== 'ask') return;
  download(new Blob([s.file.bytes],{ type: s.file.mime }), s.file.name);
  const saved: FileSave = { phase: 'saved', name: s.file.name };
  put({ save: saved });
  s.done(true);
  later('save', saved);
}

/** 用的人点了「不要」 */
export function skipSave(): void {
  const s = fileStrip.get().save;
  if (s?.phase === 'ask') s.done(false);
}

/** 插件请用的人选文件;signal 断了就收起 */
export function askOpen(req: OpenRequest, signal: AbortSignal): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    let over = false;
    const done = (f: PickedFile | null) => {
      if (over) return;
      over = true;
      const o = fileStrip.get().open;
      if (o?.phase === 'ask' && o.done === done) put({ open: null });
      resolve(f);
    };
    if (signal.aborted) return resolve(null);
    signal.addEventListener('abort', () => done(null), { once: true });
    put({ open: { phase: 'ask', req, bad: null, done } });
  });
}

/** 用的人在选文件框里选好了:不收、太大的不交给插件,留在这一块里说清楚、让他重选 */
export async function fileChosen(f: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<void> {
  const o = fileStrip.get().open;
  if (o?.phase !== 'ask') return;
  const why = openRefusal(o.req, f.name, f.size);
  if (why) return put({ open: { ...o, bad: { why, name: f.name, size: f.size } } });
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await f.arrayBuffer());
  } catch {
    // 读不出来:这一块原样留着,让人重选或「不给」(等的时候可能已经换了别的请求,不能拿旧的盖回去)
    return;
  }
  const now = fileStrip.get().open;
  if (now?.phase !== 'ask' || now.done !== o.done) return;
  const given: FileOpen = { phase: 'given', name: f.name, size: bytes.length };
  put({ open: given });
  o.done({ name: f.name, bytes });
  later('open', given);
}

/** 用的人点了「不给」,或者在选文件框里取消了 */
export function skipOpen(): void {
  const o = fileStrip.get().open;
  if (o?.phase === 'ask') o.done(null);
}

/** 插件卡关掉了:这一块一起拿掉(还在问的当用的人不要) */
export function clearFiles(): void {
  skipSave();
  skipOpen();
  put({ save: null, open: null });
}

// ---------------------------------------------------------------------------
// 这一块上的字

export interface StripText {
  tone: 'ask' | 'done' | 'bad';
  icon: 'download' | 'file' | 'check' | 'warn';
  title: string;
  small: string;
  /** 两个按钮:左边收起、右边办 */
  acts?: [string, string];
}

export const fileSizeText = (n: number): string => sizeText(n).replace('.0 MB', ' MB');

const SHEETS = ['xlsx', 'xls', 'ods', 'numbers', 'et'];

/** phone = 手机布局(说存到手机上) */
export function saveText(s: FileSave, phone = false): StripText {
  if (s.phase === 'saved') return { tone: 'done', icon: 'check', title: '存好了', small: `${s.name}，在浏览器的「下载」里。` };
  const f = s.file;
  const head = `${f.name}，${f.kind}，${fileSizeText(f.bytes.length)}。`;
  if (s.replaced) return { tone: 'ask', icon: 'download', title: '它换了一份新的', small: `${head}上一份没存，换成这一份了。`, acts: ['不要', '保存'] };
  return { tone: 'ask', icon: 'download', title: '它准备好了一个文件', small: `${head}点「保存」才会存到你的${phone ? '手机' : '电脑'}上。`, acts: ['不要', '保存'] };
}

export function openText(o: FileOpen): StripText {
  if (o.phase === 'given') return { tone: 'done', icon: 'check', title: '交给它了', small: `${o.name}，${fileSizeText(o.size)}。` };
  const exts = o.req.accept.map((e) => `.${e}`).join('、');
  const max = fileSizeText(o.req.max);
  if (o.bad?.why === 'type') {
    const sheet = o.req.accept.includes('csv') && SHEETS.includes(extOf(o.bad.name)) ? '可以在表格软件里另存成 .csv 再选。' : '';
    return { tone: 'bad', icon: 'warn', title: `「${o.bad.name}」它不收`, small: `只收 ${exts}。${sheet}`, acts: ['不给', '重新选…'] };
  }
  if (o.bad?.why === 'big') return { tone: 'bad', icon: 'warn', title: `「${o.bad.name}」太大了`, small: `它最多收 ${max}，这个有 ${fileSizeText(o.bad.size)}。`, acts: ['不给', '重新选…'] };
  return { tone: 'ask', icon: 'file', title: '它请你选一个文件', small: `${exts ? `只收 ${exts}，` : ''}最大 ${max}。它只拿得到你选的这一个。`, acts: ['不给', '选文件…'] };
}
