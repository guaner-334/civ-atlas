/**
 * 「这个世界的内容现在不能清」的记号,几个标签页都看得到。删掉的世界什么时候清内容见 worldStore.ts,这些时候绝不能清:
 * - 撤销提示还开着:清了,撤销回来的世界就没有内容了
 * - 有标签页正开着它:那边还在看,后台线程重开时还要读仓库
 * - 正在写它(转存、存进仓库、打开文件放进来):清完了才写完,就留下一份没人认的内容,再也清不掉
 *
 * 用浏览器的 Web Locks:拿着的人各一把共享的锁,清的人要独占的,拿不到就是有人在用。标签页关了、崩了锁自己就没了,
 * 记号不会留下来害得内容永远清不掉(记在 localStorage 就会)。
 * 这个浏览器没有 Web Locks(或者不是 https 的网页)就看不到别的标签页:canSeeHolds() = false,调用方退回只按时间清。
 *
 * 拿锁是异步的:记号在这个标签页里当场生效,别的标签页要等几毫秒,调用方不清刚删的世界(worldStore.ts 的 holdGap)。
 */

const nameOf = (id: string) => `civ-atlas:world-hold:${id}`;

/** 这个标签页拿着的(世界编号 → 几把) */
const here = new Map<string, number>();

/** 单测用:换掉 navigator.locks(null = 没有;undefined = 看浏览器) */
let fake: LockManager | null | undefined;

function locks(): LockManager | null {
  if (fake !== undefined) return fake;
  try {
    const l = (navigator as { locks?: LockManager }).locks;
    return l?.request ? l : null;
  } catch {
    return null;
  }
}

/** 看得到别的标签页拿着的记号 */
export const canSeeHolds = (): boolean => !!locks();

/** 这个世界的内容先别清;返回放开的函数(放开两次也没事) */
export function holdWorld(id: string): () => void {
  here.set(id, (here.get(id) ?? 0) + 1);
  let free = () => {};
  const until = new Promise<void>((r) => (free = r));
  try {
    void locks()
      ?.request(nameOf(id), { mode: 'shared' }, () => until)
      .catch(() => {});
  } catch {
    /* 拿不了锁:这个标签页自己还认得 */
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (here.get(id) ?? 1) - 1;
    if (n) here.set(id, n);
    else here.delete(id);
    free();
  };
}

/** 没人拿着这个世界才做 f,做的时候别人也拿不到;有人拿着 = false,没做 */
export async function ifNotHeld(id: string, f: () => Promise<void>): Promise<boolean> {
  if (here.has(id)) return false;
  const l = locks();
  if (!l) {
    await f();
    return true;
  }
  return l.request(nameOf(id), { ifAvailable: true }, async (lock) => {
    if (!lock || here.has(id)) return false;
    await f();
    return true;
  });
}

/** 现在有没有人拿着(只是看一眼,不占锁;问不到算没有) */
export async function isHeld(id: string): Promise<boolean> {
  if (here.has(id)) return true;
  try {
    const s = await locks()?.query();
    return !!s?.held?.some((x) => x.name === nameOf(id));
  } catch {
    return false;
  }
}

/** 单测用:换掉 navigator.locks,清掉这个标签页的记号 */
export function _setHolds(o: { locks?: LockManager | null } = {}): void {
  fake = o.locks;
  here.clear();
}
