/**
 * 主线程这边的世界仓库(../worldVault.ts):什么时候存、存哪个世界、现有的世界怎么转进来。
 *
 * 现在打开世界还是走旧的路(saveStore 的存档、resultStore 的原件),这里只是多存一份。所以这里任何一步出错都只记下来、不往外抛,
 * 不提示,也不碰存档和原件:旧的存档和原件怎么写、怎么读,和没有这个文件时一模一样。字节全程在后台线程里,主线程只发消息。
 *
 * 什么时候存:
 * - 推完、改完:生成世界的线程把这次的内容打好交回来(offerWorldParts),对得上这个世界存着的存档才存,对不上的先放着(和原件同样的规矩)。
 *   块按内容存,重推只会写变了的块;逐年推演不每步都存(线程那边停够了才打),页面藏起来、要关时叫线程马上打(packNow)
 * - 只改了配方以外的东西(改名、改旗、换投影、AI 写了正文、换了封面):停 LIGHT_DELAY 毫秒写一份新清单,只有作者内容、封面变了才写块。
 *   换世界、页面藏起来、要关时马上写。配方变了(历史要重推)的不写:那是待完成的修改,等推完。
 *   没来得及写的(关得太快、在「我的世界」里改的别的世界),下次打开转存那一遍会补上
 *
 * 待完成的修改:存着的修订在仓库里,配方草稿就是存档(saveStore),两边分开放。崩了以后拿两边比(pendingEdit、pendingOf)就知道有没有没推完的修改。
 *
 * 把现有的世界转进来(startConversions):打开页面过一会儿在后台一个一个转,一次一个、一个线程转一个。
 * - 有原件的直接转;没有原件但是当前版本建的,电脑上算一遍,手机上不算(打开时自然就存了);没有原件的更旧版本只记下来(old),不转
 * - 用的人一开始推演就关掉线程让路(写到一半的不算数),闲下来再从这个世界重来;关了页面下次接着转(转完的不再转)
 * - 转失败了记下(failed),这一版软件不再试;转的时候页面崩了(下次打开时还有 CONVERTING 这条记录)也算失败,不然每次打开都崩
 * - 几个标签页同时开着,只有一个转(navigator.locks)
 *
 * 删世界(maintain):只认 saveStore 的 trashMarks,用的人删的、又过了 TRASH_KEEP_MS 才清内容。撤销了、账号里取回来了的不清。
 * 不拿「我的世界」的列表反推:浏览器清了 localStorage、读不出列表时,一个世界也不清。退出登录选了「从这台设备上删掉」时全清(clearWorldStore)。
 * 写不下时先清用的人删掉超过 FULL_TRASH_AGE 的,再清没人引用的块,这一次就不存了,不删任何还在的世界。
 * 全清时记一笔(CLEARED),别的标签页看到了就停下正在转的;正好在这时候写完的,这个世界的修订删掉,不留在清过的仓库里。
 *
 * 第一次存世界时申请长期保存(navigator.storage.persist)。Firefox 会弹浏览器自己的询问框,只问一次;Safari、Chromium 不弹,自己定,每次打开问一次。
 */
import { exportNotes, subscribeNotes } from '../ai/library';
import { GENERATOR_VERSION } from '../gen/edits';
import { READER_VERSIONS } from '../gen/readers/versions';
import { parseSave, type SaveFile } from '../gen/savefile';
import { recipeKey, recipeOfSave, recipeText } from '../gen/snapshot';
import type { AuthorContent, WorldMade } from '../gen/worldFormat';
import type { ConvertJob } from '../worldConvert';
import type { ConvertReply } from '../worldConvertWorker';
import type { CommitRequest, CommitResult, RevisionHead, VaultErrorKind, VaultOps, WorldPartsOffer } from '../worldVault';
import type { VaultCall, VaultReply } from '../worldVaultWorker';
import { isCoarse, isNarrow } from './device';
import { dropResults, resultHeads } from './resultStore';
import { allWorldIds, currentWorld, isStored, loadWorld, originalOf, persistent, subscribe, trashMarks, unmarkTrash } from './saveStore';
import { APP_COMMIT, APP_VERSION } from './version';

