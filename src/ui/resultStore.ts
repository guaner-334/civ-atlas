/**
 * 世界的原件(gen/snapshot.ts)存在浏览器的 IndexedDB 里('civ-atlas:results' 库):一个世界每个生成器版本留一份。
 *
 * - 存的时机:worker 推完建好的世界,交回这次的原件(offerSnapshot)。浏览器里存着的这个世界,存档的生成器版本就是原件的版本、
 *   存档里的配方和原件的配方指纹一样(gen/snapshot.ts 的 recipeOfSave),这份原件才算它的结果,存下来;对不上(刚改了干预还没推完、
 *   旧版本的世界在新版里打开还没重存、新建中的世界)就先不存,等存档或下一份原件来了再看一次。
 * - 同一个世界、同一个生成器版本只留最新的一份(配方和各块校验都一样就不重写);不同版本的各留各的:
 *   旧版本时存下的原件不因为在新版里打开、重存而被盖掉。不管多少个版本都留着,不淘汰。
 * - 库里两张表:results 放整份原件(几 MB),heads 只放编号、版本、配方指纹和校验(查有没有、要不要重写不用读整份)。两张表一起写。
 * - 删掉的世界:打开页面过一会儿看一遍,用的人删掉的世界(saveStore 的 trashMarks 记着)的原件删掉(删世界时不马上删:还能撤销)。
 *   只认这份记录,不拿"我的世界"的列表反推:列表没了可能是浏览器清了 localStorage,不是用的人删的,作品不能因此丢。
 *   退出登录选了"从这台设备上删掉"时全删(clearResults)。复制世界时原件跟着复制(copyResults)。
 * - 写不下(浏览器存储满了)、浏览器不让用 IndexedDB:这次不存,不提示(原件是额外的一份,存档本身照常)。
 *
 * - 在别的世界的地图上新开的历史(gen/edits.ts 文件头"文明种子"),第一次推完时把这份原件里地图那块的校验记进修改(noteMapSum):
 *   以后认得出这段历史用的是哪一张地图。
 * - 读:浏览器里存着的世界是旧版本建的(存档的生成器版本比现在旧),有那一版的原件、配方对得上存档,就照原样打开(frozenResult;
 *   worker 读原件,不重新生成)。读不出来的照旧按存档重新生成。
 */
import { GENERATOR_VERSION } from '../gen/edits';
import { SNAPSHOT_FORMAT, partOf, recipeKey, recipeOfSave, recipeText, type Snapshot } from '../gen/recipe';
import type { SaveFile } from '../gen/savefile';
import { currentSave, currentWorld, isStored, loadWorld, persistent, subscribe, trashMarks } from './saveStore';
import { isHeld } from './worldHolds';
import { getEdits, setMapSum } from './editsStore';
import { APP_VERSION } from './version';
import { indexedDbResults, type ResultBackend, type ResultHead, type ResultRecord } from '../resultDb';

export { indexedDbResults, type ResultBackend, type ResultHead, type ResultRecord };

const sumsOf = (s: Snapshot) => s.parts.map((p) => `${p.name}:${p.sum}`).join('|');
const sizeOf = (s: Snapshot) => s.parts.reduce((n, p) => n + p.data.byteLength, 0);

/** 只在内存里的后端(单测用) */
export function memoryResults(): ResultBackend & { records: Map<string, ResultRecord> } {
  const records = new Map<string, ResultRecord>();
  const heads = new Map<string, ResultHead>();
  const k = (id: string, g: number) => `${id}#${g}`;
  return {
    records,
    heads: async () => [...heads.values()],
    put: async (rec, head) => {
      records.set(k(rec.id, rec.generator), rec);
      heads.set(k(head.id, head.generator), head);
    },
    get: async (id, g) => records.get(k(id, g)),
    remove: async (keys) => {
      for (const [id, g] of keys) {
        records.delete(k(id, g));
        heads.delete(k(id, g));
      }
    },
    clear: async () => {
      records.clear();
      heads.clear();
    },
  };
}

// ---------------------------------------------------------------------------

