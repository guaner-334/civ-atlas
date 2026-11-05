/**
 * 「存成文件」「全部存成文件」「打开存档文件」的界面这一层:提示条、进度、取消、出错时怎么说、手机上怎么交到手上。
 * 活都在 worldFiles.ts;这个文件用到才下载(worldFileLazy.ts),首页不带。
 *
 * 一次只做一件。提示条同一时间只有一条:进度原地更新,不盖住后来的提示(正存着全部时打开一个世界,生成的进度在上面,
 * 生成完露出存文件的进度和「取消」);正在做时又点了,露出正在做的那条,不另开一件。
 * 要等的才出提示条:存过 1 秒、核对过 0.5 秒,快的不闪。
 *
 * 文件交到手上:电脑上直接下载。手机、平板上打包是后台做的,做完浏览器可能不让自动下载,所以提示条上点一下「存到手机」:
 * 能分享文件的(iPhone)出系统的分享菜单,别的(安卓 Chrome 只肯分享图片、视频这类文件)直接下载。
 * 没有内容可存的世界(没建完的、更旧的版本又没有原件的)存成 .json(只带配方),旧的文件照旧能打开。
 * 没存进「我的世界」的、存储满了存不进去的:页面里有,照样存下整个世界。
 * 打不开时的字和打开旧世界用同一套(openTrouble.ts)。
 */
import { editCount, parseSave, saveFileName, saveText, type SaveFile } from '../gen/savefile';
import { importBundle, parseBundle } from './bundle';
import { isCoarse, isNarrow } from './device';
import { openWorldById } from './newCivAction';
import { FILE_TROUBLE, newerNotice } from './openTrouble';
import { holdFileTrouble, holdOpenNote, type OpenNote } from './openNote';
import { MAX_WORLDS, currentSave, currentUnsaved, currentWorld, importSave, isStored, listWorlds, loadWorld, markFromFile, notify, persistent, savesChanged, storedCount } from './saveStore';
import { aboutSize, sizeText } from './sizeWords';
import { inSmallWindow, noteFileSaved, saveMark } from './spaceFacts';
import { clearToast, getToast, peekToast, showToast, updateToast, type ToastAction, type ToastInput } from './toastStore';
import {
  checkTimeout,
  knownWorldFileBytes,
  lookWorldFile,
  lookWorldFiles,
  openWorldFiles,
  placeWorldFile,
  saveAllWorldFiles,
  saveWorldFile,
  worldFileBytes,
  type KeepTrouble,
  type OpenedWorldFiles,
  type PickedFile,
  type SaveTrouble,
  type SavedBackup,
  type WorldFileProgress,
} from './worldFiles';
import { saveContentAgain } from './worldStore';

export { aboutSize, sizeText };

const TOAST = 'world-file';
/** 存文件要等多久才出提示条(毫秒) */
const SAVE_WAIT_MS = 1000;
/** 打开文件核对要等多久才出提示条(毫秒) */
const OPEN_WAIT_MS = 500;
/** 这么大的文件存到手机时多说一句「不花流量」 */
const PHONE_BIG_BYTES = 50e6;
/** 旧的文件(文字)最大多少字节才读:再大的不是这个网站存的,不把它读成一个几 GB 的字符串 */
const OLD_FILE_MAX_BYTES = 200e6;

const SEND_HINT = '发给别人时，让对方到这个网站点「打开存档文件」选它';
const RECIPE_ONLY = '只带上了配方，打开时要重新算';
const RECIPE_SAVED = '已存成配方文件';
const RECIPE_MORE = '只有几 KB。对方打开时重新长一遍，可能和你看到的不一样';

/** 存档菜单、卡片菜单上写的大小(还没有内容的 = null) */
export async function fileSizeNote(id: string): Promise<string | null> {
  const bytes = await worldFileBytes(id);
  return bytes === null ? null : aboutSize(bytes);
}

// ---------------------------------------------------------------------------
// 提示条

let busy = false;
/** 正在等着出现、正在显示的进度条 */
let liveBar: { stop(): void } | null = null;

/** 开始一件事;正在做别的就露出那一条,不开始 */
function begin(): boolean {
  if (!busy) {
    busy = true;
    return true;
  }
  const t = peekToast(TOAST);
  if (t) showToast(t);
  return false;
}