/** 改完以后停多久写新清单(毫秒) */
const LIGHT_DELAY = 3000;
/** 用的人删掉的世界,内容留多久(毫秒):和账号里「最近删除」能找回的时间一样 */
export const TRASH_KEEP_MS = 30 * 24 * 3600_000;
/** 写不下时,删掉超过这么久的世界不再留着(毫秒):刚删的还能撤销 */
const FULL_TRASH_AGE = 3600_000;

/** 几个时间(毫秒);单测调短 */
const timing = {
  /** 打开页面过多久开始转 */
  convertDelay: 20_000,
  /** 打开页面过多久清理第一次 */
  maintainDelay: 60_000,
  /** 之后多久清理一次 */
  maintainEvery: 3_600_000,
  /** 用的人停下来多久才开始转 */
  quiet: 10_000,
  /** 多久看一次用的人是不是在忙 */
  poll: 1000,
  /** 转完一个歇多久 */
  pause: 1500,
};

/** 转的时候记一下在转谁(页面崩了下次打开看得到) */
const CONVERTING = 'civ-atlas:converting';
/** Firefox 问过长期保存了 */
const PERSIST_ASKED = 'civ-atlas:persist-asked';
/** 最近一次全清的时间(几个标签页靠它知道仓库被清了) */
const CLEARED = 'civ-atlas:vault-cleared';