let backend: ResultBackend | null | undefined;
const be = () => (backend === undefined ? (backend = indexedDbResults()) : backend);

/** 换后端(单测用;null = 不存) */
export function _setResultBackend(b: ResultBackend | null | undefined) {
  backend = b;
  pending = null;
  chain = Promise.resolve();
}

/** worker 交回来的最新一份原件(还没对上存档的先放着) */
let pending: Snapshot | null = null;
/** 写入一个接一个做(同一份不重复写) */
let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(f: () => Promise<T>): Promise<T> => {
  const p = chain.then(f);
  chain = p.catch(() => {});
  return p;
};

/** worker 交回来一份原件:对得上当前世界存着的存档就存下来 */
export function offerSnapshot(s: Snapshot): Promise<boolean> {
  pending = s;
  return keepPending();
}

/** 当前世界存着的存档和手上的原件对得上就存下来;存了 = true */
export function keepPending(): Promise<boolean> {
  return queue(async () => {
    const s = pending;
    const b = be();
    const c = currentWorld();
    if (!s || !b || !c || c.kind !== 'created' || c.unsaved || c.gone || s.generator !== GENERATOR_VERSION) return false;
    const w = loadWorld(c.id);
    if (!w || w.draft || w.save.generator !== s.generator) return false;
    try {
      const recipe = recipeOfSave(w.save);
      const text = recipeText(recipe);
      if ((await recipeKey(recipe)) !== s.recipe) return false;
      const heads = await b.heads();
      const sums = sumsOf(s);
      // 存过了 / 存下了:这份不用再看了(之后再改了历史,worker 会交新的一份)
      if (heads.some((h) => h.id === c.id && h.generator === s.generator && h.recipe === s.recipe && h.sums === sums)) {
        if (pending === s) pending = null;
        return false;
      }
      // 等的这一会儿换了世界、存档又改了(这一页或别的页)、世界删了:这份不算它的结果,不写(存档变了会再看一次)
      if (!sameWorld(c.id, text)) return false;
      const at = new Date().toISOString();
      await b.put({ id: c.id, generator: s.generator, app: APP_VERSION, at, snapshot: s }, { id: c.id, generator: s.generator, recipe: s.recipe, sums, size: sizeOf(s), at });
      if (pending === s) pending = null;
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * worker 交回来一份原件:当前世界是新开的历史、还没记地图的校验,原件又是它这一版的结果(配方对得上),就记上地图那块的校验。
 * 只记「我的世界」里存着的:别人分享的链接只是看看,记一笔会触发自动保存、把它存进「我的世界」
 */
export async function noteMapSum(s: Snapshot): Promise<void> {
  const map = getEdits().map;
  const sum = partOf(s, 'map')?.sum;
  const c = currentWorld();
  const save = currentSave();
  if (!map || map.sum || !sum || !c || c.kind === 'visit' || !save || s.generator !== GENERATOR_VERSION) return;
  try {
    if ((await recipeKey(recipeOfSave(save))) !== s.recipe) return;
  } catch {
    return;
  }
  // 等的这一会儿换了世界:不记
  const now = currentWorld();
  if (now?.id !== c.id || now.kind === 'visit' || getEdits().map !== map) return;
  setMapSum(sum);
}

/** 当前打开的还是这个世界,存着的存档还是这个配方、这一版 */
function sameWorld(id: string, text: string): boolean {
  const c = currentWorld();
  if (!c || c.id !== id || c.kind !== 'created' || c.unsaved || c.gone) return false;
  const w = loadWorld(id);
  return !!w && !w.draft && w.save.generator === GENERATOR_VERSION && recipeText(recipeOfSave(w.save)) === text;
}

/** 一个世界存着的原件(按生成器版本从旧到新) */
export async function resultHeads(id: string): Promise<ResultHead[]> {
  const b = be();
  if (!b) return [];
  try {
    return (await b.heads()).filter((h) => h.id === id).sort((x, y) => x.generator - y.generator);
  } catch {
    return [];
  }
}

export async function resultSizes(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    for (const h of (await be()?.heads()) ?? []) out[h.id] = (out[h.id] ?? 0) + h.size;
  } catch {
    /* 读不出就是不知道 */
  }
  return out;
}

/** 一个世界第 generator 版的原件;没有、读不出 = null */
export async function loadResult(id: string, generator: number): Promise<ResultRecord | null> {
  const b = be();
  if (!b) return null;
  try {
    return (await b.get(id, generator)) ?? null;
  } catch {
    return null;
  }
}

/**
 * 照原样打开这个旧世界用的原件:存档是比现在旧的版本建的、浏览器里有那一版的原件、格式认得、配方和存档对得上。
 * 没有 = null;有那一版的原件、可是用不了(配方对不上、读不出来)= 'broken'。
 * 排在前面的写(刚复制世界时原件跟着复制)写完再读;读出错再试一次,还不行也算 'broken'(不当成没有)
 */
export async function frozenResult(id: string, save: SaveFile): Promise<Snapshot | 'broken' | null> {
  if (!(save.generator < GENERATOR_VERSION)) return null;
  const b = be();
  if (!b) return null;
  const get = () => queue(() => b.get(id, save.generator));
  let r: ResultRecord | undefined;
  try {
    r = await get().catch(get);
  } catch {
    return 'broken';
  }
  if (!r) return null;
  const s = r.snapshot;
  if (s.format !== SNAPSHOT_FORMAT || s.generator !== save.generator) return 'broken';
  try {
    return (await recipeKey(recipeOfSave(save))) === s.recipe ? s : 'broken';
  } catch {
    return 'broken';
  }
}

/** 复制世界:原件跟着复制一份(写不下就算了) */
export function copyResults(from: string, to: string): Promise<void> {
  return queue(async () => {
    const b = be();
    if (!b) return;
    try {
      for (const h of await b.heads()) {
        if (h.id !== from) continue;
        const r = await b.get(from, h.generator);
        if (r) await b.put({ ...r, id: to }, { ...h, id: to });
      }
    } catch {
      /* 写不下就不带 */
    }
  });
}

/** 用的人删掉的世界的原件删掉(浏览器存储用不了、只在内存里的时候不删:看不到存着哪些世界);还在列表里的(撤销了、账号里取回来了)不删 */
export function dropOrphans(): Promise<void> {
  return queue(async () => {
    const b = be();
    if (!b || !persistent()) return;
    const trash = trashMarks();
    const c = currentWorld();
    try {
      const gone: [string, number][] = [];
      for (const h of await b.heads()) {
        // 撤销提示还开着、别的标签页还开着它、撤销过只是记录被回退了:先留着。世界仓库的代码不在首页那一份里
        if (h.id in trash && h.id !== c?.id && !isStored(h.id) && !(await isHeld(h.id)) && !(await import('./worldStore').then((m) => m.trashUndone(h.id, trash[h.id])))) gone.push([h.id, h.generator]);
      }
      await b.remove(gone);
    } catch {
      /* 下次打开再删 */
    }
  });
}

/** 一个世界的原件全删:用的人删了它、记录要划掉之前(划掉以后 dropOrphans 就不认得它了) */
export function dropResults(id: string): Promise<void> {
  return queue(async () => {
    const b = be();
    if (!b) return;
    try {
      await b.remove((await b.heads()).filter((h) => h.id === id).map((h): [string, number] => [h.id, h.generator]));
    } catch {
      /* 删不掉就多占点地方 */
    }
  });
}

/** 浏览器里的原件全删(退出登录时选了"从这台设备上删掉") */
export function clearResults(): Promise<void> {
  pending = null;
  return queue(async () => {
    try {
      await be()?.clear();
    } catch {
      /* 删不掉就算了:下次打开时按"我的世界"里没有的删 */
    }
  });
}

/** 开始存原件(App 挂载时调一次;返回取消函数):存档一变就看看手上的原件对不对得上;过一会儿清掉没用的 */
export function startResults(): () => void {
  const off = subscribe(() => {
    if (pending) void keepPending();
  });
  const t = setTimeout(() => void dropOrphans(), 15_000);
  return () => {
    off();
    clearTimeout(t);
  };
}
