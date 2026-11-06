/**
 * 世界存成文件、打开文件(主线程这边)。文件的样子见 gen/worldFormat.ts,这里只安排先后;核对、读写字节全在后台线程,主线程只拿着 Blob。
 * 这里不碰界面:不下载、不提示。放回来的世界打开时走存下的内容(世界版本跟着世界走),不重新生成。
 *
 * 一个世界:
 * - 存(saveWorldFile):拼出这个世界现在的样子,AI 正文、封面都带上。文件是这次拼的,不要求写得进仓库(worldVault.ts),存储满了也拿得出来(见 fileNow):
 *     能写的先写(还没转进来的先转、配方以外的改动写进新清单);仓库里的内容和这个世界是同一段历史,只换配方、封面、AI 正文(draftFile);
 *     不是同一段历史、仓库里还没有:正开着的世界用页面里的(后台线程当场打,worldStore.ts 的 packPage),没开着的世界算一遍(转存的线程,写不下就直接装成文件)。
 *     都拿不出来才退回仓库里上一次存下的样子(stale,behind 说为什么),连这也没有才报错
 * - 开,分两步。lookWorldFile 只核对、只比较,什么都不写,返回文件和本机是什么关系:
 *     new = 本机没有这个世界;same = 本机有一模一样的(id 是本机那个);different = 本机有这个世界(编号一样,或者种子和名字都一样),但内容不一样(id 是本机那个)
 *   placeWorldFile 照这个关系放进本机:same 不放;different 按 different 选项,默认另存一份(名字加「(二)」),也可以交回去让界面问。
 *   **放进来的编号总是新的**:文件里的编号是别人写的,用它就可能盖掉本机的世界,登录了的还可能盖掉账号里的世界。本机已有的世界任何情况都不动
 *
 * 全部世界(saveAllWorldFiles、openWorldFiles):一个不压缩的 ZIP,后缀也是 .civworld(叫 .zip 的话 Mac 的 Safari 下载完会自动解开),改成 .zip 任何解压软件都打得开:
 *
 *   worlds.json                       小清单:这一批的记号、第几个、一共几个、每个世界的编号、名字、最近打开、现存几国。放在最前面,认文件靠它
 *   worlds/<编号>/<修订号>-<来源>.civworld   每份修订一个完整的世界文件:当前的、上一份内容不同的、迁移前的原件(来源见 worldVault.ts 的 RevisionSource)
 *   recipes.json                      没有内容可存的世界(没建完的、只存了地图的、没有原件的更旧版本、转失败的、有没推完的修改的):
 *                                     「全部存成文件」原来那种格式(bundle.ts),放回来也走原来那条路
 *
 * 正开着的世界用页面里的、别的世界用存的;每个世界各自拿不出内容也不挡着别的,结果里说清楚(left、behind)。
 * 世界太多一个文件放不下(WORLD_BACKUP_MAX_BYTES)就分成几个,一个世界的几份修订放在同一个文件里,每个文件都能单独打开;
 * 打开时一起选、分开选都行,lookWorldFiles 告诉界面第几个、一共几个、还差哪个。
 * 打开时按条目从头走,不把整个文件读进内存,一次只读一个世界;坏了的、下载断了的只影响那一个,别的世界照样放回来,小清单坏了也只是少了卡片上的几样。
 * 存和放回都报进度、都能取消:存的时候取消就没有文件(文件是最后才交出来的);放回的时候取消,已经放回的留着。
 *
 * 错的说法(WorldFileTrouble):broken 文件坏了或被改过;newer 要更新软件;readonly 这一版转不了结构;memory 内存不够、读不了文件;
 * timeout、crash 核对超时、线程崩了。后三种都不能跟用的人说文件坏了,不然他可能把好文件删掉。
 *
 * 旧的 .json 不走这里:sniffWorldFile 认出不是世界文件的,界面照旧按文字读。
 */
import { cleanNoteList } from '../authorNotes';
import { GENERATOR_VERSION } from '../gen/edits';
import { READER_VERSIONS } from '../gen/readers/versions';
import { WORLD_CHECK_TIMEOUT_MS, checkWorldFileInWorker, type WorldCheckWorker } from '../gen/worldCheck';
import { fileBaseName, type SaveFile } from '../gen/savefile';
import { recipeKey, recipeOfSave } from '../gen/snapshot';
import { MANIFEST_FILE, WORLD_FILE_EXT, type WorldFileErrorKind } from '../gen/worldFormat';
import { walkZip, type ZipInput, type ZipSlice } from '../gen/zipStore';
import { exportNotes, notesKnown, notesReady, replaceNotes } from '../ai/library';
import type { FileFacts, FileLook } from '../worldFileLook';
import type { CommitRequest, RevisionSource, VaultErrorKind } from '../worldVault';
import type { VaultCall, VaultReply, VaultTold } from '../worldVaultWorker';
import { bundleFileName, bundleText, cleanNotes, importBundle, parseBundle, sameWorld, withMapFrom, type Bundle, type ImportResult } from './bundle';
import { MAX_WORLDS, cleanSyncMeta, currentSave, currentWorld, flushThumb, isStored, keepOriginal, listWorlds, loadWorld, markTrash, newWorldId, nextTitle, persistent, putSyncedWorld, rawWorld, storedCount, unmarkTrash, type StoredWorld, type SyncMeta } from './saveStore';
import { APP_COMMIT, APP_VERSION } from './version';
import { holdWorld } from './worldHolds';
import { clearedAt, errKind, noteListed, packPage, settleForFile, thumbBytes, thumbUrl, vaultCall, type VaultCaller } from './worldStore';

/** 全部世界一个文件最大多少字节:和单个世界文件的本机上限一样。打开时不用整个读进内存,定它是因为更大的 Blob 手机上拼不出来、下载也容易断 */
export const WORLD_BACKUP_MAX_BYTES = 1e9;
/** 小清单在文件里的路径 */
const BACKUP_INDEX = 'worlds.json';
/** 没有内容可存的世界在文件里的路径 */
const BACKUP_RECIPES = 'recipes.json';
/** 这种文件的格式版本(旧软件读了会读错才加一) */
export const BACKUP_FORMAT = 1;
/** 小清单最大多少字节:一个世界才一百多字节 */
const INDEX_MAX_BYTES = 4e6;
/** 配方那部分最大多少字节:那种格式最长 6400 万字(bundle.ts),一个字最多 3 字节。乱填的文件不能让主线程读一个几 GB 的字符串 */
const RECIPES_MAX_BYTES = 192e6;
/** 一个文件最多看几个世界:「我的世界」最多 60 个,多的是乱填的文件,不为它一个个开线程 */
const BACKUP_MAX_WORLDS = 200;
/** 一个世界最多带几份旧修订(留下的规矩最多也就三四份) */
const OLDER_MAX = 8;
/** 单独开线程做一件事最多等多久(毫秒):最大的世界在低端手机上也够,卡死了才用得上 */
const ONCE_TIMEOUT_MS = 300_000;
/** 等生成世界的线程打页面里的世界最多等多久(毫秒):它要先做完手上的活,可能正在推很长的历史。到了时限退回上次存下的样子 */
const PAGE_TIMEOUT_MS = 600_000;
/**
 * 核对一个文件多等多久(每 MB 多少毫秒,加在 WORLD_CHECK_TIMEOUT_MS 上)。电脑上量到最大的世界(139 MB)核对 2.3 秒,每 MB 约 17 毫秒;
 * 低端手机按慢 6 倍约 14 秒,内存紧的时候还要慢,手机上没量过,放宽一些:139 MB 约 75 秒。
 * 时限只防乱填的文件卡住线程,等得久不碍事(主线程不等它);到了时限报 timeout,不说文件坏了
 */
