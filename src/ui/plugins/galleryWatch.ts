/**
 * 装着的插件和作品墙对一对:联网时(和停用名单一起,过期才取)看作品墙上有没有新版、有没有被网站停用。
 * 不自动更新;停用了的每一次停用只提示一次。也管从作品墙取插件文件。
 */
import { fetchGallery, type GalleryWork } from '../../account/gallery';
import { ServerError, serverBase } from '../../account/server';
import { PLUGIN_MAX_BYTES, openPluginFile, type OpenedPlugin } from '../../plugin/pluginFile';
import { listPlugins, type InstalledPlugin } from '../../plugin/pluginStore';
import { createListeners } from '../createStore';
import { showToast } from '../toastStore';
import { openPlugins } from './entry';
import { latestOf, newerOnWall, type WallLatest } from './galleryPlugin';
import { blockKey, refreshVerdicts, verdictOf } from './verdict';
import './plugins.css';

const KEY = 'civ-atlas:plugin-latest';
const TOLD_KEY = 'civ-atlas:plugin-blocked-told';

interface Latest {
  at: number;
  items: Record<string, WallLatest>;
}

const changed = createListeners();

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 存不下:这一页里用着 */
  }
}

let latest: Latest | null = (() => {
  const v = typeof localStorage === 'undefined' ? null : readJson<Latest>(KEY);
  return v && typeof v.at === 'number' && v.items && typeof v.items === 'object' ? v : null;
})();

/** 取到了作品墙的列表(作品墙那一页、联网时查):记下各插件现在那一版 */
export function noteWall(plugins: readonly GalleryWork[]): void {
  latest = { at: Date.now(), items: latestOf(plugins) };
  writeJson(KEY, latest);
  changed.emit();
}

/** 作品墙上有没有比装着的这一版新的;没有 = null */
export function newVersionOf(p: InstalledPlugin): WallLatest | null {
  return newerOnWall(p, latest?.items[p.id], (sum) => verdictOf(sum, p.id).reviewed);
}

/** 组件里跟着作品墙上的新版、停用名单变而重画 */
export const subscribeWall = changed.subscribe;
export const useWallRev = (): Latest | null => changed.use(() => latest);

let checking: Promise<void> | null = null;

/** 联网时查一次:装了插件才查;停用名单过期才重取,作品墙上的新版跟着它一起取 */
export function checkPlugins(): Promise<void> {
  if (!serverBase()) return Promise.resolve();
  checking ??= (async () => {
    // 还没装插件也取停用名单:从文件装的时候要查
    const fresh = await refreshVerdicts();
    const list = await listPlugins().catch(() => [] as InstalledPlugin[]);
    if (!list.length) return;
    if (fresh || !latest) {
      try {
        noteWall((await fetchGallery()).plugins);
      } catch {
        /* 取不到:照用上次的 */
      }
    }
    changed.emit();
    tellBlocked(list);
  })().finally(() => {
    checking = null;
  });
  return checking;
}

const BLOCKED_TAIL = '用过它的世界照常能看，存进世界的图层照样在。';

/** 装着的插件新被网站停用了:顶上提示条说一次 */
function tellBlocked(list: readonly InstalledPlugin[]): void {
  const told = new Set(readJson<string[]>(TOLD_KEY) ?? []);
  const fresh = list.flatMap((p) => {
    const key = blockKey(p.current.sum, p.id);
    return key && !told.has(key) ? [{ p, key }] : [];
  });
  if (!fresh.length) return;
  for (const x of fresh) told.add(x.key);
  writeJson(TOLD_KEY, [...told].slice(-200));
  const names = fresh.map((x) => `「${x.p.current.manifest.name}」`);
  const b = verdictOf(fresh[0].p.current.sum, fresh[0].p.id).blocked;
  showToast({
    id: 'plugins-blocked',
    kind: 'warn',
    text: fresh.length === 1 ? `插件${names[0]}被网站停用了` : `${fresh.length} 个插件被网站停用了`,
    more: [fresh.length === 1 && b ? `${b.why}，${b.day}停用。它不再启动；${BLOCKED_TAIL}` : `${names.join('')}不再启动；${BLOCKED_TAIL.replace('它', '它们')}`],
    action: { label: '看看', act: 'plugins-blocked', onClick: openPlugins },
  });
}

let onlineHooked = false;
/** 打开网站时查一次,断网又连上时再查 */
export function watchPlugins(): void {
  void checkPlugins();
  if (onlineHooked || typeof window === 'undefined') return;
  onlineHooked = true;
  window.addEventListener('online', () => void checkPlugins());
}

// ---------------------------------------------------------------------------
// 从作品墙取插件文件

const files = new Map<string, Promise<{ bytes: Uint8Array; opened: OpenedPlugin }>>();

/** 作品墙上一个插件现在那一版的文件(打开、核对过);同一个作品取过就不再取。坏的照 openPluginFile 抛 PluginFileError */
export function wallFile(work: string, sum?: string): Promise<{ bytes: Uint8Array; opened: OpenedPlugin }> {
  const key = `${work}:${sum ?? ''}`;
  let got = files.get(key);
  if (!got) {
    got = (async () => {
      const base = serverBase();
      if (!base) throw new ServerError(0, 'not-configured', '还没有开放');
      let res: Response;
      try {
        res = await fetch(`${base}/v1/gallery/${encodeURIComponent(work)}/plugin`, { credentials: 'omit' });
      } catch {
        throw new ServerError(0, 'network', '连不上服务器，请检查网络后再试');
      }
      if (!res.ok) throw new ServerError(res.status, res.status === 410 ? 'gallery-gone' : 'not-found', res.status === 410 ? '这个插件已经撤下了' : `没取到插件文件(HTTP ${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > PLUGIN_MAX_BYTES) throw new ServerError(200, 'bad-response', '插件文件太大');
      const opened = await openPluginFile(bytes);
      if (sum && opened.sum !== sum) throw new ServerError(200, 'bad-response', '作品墙上这个插件刚换了版本，关掉再打开试试');
      return { bytes, opened };
    })();
    files.set(key, got);
    got.catch(() => files.delete(key));
  }
  return got;
}

/** 单测用 */
export function _resetWall(): void {
  latest = null;
  files.clear();
  changed.emit();
}