/** 正在做的那一条:过一会儿才出现;paint 现画 */
function progressBar(wait: number, paint: () => ToastInput) {
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    showToast({ ...paint(), id: TOAST });
  }, wait);
  const bar = {
    update() {
      if (shown) updateToast(TOAST, paint());
    },
    stop() {
      clearTimeout(timer);
      if (shown) clearToast(TOAST);
      shown = false;
    },
  };
  liveBar = bar;
  return bar;
}

/** 底层说了不抛错,万一还是出了事(比如读浏览器存储时):说一声,不让「正在做」一直留着、以后什么都点不动 */
async function guarded(first: string, f: () => Promise<void>): Promise<void> {
  try {
    await f();
  } catch {
    busy = false;
    liveBar?.stop();
    say({ kind: 'error', text: first, more: ['出错了。世界都还在，再试一次'] });
  }
}

/** 做完了说一句。别的事的进度还在上面时(在生成世界)这一句不自己收,不然可能一眼都看不到 */
function say(t: ToastInput) {
  clearToast(TOAST);
  const under = t.kind === 'ok' && getToast()?.kind === 'progress';
  showToast({ ...t, id: TOAST, ...(under ? { ttl: 0, dismissible: true } : {}) });
}

// ---------------------------------------------------------------------------
// 文件交到手上