const CHECK_MS_PER_MB = 400;

/** 核对这么大的文件最多等多久(毫秒) */
export const checkTimeout = (bytes: number): number => WORLD_CHECK_TIMEOUT_MS + Math.ceil((bytes / 1e6) * CHECK_MS_PER_MB);

/** 文件打不开的说法(见文件头) */
export type WorldFileTrouble = WorldFileErrorKind | 'timeout' | 'crash';

/** 存进本机时的问题 */
export type KeepTrouble =
  | WorldFileTrouble
  /** 浏览器存储满了 */
  | 'full'
  /** 「我的世界」已经 MAX_WORLDS 个 */
  | 'count'
  /** 浏览器不让用 IndexedDB */
  | 'unavailable'
  | 'failed';

/** 存成文件时的问题 */
export type SaveTrouble =
  /** 没有这个世界 */
  | 'missing'
  /** 没建完、只存了地图的世界:还没有历史,没有内容可存;界面照旧存 .json */
  | 'draft'
  /** 更旧的版本建的、又没有原件:本机没有它原来的内容,界面照旧存 .json */
  | 'old'
  /** 存的内容坏了,也没法重新转 */
  | 'corrupt'
  /** 用的人取消了:没有文件 */
  | 'cancelled'
  | 'full'
  | 'memory'
  | 'unavailable'
  | 'timeout'
  | 'crash'
  | 'failed';

export interface Trouble<K> {
  ok: false;
  kind: K;
  message: string;
}
const trouble = <K>(kind: K, message: string): Trouble<K> => ({ ok: false, kind, message });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 进度:第几个世界、一共几个、多少字节。存的时候总字节数要读完才知道,读完之前是 null */
export interface WorldFileProgress {
  done: number;
  total: number;
  bytes: number;
  totalBytes: number | null;
}

// ---------------------------------------------------------------------------
// 后台线程

/** 下一次开线程时要听拼文件的进度(同步交给 workerOnce,见 saveWorldFile) */
let onceWatch: ((share: number) => void) | null = null;

/** 开一个线程做一件事,做完就关:读写大文件的字节不留在常驻的线程里(和别的写排队也不挡着它们);卡死了杀得掉 */
const workerOnce: VaultCaller = ((op, args, transfer = []) =>
  new Promise((resolve, reject) => {
    const watch = onceWatch;
    const w = new Worker(new URL('../worldVaultWorker.ts', import.meta.url), { type: 'module' });
    const end = (f: () => void) => {
      clearTimeout(timer);
      w.terminate();
      f();
    };
    const timer = setTimeout(() => end(() => reject(Object.assign(new Error('读写世界文件超时'), { kind: 'timeout' }))), ONCE_TIMEOUT_MS);
    w.onmessage = (e: MessageEvent<VaultReply | VaultTold>) => {
      const m = e.data;
      if ('told' in m) return void watch?.(m.told);
      end(() => (m.ok ? resolve(m.value as never) : reject(Object.assign(new Error(m.message), { kind: m.kind }))));
    };
    w.onerror = (e) => end(() => reject(Object.assign(new Error(e.message || '读写世界文件的线程崩了'), { kind: 'crash' })));
    w.postMessage({ rid: 1, op, args, ...(watch ? { told: true } : {}) } satisfies VaultCall, { transfer });
  })) as VaultCaller;

type Looker = (file: Blob, timeoutMs?: number) => Promise<FileLook>;