function clearedAt(): string | null {
  try {
    return localStorage.getItem(CLEARED);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 调仓库(后台线程)

type VaultCaller = <K extends keyof VaultOps>(op: K, args: Parameters<VaultOps[K]>, transfer?: Transferable[]) => Promise<Awaited<ReturnType<VaultOps[K]>>>;

/** 开一个后台线程调仓库;线程出错了,等着的都算失败,下次再开 */
function workerCaller(): VaultCaller {
  let w: Worker | null = null;
  let seq = 0;
  const waiting = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  const broke = (message: string) => {
    w?.terminate();
    w = null;
    for (const f of waiting.values()) f.reject(new Error(message));
    waiting.clear();
  };
  return ((op, args, transfer = []) =>
    new Promise((resolve, reject) => {
      if (!w) {
        w = new Worker(new URL('../worldVaultWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<VaultReply>) => {
          const m = e.data;
          const f = waiting.get(m.rid);
          waiting.delete(m.rid);
          if (!f) return;
          if (m.ok) f.resolve(m.value as never);
          else f.reject(Object.assign(new Error(m.message), { kind: m.kind }));
        };
        w.onerror = (e) => broke(e.message || '世界仓库的线程出错了');
      }
      const rid = ++seq;
      waiting.set(rid, { resolve: resolve as (v: never) => void, reject });
      w.postMessage({ rid, op, args } satisfies VaultCall, { transfer });
    })) as VaultCaller;
}

let caller: VaultCaller | null = null;
const call: VaultCaller = (op, args, transfer) => {
  try {
    return (caller ??= workerCaller())(op, args, transfer);
  } catch (e) {
    // 开不了线程
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
};

const errKind = (e: unknown): VaultErrorKind | undefined => (e as { kind?: VaultErrorKind } | null)?.kind;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// 世界的内容

/** 作者内容:AI 写的正文。现在只是多存一份,原来的地方照旧 */
function authorOf(id: string): AuthorContent | null {
  const notes = exportNotes(id);
  return notes.length ? { notes } : null;
}

/** 封面的 dataURL 转成 JPEG 字节;没有、不是 JPEG = undefined(封面是可选的) */
export function thumbBytes(url: string | null | undefined): Uint8Array | undefined {
  const m = url ? /^data:image\/jpeg;base64,/.exec(url) : null;
  if (!url || !m) return undefined;
  try {
    const s = atob(url.slice(m[0].length));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  } catch {
    return undefined;
  }
}

/** 这个世界能存进仓库:建好的世界(没建完的、只存了地图的不算,还没有历史) */
const canKeep = (w: { draft: boolean; map: boolean } | null) => !!w && !w.draft && !w.map;

// ---------------------------------------------------------------------------
// 存

/** 写都排队:一次写一个世界,等的时候不堆字节(手上只留最新的一份) */
let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(f: () => Promise<T>): Promise<T> => {
  const p = chain.then(f);
  chain = p.catch(() => {});
  return p;
};

/** 线程交回来、还没对上存档的那一份 */
let offer: WorldPartsOffer | null = null;
/** 写不下了:这次打开不再转(推完、改完的照样试,可能已经腾出地方了) */
let vaultFull = false;

/** 存一份;存不下记下来,不往外抛 */
async function commit(req: CommitRequest, transfer?: Transferable[]): Promise<CommitResult | null> {
  const mark = clearedAt();
  try {
    const r = await call('commitWorld', [req], transfer);
    // 写的这一会儿仓库被清了(用的人在别的标签页选了从这台设备上删掉):这份不留
    if (clearedAt() !== mark) {
      await call('purgeWorld', [req.id]);
      return null;
    }
    if (r.status === 'saved') {
      vaultFull = false;
      void askPersist();
      void call('patchState', [req.id, { full: undefined }]).catch(() => {});
    }
    return r;
  } catch (e) {
    await noteFailure(req.id, e);
    return null;
  }
}

/** 没存成:写满了的腾地方。别的错只是这次没存,下次推完、下次打开再存 */
async function noteFailure(id: string, e: unknown): Promise<void> {
  if (errKind(e) !== 'full') return;
  vaultFull = true;
  await maintain(FULL_TRASH_AGE, 0).catch(() => {});
  await call('patchState', [id, { full: Date.now() }]).catch(() => {});
}

/** 生成世界的线程交回来一份完整的内容:对得上当前世界存着的存档就存 */
export function offerWorldParts(o: WorldPartsOffer): Promise<boolean> {
  offer = o;
  return keepOffer();
}

/** 手上的内容和当前世界存着的存档对得上就存;存了 = true */
function keepOffer(): Promise<boolean> {
  return queue(async () => {
    try {
      const o = offer;
      const c = currentWorld();
      if (!o || !c || c.kind !== 'created' || c.unsaved || c.gone || o.generator !== GENERATOR_VERSION) return false;
      const w = loadWorld(c.id);
      if (!w || !canKeep(w) || w.save.generator !== o.generator) return false;
      const recipe = recipeOfSave(w.save);
      const text = recipeText(recipe);
      if ((await recipeKey(recipe)) !== o.recipe) return false;
      // 等的这一会儿换了世界、存档又改了、来了新的一份:这份不算它的结果
      const now = currentWorld();
      const again = now?.id === c.id && !now.unsaved && !now.gone ? loadWorld(c.id) : null;
      if (offer !== o || !again || !canKeep(again) || again.save.generator !== o.generator || recipeText(recipeOfSave(again.save)) !== text) return false;
      offer = null;
      const made: WorldMade = { app: APP_VERSION, generator: o.generator, commit: APP_COMMIT, at: new Date().toISOString() };
      const r = await commit(
        { id: c.id, recipe: again.save, recipeKey: o.recipe, parts: o.parts, made, readers: { ...READER_VERSIONS }, author: authorOf(c.id), thumb: thumbBytes(again.thumb) },
        o.parts.map((p) => p.data),
      );
      return r?.status === 'saved';
    } catch {
      return false;
    }
  });
}

/** 配方以外的东西变了:写一份新清单(内容一样的不写;还没有修订、配方变了的不写) */
function syncLight(id: string): Promise<void> {
  return queue(async () => {
    try {
      const w = loadWorld(id);
      if (!w || !canKeep(w)) return;
      await commit({ id, recipe: w.save, recipeKey: await recipeKey(recipeOfSave(w.save)), author: authorOf(id), thumb: thumbBytes(w.thumb) });
    } catch {
      /* 配方算不了指纹(不是 https 的网页):这次不存 */
    }
  });
}

let lightTimer: ReturnType<typeof setTimeout> | undefined;
let lightId: string | null = null;
function scheduleLight() {
  const c = currentWorld();
  if (!c || c.kind === 'draft') return;
  // 换了世界:上一个世界等着的先写,不能被这个顶掉
  if (lightId && lightId !== c.id) flushLight();
  clearTimeout(lightTimer);
  lightId = c.id;
  lightTimer = setTimeout(flushLight, LIGHT_DELAY);
}
function flushLight() {
  clearTimeout(lightTimer);
  const id = lightId;
  lightId = null;
  if (id) void syncLight(id);
}

/** 申请长期保存(见文件头);问不了就算了 */
let persistAsked = false;
async function askPersist(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const s = navigator.storage;
    if (!s?.persist || (await s.persisted?.())) return;
    if (/firefox/i.test(navigator.userAgent)) {
      if (localStorage.getItem(PERSIST_ASKED)) return;
      localStorage.setItem(PERSIST_ASKED, '1');
    }
    await s.persist();
  } catch {
    /* 问不了就是普通的存储 */
  }
}

// ---------------------------------------------------------------------------
// 待完成的修改

/**
 * 崩了以后拿存着的修订和配方草稿比:
 * - none:没有待完成的修改(还没有修订的也算:没有东西可比)
 * - recompute:修订是当前版本算的,按草稿重算就补上了
 * - readonly:修订是别的版本算的,重算出来不是它原来的样子,只能只读打开、提示有没推完的修改
 */
export type PendingEdit = 'none' | 'recompute' | 'readonly';

export function pendingEdit(stored: Pick<RevisionHead, 'recipeKey' | 'generator'> | null, draftKey: string, generator: number = GENERATOR_VERSION): PendingEdit {
  if (!stored || stored.recipeKey === draftKey) return 'none';
  return stored.generator === generator ? 'recompute' : 'readonly';
}

/** 这个世界有没有待完成的修改;读不了 = none */
export async function pendingOf(id: string): Promise<PendingEdit> {
  const w = loadWorld(id);
  if (!w) return 'none';
  try {
    return pendingEdit(await call('latestOf', [id]), await recipeKey(recipeOfSave(w.save)));
  } catch {
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// 把现有的世界转进来

/** 转一个世界的线程;stop = 让路 */
export type ConvertRunner = (job: ConvertJob) => { done: Promise<ConvertReply | 'stopped'>; stop: () => void };

function workerRunner(job: ConvertJob): ReturnType<ConvertRunner> {
  let finish: (r: ConvertReply | 'stopped') => void = () => {};
  const done = new Promise<ConvertReply | 'stopped'>((r) => (finish = r));
  let w: Worker | null = null;
  const end = (r: ConvertReply | 'stopped') => {
    w?.terminate();
    w = null;
    finish(r);
  };
  try {
    w = new Worker(new URL('../worldConvertWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ConvertReply>) => end(e.data);
    w.onerror = (e) => end({ ok: false, kind: 'failed', message: e.message || '转存的线程出错了' });
    w.postMessage(job, job.thumb ? [job.thumb.buffer as ArrayBuffer] : []);
  } catch (e) {
    end({ ok: false, kind: 'failed', message: errText(e) });
  }
  return { done, stop: () => end('stopped') };
}

let runner: ConvertRunner = workerRunner;
/** 用的人是不是正在推演;App 接上 */
let sim: { busy: () => boolean; packNow: () => void } = { busy: () => false, packNow: () => {} };

/** 接上生成世界的线程:忙不忙、叫它把等着的内容马上打好 */
export function setWorldStoreSim(s: { busy: () => boolean; packNow: () => void }) {
  sim = s;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 手机(不在后台算世界) */
const onPhone = () => isNarrow() || isCoarse();

/**
 * 这个世界下一步要转什么;没有要转的 = null。
 * 先转比现在的存档更旧的那份原件(留底),再转现在的样子。没有原件的更旧版本只记下来
 */
async function jobFor(id: string): Promise<ConvertJob | null> {
  const w = loadWorld(id);
  if (!w || !canKeep(w)) return null;
  const state = await call('stateOf', [id]);
  if (state?.status === 'failed' && state.app === APP_VERSION) return null;
  const heads = await resultHeads(id);
  const body = { id, author: authorOf(id), thumb: thumbBytes(w.thumb) };

  // 存档被新版重存过,原来那份还留着,也有那一版的原件
  const raw = originalOf(id);
  const parsed = raw && raw.generator !== w.save.generator ? parseSave(JSON.stringify(raw)) : null;
  if (parsed?.ok && !state?.archived?.includes(parsed.save.generator)) {
    const old = parsed.save;
    const key = await recipeKey(recipeOfSave(old));
    if (heads.some((h) => h.generator === old.generator && h.recipe === key)) return { kind: 'original', id, generator: old.generator, save: old, source: 'archive' };
  }

  const key = await recipeKey(recipeOfSave(w.save));
  const latest = await call('latestOf', [id]);
  if (latest && latest.recipeKey === key && latest.generator === w.save.generator) return null;
  if (heads.some((h) => h.generator === w.save.generator && h.recipe === key)) return { ...body, kind: 'original', generator: w.save.generator, save: w.save, source: 'migrated' };
  if (w.save.generator === GENERATOR_VERSION) {
    // 打开着的世界线程自己会交内容;手机上打开哪个转哪个
    if (onPhone() || currentWorld()?.id === id) return null;
    return { ...body, kind: 'recompute', save: w.save, app: APP_VERSION, commit: APP_COMMIT };
  }
  if (state?.status !== 'old' || state.generator !== w.save.generator) await call('patchState', [id, { status: 'old', generator: w.save.generator }]);
  return null;
}

function setConverting(id: string | null) {
  try {
    if (id) localStorage.setItem(CONVERTING, id);
    else localStorage.removeItem(CONVERTING);
  } catch {
    /* 记不下就少一层保护 */
  }
}

/** 上次转的时候页面崩了:那个世界算转失败 */
async function noteCrash(): Promise<void> {
  let id: string | null = null;
  try {
    id = localStorage.getItem(CONVERTING);
  } catch {
    return;
  }
  if (!id) return;
  await call('patchState', [id, { status: 'failed', app: APP_VERSION, error: '转的时候页面崩了' }]);
  setConverting(null);
}

let converting: { stop: () => void } | null = null;
let stopped = false;
/** 最近一次看到用的人在推演的时间 */
let busyAt = 0;

/** 等用的人连着停够了;不转了 = false */
async function waitQuiet(): Promise<boolean> {
  for (;;) {
    if (stopped) return false;
    if (sim.busy()) busyAt = Date.now();
    else if (Date.now() - busyAt >= timing.quiet) return true;
    await sleep(timing.poll);
  }
}

/** 转一个世界:让路了 = 'yield';别的转完(不管成败)= 'next';写满了 = 'full' */
async function runJob(job: ConvertJob): Promise<'next' | 'yield' | 'full'> {
  setConverting(job.id);
  const mark = clearedAt();
  const h = runner(job);
  converting = h;
  const watch = setInterval(() => {
    if (clearedAt() !== mark) {
      stopped = true;
      h.stop();
    } else if (sim.busy()) {
      busyAt = Date.now();
      h.stop();
    }
  }, timing.poll);
  let out: ConvertReply | 'stopped';
  try {
    out = await h.done;
  } finally {
    clearInterval(watch);
    converting = null;
    setConverting(null);
  }
  // 转的这一会儿仓库被清了(也可能是别的标签页清的):线程可能正好写完了,这个世界的修订不留
  if (clearedAt() !== mark) {
    stopped = true;
    await call('purgeWorld', [job.id]);
    return 'yield';
  }
  if (out === 'stopped') return 'yield';
  if (out.ok) {
    if (job.kind === 'original' && job.source === 'archive') {
      const state = await call('stateOf', [job.id]);
      await call('patchState', [job.id, { archived: [...(state?.archived ?? []), job.generator] }]);
    } else await call('patchState', [job.id, { status: undefined, generator: undefined, app: undefined, error: undefined, full: undefined }]);
    if (out.result.status === 'saved') void askPersist();
    return 'next';
  }
  if (out.kind === 'full') {
    await noteFailure(job.id, Object.assign(new Error(out.message), { kind: 'full' }));
    return 'full';
  }
  const error = out.message.slice(0, 200);
  // 留底的旧版原件转不了:记下不再试,现在的样子照转
  if (job.kind === 'original' && job.source === 'archive') {
    const state = await call('stateOf', [job.id]);
    await call('patchState', [job.id, { archived: [...(state?.archived ?? []), job.generator], error }]);
  } else await call('patchState', [job.id, { status: 'failed', app: APP_VERSION, error }]);
  return 'next';
}

/** 转一遍全部世界 */
async function convertAll(): Promise<void> {
  busyAt = Date.now();
  for (const id of allWorldIds()) {
    // 一个世界最多两步:留底的旧版原件、现在的样子。多一次防循环
    for (let step = 0; step < 3; ) {
      if (!(await waitQuiet()) || vaultFull) return;
      let job: ConvertJob | null;
      try {
        job = await jobFor(id);
      } catch {
        job = null;
      }
      if (!job) {
        // 转完了的:上次没来得及写的改名、AI 正文这时补上(内容一样的不写)
        await syncLight(id);
        break;
      }
      const r = await runJob(job);
      if (r === 'full') return;
      if (r === 'next') {
        step++;
        await sleep(timing.pause);
      }
    }
  }
}

/** 开始转;几个标签页只有一个转,别的这次不转 */
export async function startConversions(): Promise<void> {
  try {
    if (!persistent() || !allWorldIds().length) return;
    // 拿到锁才看崩溃的记录:没拿到是别的标签页正在转,那条记录是它的
    const pass = async () => {
      await noteCrash();
      await convertAll();
    };
    const locks = (navigator as { locks?: LockManager }).locks;
    if (!locks?.request) return await pass();
    await locks.request('civ-atlas:convert', { ifAvailable: true }, async (lock) => {
      if (lock) await pass();
    });
  } catch {
    /* 下次打开再转 */
  }
}

// ---------------------------------------------------------------------------
// 清理、删

/**
 * 清内容:用的人删掉、又过了 trashKeep 毫秒的世界,内容删掉;没人引用的块清掉。
 * 还在列表里的世界(撤销了、账号里取回来了)不删,划掉记录。清不了就下次再清
 */
export async function maintain(trashKeep: number = TRASH_KEEP_MS, grace?: number): Promise<void> {
  if (!persistent()) return;
  const now = Date.now();
  for (const [id, at] of Object.entries(trashMarks())) {
    if (isStored(id)) unmarkTrash(id);
    else if (now - at >= trashKeep) {
      await call('purgeWorld', [id]);
      // 划掉以后原件那边就不认得它了,一起删
      await dropResults(id);
      unmarkTrash(id);
    }
  }
  await call('sweepParts', grace === undefined ? [] : [grace]);
}

/** 全清(退出登录时选了「从这台设备上删掉」):先停下正在转的、丢掉手上的,排在正在写的后面;清不了也不挡着退出 */
export async function clearWorldStore(): Promise<void> {
  try {
    localStorage.setItem(CLEARED, String(Date.now()));
  } catch {
    /* 记不下:别的标签页这时候正在转的可能留下一份 */
  }
  offer = null;
  lightId = null;
  clearTimeout(lightTimer);
  stopped = true;
  converting?.stop();
  await queue(() => call('clearVault', [])).catch(() => {});
  for (const id of Object.keys(trashMarks())) unmarkTrash(id);
}

/** 开始(App 挂载时调一次;返回取消函数) */
export function startWorldStore(): () => void {
  stopped = false;
  const off = subscribe(() => {
    if (offer) void keepOffer();
    scheduleLight();
  });
  const offNotes = subscribeNotes(scheduleLight);
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {
      off();
      offNotes();
    };
  }
  const hidden = () => {
    if (document.visibilityState !== 'hidden') return;
    sim.packNow();
    flushLight();
  };
  // 关页面:正常关的不算崩(下次还接着转这个世界)。只收拾这个标签页自己的记录
  const leave = () => {
    sim.packNow();
    flushLight();
    if (converting) setConverting(null);
  };
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', leave);
  const t1 = setTimeout(() => void startConversions(), timing.convertDelay);
  const clean = () => {
    if (allWorldIds().length || Object.keys(trashMarks()).length) void maintain().catch(() => {});
  };
  const t2 = setTimeout(clean, timing.maintainDelay);
  const t3 = setInterval(clean, timing.maintainEvery);
  return () => {
    off();
    offNotes();
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', leave);
    clearTimeout(t1);
    clearTimeout(t2);
    clearInterval(t3);
    flushLight();
    stopped = true;
    converting?.stop();
  };
}

/** 单测用:换掉调仓库的办法、转世界的办法、时间,清掉手上的东西 */
export function _setWorldStore(o: { caller?: VaultCaller | null; runner?: ConvertRunner; timing?: Partial<typeof timing> }) {
  if (o.caller !== undefined) caller = o.caller;
  if (o.runner) runner = o.runner;
  Object.assign(timing, o.timing);
  offer = null;
  vaultFull = false;
  persistAsked = false;
  stopped = false;
  converting = null;
  lightId = null;
  clearTimeout(lightTimer);
  chain = Promise.resolve();
  sim = { busy: () => false, packNow: () => {} };
}

/** 等手上排着的写完(单测用) */
export const _settled = () => chain;
export { syncLight as _syncLight };
