/**
 * 首页先要的图还有几张没下好(第一次来时首页正中那颗星球,studio/HomeGlobe.tsx)。
 * 主程序等它们下好了再在后台下载(Boot.tsx):线路慢的时候同时下,首页的图就要多等主程序那一大份。
 *
 * 纯状态,不碰 React。
 */
let pending = 0;
const waiters = new Set<() => void>();

/** 开始下一张首页要的图;返回"下好了 / 不要了"(叫几次都只算一次) */
export function holdHomeLoad(): () => void {
  pending++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending--;
    if (pending === 0) for (const f of [...waiters]) f();
  };
}

/** 首页要的图都下好以后做 f(没有在下的就下一轮马上做);最多等 maxMs 毫秒。返回取消 */
export function afterHomeLoad(f: () => void, maxMs: number): () => void {
  let fired = false;
  const go = () => {
    if (fired) return;
    fired = true;
    clearTimeout(t);
    waiters.delete(go);
    f();
  };
  const t = setTimeout(go, pending === 0 ? 0 : maxMs);
  if (pending > 0) waiters.add(go);
  return () => {
    fired = true;
    clearTimeout(t);
    waiters.delete(go);
  };
}