const workerLook: Looker = (file, timeoutMs) =>
  checkWorldFileInWorker<FileLook>(file, {
    readers: { ...READER_VERSIONS },
    timeoutMs: timeoutMs ?? checkTimeout(file.size),
    makeWorker: () => new Worker(new URL('../worldFileLook.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorldCheckWorker<FileLook>,
  });

let once: VaultCaller = workerOnce;
let look: Looker = workerLook;

/** 单测用:换掉开线程的办法(不给 = 恢复) */
export function _setWorldFiles(o: { once?: VaultCaller; look?: Looker }): void {
  once = o.once ?? workerOnce;
  look = o.look ?? workerLook;
}

/** 检查脚本用:一份存档的配方指纹 */
export const _recipeKeyOf = (save: SaveFile): Promise<string> => recipeKey(recipeOfSave(save));

/** 交给下载的 Blob:写明是一般的文件,Safari 不当压缩包处理 */
const asDownload = (b: Blob) => b.slice(0, b.size, 'application/octet-stream');

// ---------------------------------------------------------------------------
// 认文件

/** 这是什么文件:world = 一个世界;backup = 全部世界;other = 别的(旧的 .json 之类,界面照旧按文字读) */
export type WorldFileKind = 'world' | 'backup' | 'other';

/** 看文件开头认是哪种,不看后缀(别人改了名字也认得);读不了 = other */
export async function sniffWorldFile(file: Blob): Promise<WorldFileKind> {
  try {
    const head = new Uint8Array(await file.slice(0, 30 + 64).arrayBuffer());
    if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) return 'other';
    const nameLen = head[26] | (head[27] << 8);
    const name = new TextDecoder().decode(head.subarray(30, 30 + nameLen));
    return name === MANIFEST_FILE ? 'world' : name === BACKUP_INDEX ? 'backup' : 'other';
  } catch {
    return 'other';
  }
}

// ---------------------------------------------------------------------------
// 一个世界存成文件

/** 世界文件的文件名:文明与地图-九州大陆.civworld */
export const worldFileName = (save: Pick<SaveFile, 'title' | 'seed'>): string => `${fileBaseName(save)}${WORLD_FILE_EXT}`;

export interface SavedWorldFile {
  ok: true;
  file: Blob;
  name: string;
  /** 文件比这个世界落后:现在的样子拼不出来(见 behind)。文件里是最后存进去的样子,没带上的本机还在 */
  stale: boolean;
  /** stale 时为什么拼不出现在的样子:memory 内存不够、full 写不下又没有页面里的内容可用(没开着的世界,这一版算不出来)…… */
  behind?: SaveTrouble;
}

const saveKinds: readonly VaultErrorKind[] = ['corrupt', 'full', 'memory', 'unavailable', 'failed'];
const asSaveTrouble = (e: unknown): Trouble<SaveTrouble> => {
  const k = errKind(e) as string | undefined;
  return trouble(k === 'timeout' || k === 'crash' || saveKinds.includes(k as VaultErrorKind) ? (k as SaveTrouble) : 'failed', errText(e));
};

/** 这个世界现在的样子打成的文件 */
interface NowFile {
  file: Blob;
  /** 算第几份修订;内容一样的旧修订靠 content 认 */
  n: number;
  content: string;
  /** 文件比世界落后的话,为什么 */
  behind?: SaveTrouble;
}

const asNow = (d: { file: Blob; n: number; content: string }): NowFile => ({ file: d.file, n: d.n, content: d.content });

/** 正开着的世界:后台线程打页面里的内容,装成文件。这一版算不出来 = null;打不成抛错,错上带 kind */
async function pageFile(base: Pick<CommitRequest, 'id' | 'recipe' | 'thumb' | 'author'>): Promise<NowFile | null> {
  const asked = packPage(base.recipe);
  if (!asked) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offer = await Promise.race([
    asked,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('后台线程一直在忙'), { kind: 'timeout' })), PAGE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const req: CommitRequest = {
    ...base,
    recipeKey: offer.recipe,
    parts: offer.parts,
    ...(offer.schemas ? { schemas: offer.schemas } : {}),
    made: { app: APP_VERSION, generator: offer.generator, commit: APP_COMMIT, at: new Date().toISOString() },
    readers: offer.readers ?? { ...READER_VERSIONS },
  };
  const out = await once('draftFile', [req], offer.parts.map((p) => p.data));
  return out && asNow(out);
}

/**
 * 拼这个世界现在的样子(见文件头):能写的先写,写不进去也拼得出来。不抛错。
 * save = 这个世界现在的存档(正开着的是页面里的),thumb = 卡片上的封面。
 * 存的内容坏了:记一笔,能重新转的(有原件、当前版本)转一遍再存一次。
 * onProgress:拼文件拼到几分之几(前面把世界转进仓库那一段不知道要多久,不报)
 */
async function fileNow(id: string, save: SaveFile, thumbUrl: string | null, isOpen: boolean, onProgress?: (share: number) => void): Promise<NowFile | Trouble<SaveTrouble>> {
  const thumb = thumbBytes(thumbUrl);
  for (let tries = 0; ; tries++) {
    const { stuck, drafted, author } = await settleForFile(id);
    try {
      const key = await recipeKey(recipeOfSave(save));
      // 仓库打不开(硬盘真的满了时 WebKit 连库都打不开):正开着的世界照样打得出来,AI 正文就用页面里的
      let shut: SaveTrouble | null = null;
      const head = await vaultCall('latestOf', [id]).catch((e: unknown) => {
        shut = asSaveTrouble(e).kind;
        return null;
      });
      const notes = author ?? (shut ? { notes: cleanNoteList(exportNotes(id)) } : undefined);
      const base = { id, recipe: save, ...(thumb ? { thumb } : {}), ...(notes ? { author: notes } : {}) };
      // 同一段历史:只换配方、封面、AI 正文。什么都写进去了的话字节和最新的一份一样
      if (head && head.recipeKey === key && head.generator === save.generator) {
        onceWatch = onProgress ?? null;
        const drafting = once('draftFile', [{ ...base, recipeKey: key }]);
        onceWatch = null;
        const out = await drafting;
        if (out) return asNow(out);
      }
      // 转的线程按存下的存档算的:和现在的样子对得上才算数(正开着的世界,页面里可能又改过)
      if (drafted && drafted.recipeKey === key && drafted.generator === save.generator) return asNow(drafted);
      let why: SaveTrouble | null = stuck ?? shut;
      if (isOpen) {
        try {
          const out = await pageFile(base);
          if (out) return out;
        } catch (e) {
          why = asSaveTrouble(e).kind;
        }
      }
      // 拿不出现在的样子:上次存下的也比没有强,说清楚落后了
      if (head) {
        onceWatch = onProgress ?? null;
        const packing = once('revisionFile', [id, undefined, true]);
        onceWatch = null;
        const file = await packing;
        if (file) return { file, n: head.n, content: head.content, behind: why ?? 'failed' };
      }
      if (why === 'memory') return trouble(why, '内存不够,这个世界没能打成文件');
      if (save.generator < GENERATOR_VERSION) return trouble('old', '这个世界是更旧的版本建的,本机没有它原来的内容');
      return why ? trouble(why, '这个世界没能存进浏览器') : trouble('failed', '这个世界没能转进来');
    } catch (e) {
      if (errKind(e) !== 'corrupt' || tries) return asSaveTrouble(e);
      const head = await vaultCall('latestOf', [id]).catch(() => null);
      if (!head) return asSaveTrouble(e);
      await vaultCall('patchState', [id, { corrupt: head.n, checked: undefined }]).catch(() => {});
    }
  }
}

/** 这个世界现在的存档:正开着的用页面里的(可能比存下的新,可能一次都没能存下);没有这个世界 = null */
function nowOf(id: string): { w: StoredWorld | null; save: SaveFile; isOpen: boolean } | null {
  const w = loadWorld(id);
  const c = currentWorld();
  const page = c?.id === id && c.kind !== 'draft' ? currentSave() : null;
  const save = page ?? w?.save;
  return save ? { w, save, isOpen: !!page } : null;
}

/**
 * 一个世界存成文件。不抛错。不写磁盘:交回 Blob 和文件名,下载由界面做。
 * 不要求浏览器里还有地方(见文件头)。onProgress:拼文件拼到几分之几
 */
export async function saveWorldFile(id: string, o: { onProgress?: (share: number) => void } = {}): Promise<SavedWorldFile | Trouble<SaveTrouble>> {
  const c = currentWorld();
  const now = nowOf(id);
  if (c?.id === id && c.kind === 'draft') return trouble('draft', '这个世界还没建完,没有内容可存');
  if (!now) return trouble('missing', '没有这个世界');
  if (now.w?.draft || now.w?.map) return trouble('draft', '这个世界还没建完,没有内容可存');
  if (now.isOpen) flushThumb();
  const out = await fileNow(id, now.save, loadWorld(id)?.thumb ?? null, now.isOpen, o.onProgress);
  if ('ok' in out) return out;
  return { ok: true, file: asDownload(out.file), name: worldFileName(now.save), stale: !!out.behind, ...(out.behind ? { behind: out.behind } : {}) };
}

/** 算过的大小:世界编号 → 哪一份修订、多少字节(换了修订才重算) */
const sizes = new Map<string, { n: number; bytes: number }>();

/** 这个世界存成文件有多大;还没有内容的、读不了的 = null。只读,不写;在后台线程里拼一次文件,算过的记着 */
export async function worldFileBytes(id: string): Promise<number | null> {
  try {
    const head = await vaultCall('latestOf', [id]);
    if (!head) return null;
    const known = sizes.get(id);
    if (known?.n === head.n) return known.bytes;
    const file = await once('revisionFile', [id]);
    if (!file) return null;
    sizes.set(id, { n: head.n, bytes: file.size });
    return file.size;
  } catch {
    return null;
  }
}

/** 这个世界最近算过的大小(不去算);没算过 = null */
export const knownWorldFileBytes = (id: string): number | null => sizes.get(id)?.bytes ?? null;

// ---------------------------------------------------------------------------
// 打开一个世界文件

/** 文件和本机是什么关系(见文件头) */
export type WorldFileMatch = { kind: 'new' } | { kind: 'same'; id: string } | { kind: 'different'; id: string };

/** 一份旧修订(全部世界的文件里才有) */
interface OlderFile {
  file: Blob;
  source: RevisionSource;
}

/** 核对过的文件 */
export interface LookedWorldFile {
  ok: true;
  match: WorldFileMatch;
  /** 名字、种子(清理过;React 按文字显示) */
  title: string | undefined;
  seed: number;
  /** 读配方时的提示 */
  warnings: string[];
  /** 下面几样放进本机时用,界面不用看 */
  file: Blob;
  facts: FileFacts;
  older?: readonly OlderFile[];
  meta?: SyncMeta;
  opened?: string;
  source?: RevisionSource;
}

/**
 * 文件里的东西本机这个世界是不是都有:看世界的几块一样、AI 正文都有、附加数据都有。封面不算(每台设备自己截)。
 * 本机只有配方、没存内容的不算有:配方一样,旧版本的世界本机也算不出文件里的内容
 */
async function hasAll(id: string, f: FileFacts): Promise<boolean> {
  const head = await vaultCall('latestOf', [id]).catch(() => null);
  if (!head || head.content !== f.content) return false;
  await notesReady([id]);
  const notes = new Map(exportNotes(id).map((n) => [n.key, n.text]));
  if (f.author?.notes.some((n) => notes.get(n.key) !== n.text)) return false;
  const extras = f.manifest.parts.filter((p) => p.need === 'extra' && p.name !== 'author' && p.name !== 'thumb');
  if (!extras.length) return true;
  const r = await vaultCall('readRevision', [id, head.n, []]).catch(() => null);
  return extras.every((x) => r?.manifest.parts.some((p) => p.name === x.name && p.sum === x.sum));
}

/** 名字去掉另存时加的「(二)」 */
const rootTitle = (t: string | undefined) => (t ?? '').replace(/（[二三四五六七八九十\d]+）$/, '');

async function matchOf(f: FileFacts): Promise<WorldFileMatch> {
  for (const w of listWorlds()) {
    if (w.draft || w.map) continue;
    // 比的时候不算两样:另存时名字加的「(二)」(不然同一个文件每打开一次就多一份);「这段历史用的是哪张地图」记的世界编号(放回来时换成了本机的)
    const m = w.save.edits.map;
    const save: SaveFile = {
      ...f.save,
      ...(rootTitle(w.save.title) === rootTitle(f.save.title) ? { title: w.save.title } : {}),
      ...(m && f.save.edits.map ? { edits: { ...f.save.edits, map: m } } : {}),
    };
    if (sameWorld(w.save, save) && (await hasAll(w.id, f))) return { kind: 'same', id: w.id };
  }
  if (isStored(f.manifest.id)) return { kind: 'different', id: f.manifest.id };
  // 换过设备、别人改过再发回来的,文件里的编号和本机的对不上:同样的种子、同样的名字也算同一个世界,不然列表里多一张分不清的同名卡片
  const root = rootTitle(f.save.title);
  const twin = root ? listWorlds().find((w) => !w.draft && !w.map && w.save.seed === f.save.seed && rootTitle(w.save.title) === root) : null;
  return twin ? { kind: 'different', id: twin.id } : { kind: 'new' };
}

/** 核对一个文件、和本机比较,什么都不写。不抛错;校验不占主线程,超时、线程崩了分开报。时限不给 = 按文件大小(checkTimeout) */
export async function lookWorldFile(file: Blob, options: { timeoutMs?: number } = {}): Promise<LookedWorldFile | Trouble<WorldFileTrouble>> {
  const f = await look(file, options.timeoutMs);
  if (!f.ok) return f;
  try {
    return { ok: true, match: await matchOf(f), title: f.save.title, seed: f.save.seed, warnings: f.warnings, file, facts: f };
  } catch (e) {
    return trouble('crash', errText(e));
  }
}

/** 封面的字节变成卡片用的 dataURL;太大的不放 */
export interface KeptWorldFile {
  ok: true;
  /** 新世界的编号 */
  id: string;
  /** AI 正文没能写进浏览器(存储满了) */
  notesLost: boolean;
  /** 浏览器不让存:世界只留在这个页面里,关掉就没了,文件先别删 */
  memOnly: boolean;
  /** 带的旧修订有几份读不了,没放回来 */
  olderLost: number;
}

const keepKinds: readonly string[] = ['full', 'memory', 'unavailable', 'timeout', 'crash', 'failed'];
function asKeepTrouble(e: unknown): Trouble<KeepTrouble> {
  const k = errKind(e) as string | undefined;
  // 校验过的文件收进仓库时对不上:文件在核对之后变了
  if (k === 'corrupt') return trouble('broken', errText(e));
  return trouble(keepKinds.includes(k ?? '') ? (k as KeepTrouble) : 'failed', errText(e));
}

const adoptOf = (id: string, f: FileFacts, file: Blob, source: RevisionSource) =>
  once('adoptFile', [{ id, file, sum: f.sum, recipeKey: f.recipeKey, generator: f.save.generator, readers: { ...READER_VERSIONS }, source, ...(f.authorTrouble === 'damaged' ? { dropAuthor: true } : {}) }]);

/**
 * 把核对过的文件存成一个新世界(总是新编号,见文件头):先写仓库,再写「我的世界」;哪一步没成都不留东西,不碰本机别的世界。
 * save:存进「我的世界」的存档(不给 = 文件里的);另存时名字不一样
 */
export async function keepWorldFile(looked: LookedWorldFile, o: { save?: SaveFile } = {}): Promise<KeptWorldFile | Trouble<KeepTrouble>> {
  if (storedCount() >= MAX_WORLDS) return trouble('count', `「我的世界」最多存 ${MAX_WORLDS} 个世界`);
  const id = newWorldId();
  // 写的这一会儿不能被当成删掉的世界清掉(下面先记了一笔;存储紧张时删掉的世界马上就清)
  const free = holdWorld(id);
  try {
    return await keepAs(id, looked, o);
  } finally {
    free();
  }
}

async function keepAs(id: string, looked: LookedWorldFile, o: { save?: SaveFile }): Promise<KeptWorldFile | Trouble<KeepTrouble>> {
  const f = looked.facts;
  // 写完仓库、写进「我的世界」之前页面关了:仓库里留下的这份没人认。先当它是删掉的世界记一笔,过些天自己清(worldStore 的 maintain)
  markTrash(id);
  const undo = async () => {
    await vaultCall('purgeWorld', [id]).catch(() => {});
    unmarkTrash(id);
  };
  let olderLost = 0;
  let original: string | null = null;
  try {
    for (const old of looked.older ?? []) {
      const r = await look(old.file);
      if (!r.ok) {
        olderLost++;
        continue;
      }
      await adoptOf(id, r, old.file, old.source);
      // 迁移前的原件:留作「看原样」(和本机的世界一样)
      if (old.source === 'archive') original = JSON.stringify(r.save);
    }
    await adoptOf(id, f, looked.file, looked.source ?? 'made');
    // 校验没过的 author 块:字节收下了,不当正文读
    const skip = f.authorTrouble === 'skipped' ? f.manifest.parts.find((p) => p.name === 'author')?.sum : undefined;
    await vaultCall('patchState', [id, { checked: f.content, ...(skip ? { authorSkip: skip } : {}) }]).catch(() => {});
  } catch (e) {
    await undo();
    return asKeepTrouble(e);
  }
  const save = o.save ?? f.save;
  if (!putSyncedWorld(id, { save: JSON.stringify(save), meta: looked.meta ?? {}, thumb: thumbUrl(f.thumb) }, looked.opened ?? new Date().toISOString())) {
    await undo();
    return trouble('full', '浏览器存储满了,这个世界没能放进「我的世界」');
  }
  unmarkTrash(id);
  noteListed(id);
  keepOriginal(id, original);
  const notes = cleanNotes(f.author?.notes);
  const notesLost = notes.length > 0 && !replaceNotes(id, notes);
  return { ok: true, id, notesLost, memOnly: !persistent(), olderLost };
}

/**
 * 从账号取回来的文件放进这个编号名下(换设备打开传过的世界、别人打开短链接):核对过才放,「我的世界」不动。
 * AI 正文:账号里的存档带的可能是更早的一份(写得太多时存档不带),文件里有的以文件为准,本机另有的留着。不抛错。
 * still:每写一步前再问一次还要不要;wiped = 这台设备上的世界被清了(退出登录选了删掉),已经写进去的也删掉
 */
export async function adoptWorldFile(id: string, file: Blob, still: () => 'go' | 'stop' | 'wiped' = () => 'go'): Promise<{ ok: true; save: SaveFile; warnings: string[] } | Trouble<KeepTrouble>> {
  const mark = clearedAt();
  const now = () => (clearedAt() !== mark ? 'wiped' : still());
  const stopped = trouble<KeepTrouble>('failed', '账号变了，没有放进来');
  const f = await look(file);
  if (!f.ok) return f;
  if (now() !== 'go') return stopped;
  const free = holdWorld(id);
  try {
    await adoptOf(id, f, file, 'made');
    const skip = f.authorTrouble === 'skipped' ? f.manifest.parts.find((p) => p.name === 'author')?.sum : undefined;
    await vaultCall('patchState', [id, { checked: f.content, ...(skip ? { authorSkip: skip } : {}) }]).catch(() => {});
    if (now() === 'wiped') {
      await vaultCall('purgeWorld', [id]).catch(() => {});
      return stopped;
    }
    await notesReady([id]);
    if (now() !== 'go') return stopped;
    const fromFile = cleanNotes(f.author?.notes);
    if (fromFile.length) {
      const keys = new Set(fromFile.map((n) => n.key));
      const here = exportNotes(id);
      const merged = [...fromFile, ...here.filter((n) => !keys.has(n.key))];
      if (JSON.stringify(merged) !== JSON.stringify(here)) replaceNotes(id, merged);
    }
    return { ok: true, save: f.save, warnings: f.warnings };
  } catch (e) {
    return asKeepTrouble(e);
  } finally {
    free();
  }
}

/** 本机有这个世界但内容不一样时怎么办:copy = 另存一份,本机的不动;ask = 先不放,交回去让界面问(之后可以 keepWorldFile) */
export type DifferentChoice = 'copy' | 'ask';

/** 放进本机的结果 */
export type PlacedWorldFile =
  /** 本机没有,放进来了 */
  | { ok: true; status: 'added'; id: string; title: string | undefined; kept: KeptWorldFile }
  /** 本机有这个世界但内容不一样:另存了一份(id),本机那个(of)没动 */
  | { ok: true; status: 'copied'; id: string; of: string; title: string | undefined; kept: KeptWorldFile }
  /** 本机有一模一样的,没重复放 */
  | { ok: true; status: 'same'; id: string; title: string | undefined }
  /** 本机有这个世界但内容不一样,选了 ask:什么都没写 */
  | { ok: true; status: 'different'; id: string; title: string | undefined; looked: LookedWorldFile };

/** 照文件和本机的关系放进本机(见文件头)。不抛错 */
export async function placeWorldFile(looked: LookedWorldFile, o: { different?: DifferentChoice } = {}): Promise<PlacedWorldFile | Trouble<KeepTrouble>> {
  const m = looked.match;
  if (m.kind === 'same') return { ok: true, status: 'same', id: m.id, title: looked.title };
  if (m.kind === 'different' && o.different === 'ask') return { ok: true, status: 'different', id: m.id, title: looked.title, looked };
  if (m.kind === 'new') {
    const kept = await keepWorldFile(looked);
    return kept.ok ? { ok: true, status: 'added', id: kept.id, title: looked.title, kept } : kept;
  }
  const save = { ...looked.facts.save, title: nextTitle(looked.facts.save.title || '未命名世界') };
  const kept = await keepWorldFile(looked, { save });
  return kept.ok ? { ok: true, status: 'copied', id: kept.id, of: m.id, title: save.title, kept } : kept;
}

/** 省事的写法:核对一个世界文件、放进本机 */
export async function openWorldFromFile(file: Blob, o: { different?: DifferentChoice } = {}): Promise<PlacedWorldFile | Trouble<KeepTrouble>> {
  const looked = await lookWorldFile(file);
  return looked.ok ? placeWorldFile(looked, o) : looked;
}

// ---------------------------------------------------------------------------
// 全部世界存成文件

/** 存出来的一个文件 */
export interface BackupFile {
  file: Blob;
  name: string;
  /** 第几个、一共几个 */
  part: number;
  parts: number;
  /** 里面几个带完整内容的世界 */
  worlds: number;
}

/** 存全部世界的结果 */
export interface SavedBackup {
  ok: true;
  /** 一个或几个文件(每个都能单独打开) */
  files: BackupFile[];
  /** 一共几个世界 */
  count: number;
  /** 带着完整内容的世界 */
  whole: number;
  /** 只带了配方的世界:没建完的、没有内容的(更旧的版本又没有原件、转失败的、内存不够的) */
  recipeOnly: string[];
  /** recipeOnly 里每个世界为什么没带上内容 */
  left: LeftWorld[];
  /** 文件里是上次存下的样子的世界,刚才的改动另带了配方(打开时要重新算);不在 recipeOnly 里 */
  behind: LeftWorld[];
  /** 这几个世界连一个文件都放不下的旧修订没带上 */
  olderLeft: string[];
  /** 配方那部分放不下、没带上的:AI 写的东西;AI 写的东西和缩略图 */
  dropped?: 'notes' | 'notes+thumbs';
  /** 只带了配方的世界里,AI 正文这次没读出来的(文件里可能不全;界面要提示) */
  notesUnread?: string[];
  /** 总字节数 */
  bytes: number;
}

/** 全部存成文件时没能带上现在内容的一个世界 */
export interface LeftWorld {
  id: string;
  /** 名字(显示前当文字) */
  title?: string;
  /** draft 没建完、old 更旧的版本又没有原件、full 写不下又算不出来、memory 内存不够…… */
  kind: SaveTrouble;
}

/** 一个世界在文件里的几份修订 */
interface WorldGroup {
  w: StoredWorld;
  dir: string;
  /** 按修订号从小到大 */
  files: { n: number; source: RevisionSource; data: Blob }[];
  current: number;
  bytes: number;
}

/** 给每个文件留的:小清单、配方、目录的地方 */
const BACKUP_SPARE_BYTES = 16e6;
/**
 * 装 ZIP 时的硬上限(32 位 ZIP 放得下的,zipStore.ts):分文件在上面按 maxBytes 分好了,这里不再卡。
 * 一个世界自己就快到上限时(再加小清单超了一点),打开时不用读进内存,大一点也打得开,不能为这一点让全部世界都存不成
 */
const BACKUP_HARD_MAX_BYTES = 4e9;

/** 拼一个世界的几份修订:现在的样子(见 fileNow)加上留着的旧修订 */
async function groupOf(w: StoredWorld, index: number, isOpen: boolean): Promise<{ group: WorldGroup; behind?: SaveTrouble } | Trouble<SaveTrouble>> {
  const now = await fileNow(w.id, w.save, w.thumb, isOpen);
  if ('ok' in now) return now;
  // 旧修订只是留底:读不了(硬盘真的满了时 WebKit 连库都打不开)也不能丢了手上现在的样子
  const heads = await vaultCall('revisionsOf', [w.id]).catch(() => []);
  const had = heads.find((h) => h.n === now.n);
  // 内容和现在一样的旧修订(只改了名、封面、AI 正文)不带,字节都一样,带了文件白白大一倍;其中有迁移前的原件的,现在这份记成原件,放回来同样不会被淘汰
  const twin = heads.some((h) => h.n !== now.n && h.source === 'migrated' && h.content === now.content);
  const files: WorldGroup['files'] = [];
  let bytes = 0;
  for (const h of heads) {
    if (h.n === now.n || (h.source !== 'archive' && h.content === now.content)) continue;
    let data: Blob | null = null;
    try {
      data = await once('revisionFile', [w.id, h.n, true]);
    } catch {
      // 旧修订坏了:只是少一份留底
    }
    if (!data) continue;
    files.push({ n: h.n, source: h.source, data });
    bytes += data.size;
  }
  files.push({ n: now.n, source: twin ? 'migrated' : (had?.source ?? 'made'), data: now.file });
  files.sort((a, b) => a.n - b.n);
  bytes += now.file.size;
  const dir = /^[0-9a-z]{1,40}$/.test(w.id) ? w.id : `world${index}`;
  return { group: { w, dir, files, current: now.n, bytes }, ...(now.behind ? { behind: now.behind } : {}) };
}

/** 按顺序往文件里放,放不下开下一个;一个世界的几份修订放在同一个文件里,实在放不下只留最新的和放得下的。first = 第一个文件要先留给配方的地方 */
function packGroups(groups: readonly WorldGroup[], budget: number, first: number): { packs: WorldGroup[][]; olderLeft: string[] } {
  const olderLeft: string[] = [];
  const packs: WorldGroup[][] = [[]];
  let room = budget - first;
  for (const g0 of groups) {
    let g = g0;
    if (g.bytes > budget) {
      const cur = g.files.find((f) => f.n === g.current);
      let left = budget - (cur?.data.size ?? 0);
      const files = g.files.filter((f) => {
        if (f === cur) return true;
        if (f.data.size > left) return false;
        left -= f.data.size;
        return true;
      });
      g = { ...g, files, bytes: files.reduce((s, f) => s + f.data.size, 0) };
      olderLeft.push(g.w.id);
    }
    if (g.bytes > room && packs.at(-1)!.length) {
      packs.push([]);
      room = budget;
    }
    packs.at(-1)!.push(g);
    room -= g.bytes;
  }
  return { packs, olderLeft };
}

/** 全部世界存成文件时可以给的 */
export interface SaveAllOptions {
  onProgress?: (p: WorldFileProgress) => void;
  /** 取消:返回 cancelled,没有文件 */
  signal?: AbortSignal;
  /** 一个文件的上限(单测调小) */
  maxBytes?: number;
}

/** 全部世界存成一个或几个文件。不抛错:哪个世界出了问题就只带它的配方,不让它挡着别的世界。不要求浏览器里还有地方(见文件头) */
export async function saveAllWorldFiles(o: SaveAllOptions = {}): Promise<SavedBackup | Trouble<SaveTrouble>> {
  const maxBytes = o.maxBytes ?? WORLD_BACKUP_MAX_BYTES;
  const cancelled = () => trouble<SaveTrouble>('cancelled', '取消了');
  flushThumb();
  const stored = listWorlds();
  // 正开着的世界用页面里的;一次都没能存进浏览器的那一个不在列表里,放在最前面(硬盘真的满了时 WebKit 的 localStorage 写了也会丢,所以不只看写没写成)
  const c = currentWorld();
  const page = c && c.kind !== 'draft' ? currentSave() : null;
  const inList = stored.find((w) => w.id === c?.id);
  const list: StoredWorld[] = stored.map((w) => (page && w === inList ? { ...w, save: page, alive: c?.alive ?? w.alive } : w));
  if (c && page && !inList && (c.unsaved || (c.kind === 'created' && !c.gone))) list.unshift({ id: c.id, save: page, count: 0, thumb: null, draft: false, at: page.savedAt, ...(c.alive !== undefined ? { alive: c.alive } : {}), map: false, mapThumb: null });
  const groups: WorldGroup[] = [];
  const bare = new Set<string>();
  const left: LeftWorld[] = [];
  const behind: LeftWorld[] = [];
  const rowOf = (w: StoredWorld, kind: SaveTrouble): LeftWorld => ({ id: w.id, ...(w.save.title ? { title: w.save.title } : {}), kind });
  let bytes = 0;
  for (let i = 0; i < list.length; i++) {
    if (o.signal?.aborted) return cancelled();
    const w = list[i];
    o.onProgress?.({ done: i, total: list.length, bytes, totalBytes: null });
    if (w.draft || w.map) {
      bare.add(w.id);
      left.push(rowOf(w, 'draft'));
      continue;
    }
    try {
      const got = await groupOf(w, i, w.id === c?.id && !!page);
      if ('ok' in got) {
        bare.add(w.id);
        left.push(rowOf(w, got.kind));
        continue;
      }
      groups.push(got.group);
      bytes += got.group.bytes;
      // 文件比世界落后的:配方、AI 写的东西也带上,一点不丢
      if (got.behind) {
        bare.add(w.id);
        behind.push(rowOf(w, got.behind));
      }
    } catch (e) {
      bare.add(w.id);
      left.push(rowOf(w, asSaveTrouble(e).kind));
    }
  }
  const at = new Date();
  await notesReady();
  const out = bundleText(at, undefined, (id) => bare.has(id));
  if (!groups.length && !out) return left.length ? trouble(left[0].kind, '这个世界没能打成文件') : trouble('missing', '「我的世界」里还没有世界');
  if (out?.tooBig) return trouble('failed', '世界太多、太大,一个文件放不下');

  const recipes = out ? new TextEncoder().encode(out.text) : null;
  const { packs, olderLeft } = packGroups(groups, maxBytes - BACKUP_SPARE_BYTES, recipes?.length ?? 0);
  const base = bundleFileName(at).replace(/\.json$/, '');
  const batch = `${at.getTime().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const files: BackupFile[] = [];
  for (let i = 0; i < packs.length; i++) {
    if (o.signal?.aborted) return cancelled();
    const index = {
      app: '文明与地图',
      kind: 'backup',
      format: BACKUP_FORMAT,
      batch,
      savedAt: at.toISOString(),
      part: i + 1,
      parts: packs.length,
      worlds: packs[i].map((g) => ({
        id: g.w.id,
        dir: g.dir,
        ...(g.w.save.title ? { title: g.w.save.title } : {}),
        ...(g.w.at > g.w.save.savedAt ? { opened: g.w.at } : {}),
        ...(g.w.alive !== undefined ? { meta: { alive: g.w.alive } } : {}),
      })),
    };
    const entries: ZipInput[] = [{ name: BACKUP_INDEX, data: new TextEncoder().encode(`${JSON.stringify(index, null, 2)}\n`) }];
    for (const g of packs[i]) for (const f of g.files) entries.push({ name: `worlds/${g.dir}/${f.n}-${f.source}${WORLD_FILE_EXT}`, data: f.data });
    if (i === 0 && recipes) entries.push({ name: BACKUP_RECIPES, data: recipes });
    try {
      const file = asDownload(await once('zipBlobs', [entries, BACKUP_HARD_MAX_BYTES]));
      files.push({ file, name: `${base}${packs.length > 1 ? `-${i + 1}of${packs.length}` : ''}${WORLD_FILE_EXT}`, part: i + 1, parts: packs.length, worlds: packs[i].length });
    } catch (e) {
      return asSaveTrouble(e);
    }
  }
  const total = files.reduce((s, f) => s + f.file.size, 0);
  o.onProgress?.({ done: list.length, total: list.length, bytes: total, totalBytes: total });
  const recipeOnly = [...bare].filter((id) => !groups.some((g) => g.w.id === id));
  const notesUnread = [...bare].filter((id) => !notesKnown(id));
  return { ok: true, files, count: groups.length + recipeOnly.length, whole: groups.length, recipeOnly, left, behind, olderLeft, ...(out?.dropped ? { dropped: out.dropped } : {}), ...(notesUnread.length ? { notesUnread } : {}), bytes: total };
}

// ---------------------------------------------------------------------------
// 打开文件(一个世界、全部世界,一起选几个都行)

interface IndexRow {
  title?: string;
  opened?: string;
  meta: SyncMeta;
}

interface BackupIndex {
  batch: string;
  part: number;
  parts: number;
  rows: Map<string, IndexRow>;
}

/** 带内容的世界都是建好的:小清单里只认现存几国,别的(「还在新建」之类)不认,乱填的不能把世界锁住 */
const aliveOnly = (m: SyncMeta): SyncMeta => (m.alive !== undefined ? { alive: m.alive } : {});

/** 读小清单:每一样都当乱填的查。读不出来 = 没有(世界文件自己够放回来);比软件新的 = 'newer' */
async function readIndex(slice: ZipSlice | undefined): Promise<BackupIndex | 'newer' | null> {
  if (!slice || slice.data.size > INDEX_MAX_BYTES) return null;
  try {
    const raw = JSON.parse(await slice.data.text()) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || raw.kind !== 'backup') return null;
    if (typeof raw.format === 'number' && raw.format > BACKUP_FORMAT) return 'newer';
    const rows = new Map<string, IndexRow>();
    for (const x of Array.isArray(raw.worlds) ? (raw.worlds as Record<string, unknown>[]) : []) {
      if (!x || typeof x !== 'object' || typeof x.dir !== 'string') continue;
      const opened = typeof x.opened === 'string' && x.opened.length <= 40 && !Number.isNaN(Date.parse(x.opened)) ? new Date(x.opened).toISOString() : undefined;
      rows.set(x.dir, {
        ...(typeof x.title === 'string' ? { title: x.title.slice(0, 256) } : {}),
        ...(opened ? { opened } : {}),
        meta: aliveOnly(cleanSyncMeta(x.meta)),
      });
    }
    const int = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v < 1e6 ? v : 0);
    return { batch: typeof raw.batch === 'string' ? raw.batch.slice(0, 64) : '', part: int(raw.part), parts: int(raw.parts), rows };
  } catch {
    return null;
  }
}

const REVISION_NAME = /^worlds\/([^/]+)\/(\d{1,15})-(made|migrated|archive)\.civworld$/;

/** 一个世界的几份修订(按修订号从小到大) */
interface PackedWorld {
  /** 显示用的路径 */
  name: string;
  row?: IndexRow;
  files: { n: number; source: RevisionSource; data: Blob }[];
  bytes: number;
}

function worldsIn(entries: readonly ZipSlice[], index: BackupIndex | null): PackedWorld[] {
  const byDir = new Map<string, PackedWorld>();
  for (const e of entries) {
    const m = REVISION_NAME.exec(e.name);
    if (!m) continue;
    let g = byDir.get(m[1]);
    if (!g) {
      g = { name: `worlds/${m[1]}`, files: [], bytes: 0, ...(index?.rows.has(m[1]) ? { row: index.rows.get(m[1])! } : {}) };
      byDir.set(m[1], g);
    }
    g.files.push({ n: Number(m[2]), source: m[3] as RevisionSource, data: e.data });
    g.bytes += e.data.size;
  }
  for (const g of byDir.values()) g.files.sort((a, b) => a.n - b.n);
  return [...byDir.values()];
}

/** 选中的一个文件是什么 */
export interface PickedFile {
  file: Blob;
  /** 文件名(有的话) */
  name?: string;
  /** other:不是世界文件(旧的 .json 交给原来那条路) */
  kind: WorldFileKind;
  /** 全部世界:这一批的记号、第几个、一共几个(小清单坏了 = 空、0) */
  batch: string;
  part: number;
  parts: number;
  /** 里面几个带内容的世界 */
  worlds: number;
  bytes: number;
  /** 不完整(下载断了、中间坏了):能读到的还是读得到 */
  cut: boolean;
  /** 比这一版软件新,要更新软件 */
  newer: boolean;
  /** 内部用 */
  packed: PackedWorld[];
  recipes: ZipSlice | null;
}

/** 分成几个文件的一批:第几个有了、还差哪几个 */
export interface BackupSet {
  batch: string;
  parts: number;
  have: number[];
  missing: number[];
}

async function pickOne(file: Blob): Promise<PickedFile> {
  const name = (file as Partial<File>).name;
  const base = { file, ...(name ? { name } : {}), batch: '', part: 0, parts: 0, worlds: 0, bytes: file.size, cut: false, newer: false, packed: [] as PackedWorld[], recipes: null };
  const sniffed = await sniffWorldFile(file);
  if (sniffed === 'world') return { ...base, kind: 'world', worlds: 1, packed: [{ name: name ?? MANIFEST_FILE, files: [{ n: 1, source: 'made', data: file }], bytes: file.size }] };
  // 开头的小清单改坏了名字:里面有世界也算(zip 开头对就走一遍)
  const zipHead = new Uint8Array(await file.slice(0, 4).arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (sniffed === 'other' && (zipHead[0] !== 0x50 || zipHead[1] !== 0x4b)) return { ...base, kind: 'other' };
  const { entries, clean } = await walkZip(file);
  const index = await readIndex(entries.find((e) => e.name === BACKUP_INDEX));
  const known = index && index !== 'newer' ? index : null;
  const packed = worldsIn(entries, known);
  const recipes = entries.find((e) => e.name === BACKUP_RECIPES) ?? null;
  if (sniffed === 'other' && !packed.length && !recipes) return { ...base, kind: 'other' };
  return { ...base, kind: 'backup', batch: known?.batch ?? '', part: known?.part ?? 0, parts: known?.parts ?? 0, worlds: packed.length, cut: !clean, newer: index === 'newer', packed, recipes };
}

function setsOf(picks: readonly PickedFile[]): BackupSet[] {
  const sets = new Map<string, BackupSet>();
  for (const p of picks) {
    if (p.kind !== 'backup' || p.parts < 1 || !p.part) continue;
    let s = sets.get(p.batch);
    if (!s) sets.set(p.batch, (s = { batch: p.batch, parts: p.parts, have: [], missing: [] }));
    if (!s.have.includes(p.part)) s.have.push(p.part);
  }
  for (const s of sets.values()) {
    s.have.sort((a, b) => a - b);
    for (let i = 1; i <= s.parts && i <= 1000; i++) if (!s.have.includes(i)) s.missing.push(i);
  }
  return [...sets.values()];
}

/** 看选中的几个文件各是什么、分成几个文件的还差哪个。很快:只读每个条目的头,不核对世界。不抛错 */
export async function lookWorldFiles(files: readonly Blob[]): Promise<{ files: PickedFile[]; sets: BackupSet[] }> {
  const picks: PickedFile[] = [];
  for (const f of files) picks.push(await pickOne(f));
  return { files: picks, sets: setsOf(picks) };
}

/** 放回时没放成的一个世界 */
export interface SkippedWorld {
  /** 文件名或文件里的路径 */
  name: string;
  /** 小清单里写的名字(显示前当文字) */
  title?: string;
  kind: KeepTrouble;
  message: string;
}

/** 打开文件的结果 */
export interface OpenedWorldFiles {
  ok: true;
  /** 已放回(新编号) */
  added: { id: string; title: string | undefined }[];
  /** 本机有这个世界但内容不同,另存了一份(id);本机那个(of)没动 */
  copied: { id: string; of: string; title: string | undefined }[];
  /** 本机原来就有一模一样的,没重复放(本机的编号)。olderMissing:文件里带的旧修订有几份本机没有(没放进去,文件还留着它们) */
  same: { id: string; title: string | undefined; olderMissing?: number }[];
  /** 选了 different: 'ask' 才有:本机有这个世界但内容不同,先没放 */
  different: { id: string; title: string | undefined; looked: LookedWorldFile }[];
  /** 读不出、放不下,跳过了;别的世界不受影响 */
  skipped: SkippedWorld[];
  /** 有文件不完整(下载断了、中间坏了):能读到的都放了 */
  cut: boolean;
  /** 用的人取消了:已经放回的留着 */
  cancelled: boolean;
  /** 分成几个文件的:第几个有了、还差哪几个 */
  sets: BackupSet[];
  /** 只存了配方的那部分放回来的结果(在第 1 个文件里) */
  recipes: ImportResult | null;
  /** 有 AI 正文没能写进浏览器的世界 */
  notesLost: string[];
  /** 放回来了,文件里 AI 写的东西读不进来的世界(块坏了、超长了) */
  notesUnread: string[];
  /** 浏览器不让存:放回来的只留在这个页面里,文件先别删 */
  memOnly: boolean;
}

/** 打开文件时可以给的 */
export interface OpenFilesOptions {
  onProgress?: (p: WorldFileProgress) => void;
  /** 取消:正在放的这一个放完就停,已经放回的留着 */
  signal?: AbortSignal;
  /** 不给 = copy */
  different?: DifferentChoice;
}

/**
 * 文件比世界落后时,配方那部分另带了一份 AI 写的东西(见 saveAllWorldFiles),比世界文件里的新。这次刚放回来的世界用这一份换掉同一条;
 * 本机原来就有的世界不动
 */
async function freshNotes(b: Bundle, ids: ReadonlyMap<string, string>, placed: readonly string[]): Promise<void> {
  await notesReady(placed);
  for (const w of b.worlds) {
    const id = w.id ? ids.get(w.id) : undefined;
    if (!id || !placed.includes(id) || !w.notes.length) continue;
    const keys = new Set(w.notes.map((n) => n.key));
    replaceNotes(id, [...exportNotes(id).filter((n) => !keys.has(n.key)), ...w.notes]);
  }
}

/** 文件里带的旧修订有几份本机这个世界没有 */
async function olderMissing(id: string, older: readonly OlderFile[]): Promise<number> {
  if (!older.length) return 0;
  const have = new Set((await vaultCall('revisionsOf', [id]).catch(() => [])).map((h) => h.content));
  let missing = 0;
  for (const old of older) {
    const r = await look(old.file);
    if (r.ok && !have.has(r.content)) missing++;
  }
  return missing;
}

/** 放回来的世界记着的「地图出自哪个世界」换成本机的编号(那个世界可能排在后面才放回来,所以全放完再换;分开打开的几个文件之间换不了) */
function mapWorldIds(placed: readonly string[], ids: Map<string, string>): void {
  for (const id of placed) {
    const w = loadWorld(id);
    if (!w) continue;
    const next = withMapFrom(w.save, ids);
    const raw = next !== w.save ? rawWorld(id) : null;
    if (raw) putSyncedWorld(id, { ...raw, save: JSON.stringify(next) });
  }
}

/**
 * 打开一个或几个文件:单个世界、全部世界(分成几个文件的一起选、分开选都行),逐个世界核对、放进本机(见文件头)。不抛错。
 * 比软件新的、不是世界文件的记进 skipped
 */
export async function openWorldFiles(files: readonly Blob[], o: OpenFilesOptions = {}): Promise<OpenedWorldFiles> {
  const { files: picks, sets } = await lookWorldFiles(files);
  const out: OpenedWorldFiles = { ok: true, added: [], copied: [], same: [], different: [], skipped: [], cut: picks.some((p) => p.cut), cancelled: false, sets, recipes: null, notesLost: [], notesUnread: [], memOnly: false };
  const worlds: PackedWorld[] = [];
  const seenParts = new Set<string>();
  for (const p of picks) {
    const label = p.name ?? (p.kind === 'backup' ? '全部世界的文件' : '这个文件');
    if (p.kind === 'other') out.skipped.push({ name: label, kind: 'broken', message: '这不是世界文件' });
    else if (p.newer) out.skipped.push({ name: label, kind: 'newer', message: '这个文件来自更新版本的「文明与地图」,更新软件才打得开' });
    else if (p.kind === 'backup' && !p.packed.length && !p.recipes) out.skipped.push({ name: label, kind: 'broken', message: '这个文件里读不出世界' });
    else {
      // 同一个文件选了两次
      const mark = p.batch && p.part ? `${p.batch}#${p.part}` : '';
      if (mark && seenParts.has(mark)) continue;
      if (mark) seenParts.add(mark);
      worlds.push(...p.packed.slice(0, BACKUP_MAX_WORLDS));
      for (const g of p.packed.slice(BACKUP_MAX_WORLDS)) out.skipped.push({ name: g.name, kind: 'broken', message: '这个文件里的世界太多了' });
    }
  }
  const totalBytes = worlds.reduce((s, g) => s + g.bytes, 0);
  const ids = new Map<string, string>();
  const placedIds: string[] = [];
  let bytes = 0;
  for (let i = 0; i < worlds.length; i++) {
    if (o.signal?.aborted) {
      out.cancelled = true;
      break;
    }
    const g = worlds[i];
    o.onProgress?.({ done: i, total: worlds.length, bytes, totalBytes });
    const skip = (kind: KeepTrouble, message: string) => out.skipped.push({ name: g.name, ...(g.row?.title ? { title: g.row.title } : {}), kind, message });
    // 当前的:最新的一份不是留底的旧版原件的;别的都是旧修订
    const cur = g.files.filter((x) => x.source !== 'archive').at(-1) ?? g.files.at(-1)!;
    const r = await lookWorldFile(cur.data);
    if (!r.ok) {
      skip(r.kind, r.message);
      bytes += g.bytes;
      continue;
    }
    const looked: LookedWorldFile = {
      ...r,
      source: cur.source,
      older: g.files
        .filter((x) => x !== cur)
        .slice(-OLDER_MAX)
        .map((x) => ({ file: x.data, source: x.source })),
      ...(g.row ? { meta: g.row.meta } : {}),
      // 全部世界放回来:卡片上的时间、排序跟着回来;单个世界是这次打开的(不给)
      ...(g.row?.opened ? { opened: g.row.opened } : g.row ? { opened: r.facts.save.savedAt } : {}),
    };
    const placed = await placeWorldFile(looked, o.different ? { different: o.different } : {});
    bytes += g.bytes;
    if (!placed.ok) {
      skip(placed.kind, placed.message);
      continue;
    }
    const entry = { id: placed.id, title: placed.title };
    if (placed.status === 'different') {
      out.different.push({ ...entry, looked: placed.looked });
      continue;
    }
    ids.set(r.facts.manifest.id, placed.id);
    if (placed.status === 'same') {
      const missing = await olderMissing(placed.id, looked.older ?? []);
      out.same.push(missing ? { ...entry, olderMissing: missing } : entry);
      continue;
    }
    placedIds.push(placed.id);
    if (placed.status === 'copied') out.copied.push({ ...entry, of: placed.of });
    else out.added.push(entry);
    if (placed.kept.notesLost) out.notesLost.push(placed.id);
    if (r.facts.authorTrouble) out.notesUnread.push(placed.id);
    if (placed.kept.memOnly) out.memOnly = true;
    if (placed.kept.olderLost) skip('broken', `有 ${placed.kept.olderLost} 份旧修订读不了,没放回来`);
  }
  if (o.signal?.aborted) out.cancelled = true;
  if (!out.cancelled) {
    for (const p of picks) {
      if (!p.recipes || p.newer) continue;
      if (p.recipes.data.size > RECIPES_MAX_BYTES) {
        out.skipped.push({ name: BACKUP_RECIPES, kind: 'broken', message: '只存了配方的那部分太大了' });
        continue;
      }
      try {
        const parsed = parseBundle(await p.recipes.data.text());
        if (parsed?.ok) {
          await freshNotes(parsed.bundle, ids, placedIds);
          await notesReady();
          const done = importBundle(parsed.bundle, ids);
          // 选了不同批的几个文件:各有一份配方,结果加起来
          const had = out.recipes;
          out.recipes = had ? { ...done, added: [...had.added, ...done.added], same: had.same + done.same, filled: had.filled + done.filled, left: had.left + done.left, notesLost: had.notesLost || done.notesLost } : done;
          if (done.added.length && !persistent()) out.memOnly = true;
        } else out.skipped.push({ name: BACKUP_RECIPES, kind: 'broken', message: parsed ? parsed.error : '读不出来' });
      } catch (e) {
        out.skipped.push({ name: BACKUP_RECIPES, kind: 'memory', message: errText(e) });
      }
    }
  }
  // 配方那部分放完才换:存了地图的世界在配方那部分里,这时候才有本机的编号
  mapWorldIds(placedIds, ids);
  o.onProgress?.({ done: worlds.length, total: worlds.length, bytes, totalBytes });
  return out;
}