function download(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 手机、平板:提示条上点一下才存 */
const tapToSave = () => isNarrow() || isCoarse();

/** 存到手机:shared = 给了分享菜单;cancelled = 分享菜单里点了取消(留着提示条,还能再点);downloaded = 直接下载了 */
async function saveOnPhone(file: Blob, name: string): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const shareable = typeof File !== 'undefined' ? new File([file], name, { type: file.type || 'application/octet-stream' }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (shareable && nav.canShare?.({ files: [shareable] })) {
    try {
      await navigator.share({ files: [shareable] });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  download(file, name);
  return 'downloaded';
}

/** 微信、QQ 里的小窗口存不了文件:说一声,不白打包 */
function noFilesHere(): boolean {
  if (!inSmallWindow()) return false;
  say({ kind: 'warn', text: '这里存不了文件', more: ['微信、QQ 里的小窗口不让存'] });
  return true;
}

/** 开始存时就取:存的这一会儿又改了,算之后改过 */
function marksOf(ids: readonly string[]): { id: string; mark: string }[] {
  return ids.flatMap((id) => {
    const save = loadWorld(id)?.save ?? (currentWorld()?.id === id ? currentSave() : null);
    return save ? [{ id, mark: saveMark(save) }] : [];
  });
}

type Marks = ReturnType<typeof marksOf>;
const noteGiven = (marks: Marks) => noteFileSaved(marks, (id) => isStored(id) || currentWorld()?.id === id);

/** tail:小字后半句;warn:提示条不自己收;done:交到手上以后说这一句;marks:这个文件里的世界 */
function handOver(file: Blob, name: string, o: { tail?: string; warn?: boolean; done?: ToastInput; marks?: Marks } = {}) {
  const size = sizeText(file.size);
  const tail = o.tail ?? SEND_HINT;
  const kind = o.warn ? 'warn' : 'ok';
  if (!tapToSave()) {
    download(file, name);
    noteGiven(o.marks ?? []);
    say(o.done ?? { kind, text: '已存成文件', more: [`${name}，${size}。${tail}`] });
    return;
  }
  say({
    kind: 'ok',
    dismissible: true,
    ttl: 0,
    text: `文件准备好了，${size}`,
    more: [o.tail ?? (file.size > PHONE_BIG_BYTES ? '存到手机不花流量，发给别人才花' : name)],
    action: {
      label: '存到手机',
      primary: true,
      act: 'save-to-phone',
      onClick: () =>
        void saveOnPhone(file, name).then((r) => {
          if (r === 'cancelled') return;
          noteGiven(o.marks ?? []);
          if (o.done) say(o.done);
          else if (r === 'shared') clearToast(TOAST);
          else say({ kind, text: '已存成文件', more: [`在手机的「下载」里，${size}。${tail}`] });
        }),
    },
  });
}

/** 调试 / 冒烟测试用:最近一次"存成文件" */
function noteSaved(name: string, bytes: number, save: SaveFile | undefined) {
  (window as unknown as { __wfSave?: { name: string; bytes: number; count: number } }).__wfSave = { name, bytes, count: save ? editCount(save.edits) : 0 };
}

function behindTail(kind: SaveTrouble | undefined): string {
  if (kind === 'memory') return '内存不够，刚才的改动没带上。关掉别的页面再存一次';
  if (kind === 'full') return '里面是上次存下的样子，刚才的改动没带上';
  return '刚才的改动还没算完，没带上';
}

function recipeBlob(save: SaveFile) {
  const name = saveFileName(save);
  const file = new Blob([saveText(save)], { type: 'application/json;charset=utf-8' });
  noteSaved(name, file.size, save);
  return { name, file };
}

/** 存成 .json(只带配方)。tail 不给 = 说只带上了配方 */
export function saveRecipeFile(save: SaveFile, tail: string = RECIPE_ONLY, marks?: Marks) {
  const { name, file } = recipeBlob(save);
  handOver(file, name, { tail, warn: true, ...(marks ? { marks } : {}) });
}

function saveOnlyRecipe(save: SaveFile, marks?: Marks) {
  const { name, file } = recipeBlob(save);
  handOver(file, name, { tail: RECIPE_MORE, done: { kind: 'ok', text: RECIPE_SAVED, more: [RECIPE_MORE] }, ...(marks ? { marks } : {}) });
}

export function saveWorldRecipe(id: string) {
  if (noFilesHere()) return;
  const save = recipeOf(id);
  if (!save) return notify({ kind: 'error', text: '打不开这个存档', more: ['可能已在别的页面里删掉了'] });
  saveOnlyRecipe(save);
}

/** 手机提示条放不下两个按钮,存完才放「去旧版网站」 */
export function saveForOldSite(save: SaveFile, site: string) {
  if (noFilesHere()) return;
  const { name, file } = recipeBlob(save);
  const hint = '到旧版网站点「打开存档文件」选它';
  handOver(file, name, {
    tail: RECIPE_MORE,
    done: { kind: 'ok', ttl: 0, dismissible: true, text: RECIPE_SAVED, more: [`${name}。${hint}`], action: { label: '去旧版网站', act: 'go-old-site', onClick: () => void window.open(site, '_blank', 'noopener') } },
  });
}

export function saveAgain(id: string): Promise<void> {
  return guarded('还是没能存下来', async () => {
    if (!begin()) return;
    const title = loadWorld(id)?.save.title || '这个世界';
    showToast({ id: TOAST, kind: 'progress', text: `正在存「${title}」` });
    const ok = await saveContentAgain(id);
    busy = false;
    say(ok ? { kind: 'ok', text: `「${title}」存好了`, more: ['以后网站更新也不会变'] } : { kind: 'warn', text: '还是没能存下来', more: ['世界本身没事，现在还能打开。网站下次更新时会再试'] });
    savesChanged();
  });
}

// ---------------------------------------------------------------------------
// 一个世界存成文件

const cancelAct = (onClick: () => void): ToastAction => ({ label: '取消', act: 'world-file-cancel', onClick });

/** 这个世界最新的配方:正开着的用页面里的 */
const recipeOf = (id: string): SaveFile | null => (currentWorld()?.id === id ? currentSave() : (loadWorld(id)?.save ?? null));

export function saveWorldToFile(id: string): Promise<void> {
  return guarded('没能存成文件', () => saveOne(id));
}

async function saveOne(id: string): Promise<void> {
  if (noFilesHere() || !begin()) return;
  const title = (loadWorld(id)?.save.title ?? currentWorld()?.title) || '这个世界';
  const marks = marksOf([id]);
  let cancelled = false;
  let share: number | undefined;
  const bar = progressBar(SAVE_WAIT_MS, () => {
    const known = knownWorldFileBytes(id);
    return {
      kind: 'progress',
      text: '正在存成文件',
      more: [known !== null ? `「${title}」有 ${sizeText(known)}，别关页面` : '别关页面'],
      ...(share !== undefined ? { progress: share } : {}),
      action: cancelAct(() => {
        cancelled = true;
        busy = false;
        bar.stop();
        say({ kind: 'ok', text: '已取消，没有存下文件' });
      }),
    };
  });
  const r = await saveWorldFile(id, {
    onProgress: (p) => {
      share = p;
      bar.update();
    },
  });
  if (cancelled) return;
  busy = false;
  bar.stop();
  const again = { label: '再试一次', act: 'world-file-retry', onClick: () => void saveWorldToFile(id) };
  if (!r.ok) {
    if (r.kind === 'memory') return say({ kind: 'error', text: '没能存成文件', more: ['内存不够，世界都还在。关掉别的页面再试'], action: again });
    if (r.kind === 'timeout' || r.kind === 'crash') return say({ kind: 'error', text: '没能存成文件', more: ['存的时候出错了，世界都还在，再试一次'], action: again });
    // 没有内容可存、存不进仓库:配方带得走,世界不会丢
    const save = recipeOf(id);
    if (!save) return notify({ kind: 'error', text: '打不开这个存档', more: ['可能已在别的页面里删掉了'] });
    return r.kind === 'draft' ? saveRecipeFile(save, RECIPE_ONLY, marks) : saveOnlyRecipe(save, marks);
  }
  // 刚才的改动写不进浏览器(存储满了),页面里又打不成文件:页面里的改动只有配方带得走
  if (r.stale && currentWorld()?.id === id && currentUnsaved()) {
    const save = currentSave();
    if (save) return saveRecipeFile(save, RECIPE_ONLY, marks);
  }
  noteSaved(r.name, r.file.size, recipeOf(id) ?? undefined);
  // 落后的文件没带上现在的样子,不算存过
  handOver(r.file, r.name, r.stale ? { tail: behindTail(r.behind), warn: true } : { marks });
}

/** 正开着的世界存成文件(存档菜单、存储满了时提示条上的「存成文件」) */
export function saveCurrentToFile(): Promise<void> {
  const cur = currentWorld();
  return cur ? saveWorldToFile(cur.id) : Promise.resolve();
}

// ---------------------------------------------------------------------------
// 全部世界存成文件

/** 存好了要多说的 */
function allWarnings(r: SavedBackup): string[] {
  const more: string[] = [];
  if (r.recipeOnly.length) more.push(`其中 ${r.recipeOnly.length} 个${RECIPE_ONLY}`);
  if (r.behind?.length) more.push(`其中 ${r.behind.length} 个里面是上次存下的样子，刚才的改动打开时要重新算`);
  if (r.notesUnread?.length) more.push(`其中 ${r.notesUnread.length} 个世界的 AI 写的东西这次没读出来，文件里可能不全。刷新页面再存一次`);
  if (r.dropped) more.push('有的世界 AI 写的东西太多，放不下，没带上');
  if (r.olderLeft.length) more.push(`其中 ${r.olderLeft.length} 个留着的旧版本太大，没带上，世界本身带上了`);
  return more;
}

function handOverAll(r: SavedBackup, marks: Marks) {
  const extra = allWarnings(r);
  const warn = extra.length > 0;
  const total = sizeText(r.bytes);
  const kind = warn ? ('warn' as const) : ('ok' as const);
  const { files, count } = r;
  if (files.length === 1) {
    const f = files[0];
    const saved = (where: string): ToastInput => ({ kind, ...(warn ? {} : { dot: true }), text: `${count} 个世界已存成一个文件`, more: [`${where}，${total}。以后点「打开存档文件」选它，这些世界都会回来`, ...extra] });
    if (!tapToSave()) {
      download(f.file, f.name);
      noteGiven(marks);
      return say(saved(f.name));
    }
    return say({
      kind: 'ok',
      dismissible: true,
      ttl: 0,
      text: `文件准备好了，${total}`,
      more: [`${count} 个世界。以后点「打开存档文件」选它，都会回来`, ...extra],
      action: {
        label: '存到手机',
        primary: true,
        act: 'save-to-phone',
        onClick: () =>
          void saveOnPhone(f.file, f.name).then((got) => {
            if (got !== 'cancelled') noteGiven(marks);
            if (got === 'shared') clearToast(TOAST);
            else if (got === 'downloaded') say(saved('在手机的「下载」里'));
          }),
      },
    });
  }
  // 一个文件放不下:下一个要点一下才存,不然浏览器会拦连续下载
  const n = files.length;
  const split = `一个文件放不下，分成 ${n} 个。打开时都选上`;
  const after = (i: number) => {
    const left = n - i - 1;
    if (!left) noteGiven(marks);
    if (!left) return say({ kind, ...(warn ? {} : { dot: true }), text: `${count} 个世界已存成 ${n} 个文件`, more: [`一共 ${total}。以后点「打开存档文件」都选上，这些世界都会回来`, ...extra] });
    say({
      kind: 'ok',
      dismissible: true,
      ttl: 0,
      text: `第 ${i + 1} 个文件存好了，还有 ${left} 个`,
      more: [`一共 ${total}，${split}`, ...extra],
      action: { label: '存下一个', primary: true, act: 'save-next', onClick: () => give(i + 1) },
    });
  };
  const give = (i: number) => {
    const f = files[i];
    if (!tapToSave()) {
      download(f.file, f.name);
      return after(i);
    }
    void saveOnPhone(f.file, f.name).then((got) => {
      if (got !== 'cancelled') after(i);
    });
  };
  if (!tapToSave()) return give(0);
  say({
    kind: 'ok',
    dismissible: true,
    ttl: 0,
    text: `文件准备好了，${total}`,
    more: [`${count} 个世界，${split}`, ...extra],
    action: { label: '存到手机', primary: true, act: 'save-to-phone', onClick: () => give(0) },
  });
}

export function saveAllToFile(): Promise<void> {
  return guarded('没能存成文件', saveAll);
}

async function saveAll(): Promise<void> {
  if (noFilesHere() || !begin()) return;
  const ac = new AbortController();
  let cancelled = false;
  const cur = currentWorld();
  const marks = marksOf([...listWorlds().map((w) => w.id), ...(cur && !isStored(cur.id) && currentUnsaved() ? [cur.id] : [])]);
  const now: { p: WorldFileProgress | null } = { p: null };
  const bar = progressBar(SAVE_WAIT_MS, () => {
    const { p } = now;
    // 一共多少字节要读完才知道,先按已经存的算个大概
    const guess = p && p.done > 0 && p.bytes > 0 ? `一共${aboutSize((p.bytes / p.done) * p.total)}，` : '';
    return {
      kind: 'progress',
      text: p ? `正在存成文件：第 ${Math.min(p.done + 1, p.total)} / ${p.total} 个` : '正在存成文件',
      more: [`${guess}别关页面`],
      progress: p && p.total ? p.done / p.total : 0,
      action: cancelAct(() => {
        cancelled = true;
        busy = false;
        ac.abort();
        bar.stop();
        say({ kind: 'ok', text: '已取消，没有存下文件' });
      }),
    };
  });
  // 检查脚本用:把一个文件的上限调小,好试分成几个文件
  const maxBytes = (window as unknown as { __wfBackupMaxBytes?: number }).__wfBackupMaxBytes;
  const r = await saveAllWorldFiles({
    ...(maxBytes ? { maxBytes } : {}),
    signal: ac.signal,
    onProgress: (p) => {
      now.p = p;
      bar.update();
    },
  });
  if (cancelled) return;
  busy = false;
  bar.stop();
  if (r.ok) return handOverAll(r, marks);
  if (r.kind === 'cancelled') return say({ kind: 'ok', text: '已取消，没有存下文件' });
  if (r.kind === 'missing') return notify({ kind: 'error', text: '「我的世界」里还没有世界' });
  const where = now.p?.total ? `存到第 ${Math.min(now.p.done + 1, now.p.total)} 个时` : '';
  const again = { label: '再试一次', act: 'world-file-retry', onClick: () => void saveAllToFile() };
  if (r.kind === 'full') return say({ kind: 'error', text: '没能存成文件', more: [`${where}空间不够了。世界都还在，腾出地方再试`], action: again });
  if (r.kind === 'memory') return say({ kind: 'error', text: '没能存成文件', more: [`${where}内存不够了。世界都还在，关掉别的页面再试`], action: again });
  say({ kind: 'error', text: '没能存成文件', more: ['存的时候出错了，世界都还在，再试一次'], action: again });
}

// ---------------------------------------------------------------------------
// 打开文件

/** 文明与地图-塞雷尼亚.civworld → 塞雷尼亚;别人改过名字的 = null */
const worldNameOf = (fileName: string): string | null => /^文明与地图-(.+)\.civworld$/.exec(fileName)?.[1] ?? null;

/** 打不开一个文件怎么说。文件是好的、说不准的都不说坏了,不然人可能把好文件删掉 */
function sayCantOpen(kind: KeepTrouble, name: string, o: { retry?: () => void; seconds?: number } = {}) {
  const head = `打不开 ${name}`;
  const again = o.retry && { label: '再试一次', act: 'world-file-retry', onClick: o.retry };
  if (kind === 'newer') {
    const world = worldNameOf(name);
    return say({ kind: 'error', text: world ? `打不开「${world}」` : head, ...newerNotice('file') });
  }
  if (kind === 'broken') return say({ kind: 'error', text: head, more: [FILE_TROUBLE] });
  if (kind === 'readonly') return say({ kind: 'error', text: head, more: ['文件是好的，只是这一版网站读不了它。网站没有动它，先别删'] });
  if (kind === 'memory') return say({ kind: 'error', text: head, more: ['内存不够，读不下这个世界。文件没有坏，关掉别的页面再试'], ...(again ? { action: again } : {}) });
  if (kind === 'timeout') return say({ kind: 'error', text: head, more: [`核对了 ${o.seconds ?? 20} 秒还没完，先停下了。不一定是文件的问题，先别删`], ...(again ? { action: again } : {}) });
  say({ kind: 'error', text: head, more: ['读的时候出错了。不一定是文件的问题，先别删'], ...(again ? { action: again } : {}) });
}

/** 打开一个世界文件:核对、放进「我的世界」、打开它。tries:再试第几次(核对的时限跟着放宽) */
async function openOneWorld(file: File, onText: (text: string, fileName: string) => void, tries = 0): Promise<void> {
  if (!begin()) return;
  const name = file.name;
  const retry = () => void openOneWorld(file, onText, tries + 1);
  let cancelled = false;
  let placing = false;
  const bar = progressBar(OPEN_WAIT_MS, () => ({
    kind: 'progress',
    text: `正在打开 ${name}`,
    more: [`这个世界有 ${sizeText(file.size)}，要核对一会儿`],
    // 存进本机时不能停:只差一步,停了说不清存没存
    ...(placing
      ? { actions: [] }
      : {
          action: cancelAct(() => {
            cancelled = true;
            busy = false;
            bar.stop();
          }),
        }),
  }));
  const timeoutMs = checkTimeout(file.size) * 2 ** tries;
  const looked = await lookWorldFile(file, { timeoutMs });
  if (cancelled) return;
  if (!looked.ok) {
    busy = false;
    bar.stop();
    return sayCantOpen(looked.kind, name, { retry, seconds: Math.round(timeoutMs / 1000) });
  }
  placing = true;
  bar.update();
  const placed = await placeWorldFile(looked);
  busy = false;
  bar.stop();
  if (!placed.ok) {
    // 浏览器存不下:世界只打开、不存(文字那条路;本机已有的世界不动),提示条上说没存进去、文件先别删
    if (placed.kind === 'full' || placed.kind === 'count' || placed.kind === 'unavailable') {
      const why = placed.kind === 'full' ? '浏览器存储已满' : placed.kind === 'count' ? `「我的世界」最多存 ${MAX_WORLDS} 个` : '浏览器不让网页存数据';
      holdFileTrouble(`${why}，这个世界没存进去，这个文件先别删`);
      return onText(JSON.stringify(looked.facts.save), name);
    }
    return sayCantOpen(placed.kind, name, { retry });
  }
  // 内容一样的:打开的是本机那个,名字可能带着「(二)」
  const title = (placed.status === 'same' ? loadWorld(placed.id)?.save.title : placed.title) || `种子 ${looked.seed}`;
  let note: OpenNote;
  if (placed.status === 'copied') {
    const of = placed.of;
    note = {
      kind: 'ok',
      text: `已打开「${title}」`,
      more: ['内容和原来的不一样，另存了一份，原来的没动'],
      action: { label: '打开原来的', act: 'open-original', onClick: () => (clearToast('save'), openWorldById(of)) },
    };
  } else if (placed.status === 'same' || placed.status === 'different') {
    note = { kind: 'ok', text: `「${title}」已经在「我的世界」里了`, more: ['和文件内容一样，打开的就是它'] };
  } else {
    note = { kind: 'ok', text: `已打开存档「${title}」`, more: ['已存进「我的世界」，下次不用再选文件'] };
  }
  noteGiven(marksOf([placed.id]));
  if (placed.status === 'added' || placed.status === 'copied') {
    markFromFile(placed.id);
    if (placed.kept.memOnly) note = { ...note, kind: 'warn', more: ['浏览器不让网页存数据，世界只留在这个页面里，这个文件先别删'] };
    else if (placed.kept.notesLost) note = { ...note, kind: 'warn', more: ['有的 AI 写的东西没能放回来（浏览器存储已满），这个文件先别删'] };
  }
  // 读文件时的提示(AI 写的东西读不进来这类)要紧:小字只有两行,放它
  if (looked.warnings.length) note = { ...note, kind: 'warn', more: looked.warnings };
  holdOpenNote(placed.id, note);
  openWorldById(placed.id);
}

/** 旧的文件(文字):一个就走原来那条路,打开它 */
async function openOldFile(file: File, onText: (text: string, fileName: string) => void) {
  // 叫 .civworld、开头却不对:存的时候断了,或者被改过
  if (/\.civworld$/i.test(file.name)) return sayCantOpen('broken', file.name);
  if (file.size > OLD_FILE_MAX_BYTES) return notify({ kind: 'error', text: `打不开 ${file.name}`, more: ['不是「文明与地图」的存档'] });
  try {
    onText(await file.text(), file.name);
  } catch {
    notify({ kind: 'error', text: `打不开 ${file.name}`, more: ['读不了这个文件'] });
  }
}

/** 一起选的旧文件:都放进「我的世界」;取消了就停 */
async function importOldFiles(picks: readonly PickedFile[], signal: AbortSignal) {
  const out = { added: [] as string[], same: 0, bad: 0, left: 0, notesLost: false };
  for (const p of picks) {
    if (signal.aborted) break;
    try {
      if (p.file.size > OLD_FILE_MAX_BYTES) {
        out.bad++;
        continue;
      }
      const text = await p.file.text();
      const b = parseBundle(text);
      if (b) {
        if (!b.ok) {
          out.bad++;
          continue;
        }
        const res = importBundle(b.bundle);
        out.added.push(...res.added);
        out.same += res.same;
        out.left += res.left;
        out.bad += b.bundle.bad;
        if (res.notesLost) out.notesLost = true;
        continue;
      }
      const s = parseSave(text);
      if (!s.ok) {
        out.bad++;
        continue;
      }
      const before = storedCount();
      const id = importSave(s.save);
      if (!id) out.left++;
      else if (storedCount() > before) out.added.push(id);
      else out.same++;
    } catch {
      out.bad++;
    }
  }
  return out;
}

/** 放回好了怎么说 */
function sayRestored(r: OpenedWorldFiles, old: Awaited<ReturnType<typeof importOldFiles>>, firstName: string) {
  const added = r.added.length + r.copied.length + (r.recipes?.added.length ?? 0) + old.added.length;
  const same = r.same.length + (r.recipes?.same ?? 0) + old.same;
  // 只少了几份旧修订的世界是放回来了的,不算跳过
  const skipped = r.skipped.filter((s) => !s.message.includes('旧修订'));
  const noRoom = skipped.filter((s) => s.kind === 'full' || s.kind === 'count' || s.kind === 'unavailable');
  const bad = skipped.filter((s) => !noRoom.includes(s));
  const left = noRoom.length + (r.recipes?.left ?? 0) + old.left;
  const byCount = noRoom.some((s) => s.kind === 'count') || r.recipes?.why === 'full' || storedCount() >= MAX_WORLDS;
  const badN = bad.length + old.bad;
  if (r.cancelled) return say({ kind: 'ok', text: `已放回 ${added} 个世界`, more: ['剩下的没有放'] });
  if (!added && !same && !left) {
    // 一个都没读出来:一个文件的照那个文件的情况说(比软件新、坏了……)
    const first = bad[0];
    if (first && bad.every((s) => s.kind === first.kind)) return sayCantOpen(first.kind, firstName);
    return say({ kind: 'error', text: `打不开 ${firstName}`, more: [FILE_TROUBLE] });
  }
  const notes: string[] = [];
  // 旧文件放回来的和世界文件放回来的一样:浏览器不让存就只留在页面里
  const memOnly = r.memOnly || (old.added.length > 0 && !persistent());
  const notesLost = r.notesLost.length > 0 || !!r.recipes?.notesLost || old.notesLost;
  if (memOnly) notes.push('浏览器不让网页存数据：放回来的世界只留在这个页面里，关掉就没了，这个文件先别删');
  if (r.copied.length) notes.push(`其中 ${r.copied.length} 个和原来的内容不一样，另存成了新的`);
  if (same) notes.push(`${same} 个原来就有，没重复放`);
  if (badN) notes.push(`${badN} 个读不出来，跳过了`);
  if (left) notes.push(`还有 ${left} 个没放进去：${byCount ? `「我的世界」最多存 ${MAX_WORLDS} 个世界，先删掉几个再打开一次` : '浏览器存储已满，先删掉几个世界再打开一次'}`);
  // 世界本身放回来了,留着的旧版本没有:文件里还带着,先别删
  const olderLost = r.skipped.length - skipped.length + r.same.filter((s) => s.olderMissing).length;
  if (olderLost) notes.push(`${olderLost} 个世界留着的旧版本没放回来，这个文件先别删`);
  for (const s of r.sets) if (s.missing.length) notes.push(`分成 ${s.parts} 个文件的还差第 ${s.missing.join('、')} 个，一起选上再打开一次`);
  if (r.cut) notes.push('有个文件没存完整，读得到的都放回了');
  if (notesLost) notes.push('有的 AI 写的东西没能放回来（浏览器存储已满）');
  const unread = r.notesUnread?.length ?? 0;
  if (unread) notes.push(`${unread} 个世界的 AI 写的东西这次没读进来。世界不受影响，文件先别删`);
  const trouble = badN > 0 || left > 0 || olderLost > 0 || r.cut || memOnly || notesLost || unread > 0 || r.sets.some((s) => s.missing.length > 0);
  if (added) return say({ kind: trouble ? 'warn' : 'ok', text: `已放回 ${added} 个世界`, more: notes });
  if (left) return say({ kind: 'error', text: '没能放回来', more: notes });
  say({ kind: trouble ? 'warn' : 'ok', text: '这些世界都已经在「我的世界」里了', more: notes.filter((x) => !x.endsWith('没重复放')) });
}

/** 放回全部世界的文件(一起选的几个也走这里) */
async function restoreFiles(picks: readonly PickedFile[], firstName: string): Promise<void> {
  if (!begin()) return;
  const ac = new AbortController();
  const now: { p: WorldFileProgress | null } = { p: null };
  const bar = progressBar(SAVE_WAIT_MS, () => {
    const { p } = now;
    return {
      kind: 'progress',
      text: p ? `正在放回世界：第 ${Math.min(p.done + 1, p.total)} / ${p.total} 个` : '正在放回世界',
      more: ['取消的话，已放回的留着'],
      progress: p && p.total ? p.done / p.total : 0,
      action: cancelAct(() => ac.abort()),
    };
  });
  const r = await openWorldFiles(
    picks.filter((p) => p.kind !== 'other').map((p) => p.file),
    {
      signal: ac.signal,
      onProgress: (p) => {
        now.p = p;
        bar.update();
      },
    },
  );
  const old = await importOldFiles(
    picks.filter((p) => p.kind === 'other'),
    ac.signal,
  );
  busy = false;
  bar.stop();
  const placed = [...r.added.map((w) => w.id), ...r.copied.map((w) => w.id), ...(r.recipes?.added ?? []), ...old.added];
  for (const id of placed) markFromFile(id);
  noteGiven(marksOf([...placed, ...r.same.map((w) => w.id)]));
  sayRestored(r, old, firstName);
}

/** 选好的、拖进来的文件。onText:旧的文件(文字)走原来那条路:放进「我的世界」、打开(App 接着做) */
export function openPickedFiles(files: readonly File[], onText: (text: string, fileName: string) => void): Promise<void> {
  const first = files[0];
  if (!first) return Promise.resolve();
  return guarded(`打不开 ${first.name}`, async () => {
    const { files: picks } = await lookWorldFiles(files);
    if (picks.length === 1 && picks[0].kind === 'other') return openOldFile(first, onText);
    if (picks.length === 1 && picks[0].kind === 'world') return openOneWorld(first, onText);
    return restoreFiles(picks, first.name);
  });
}
