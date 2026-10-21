/**
 * React 18 只在元素的 DOM 属性(或事件处理函数)变了的时候,才换掉元素上记着的那份 props:
 * 一个属性一直不变的容器 div,里面的组件换了世界、换了历史,它记着的还是从前那份 children ——
 * 连带拉住旧的世界、主图、历史(一张主图六十多 MB),换几次世界内存就下不来。
 * 给这样的容器带上 data-hold={holdMark(世界, 历史…)}:这几样换了它就变,React 跟着换上新的那份 props。
 * 只是一个看不见的属性,画面不变。
 */
const ids = new WeakMap<object, number>();
let seq = 0;

function idOf(o: object | null | undefined): number {
  if (!o) return 0;
  let n = ids.get(o);
  if (n === undefined) ids.set(o, (n = ++seq));
  return n;
}

/** 这几样东西合起来的记号:哪一样换成了别的对象,记号就变 */
export function holdMark(...objs: (object | null | undefined)[]): string {
  return objs.map(idOf).join('.');
}

/*
 * 组件里 useEffect 返回的清理函数会一直留到这个 effect 下次重跑:它要是在组件那一次渲染里建,
 * 就连带拉住那一次渲染时的世界、主图、历史(JS 引擎让同一次渲染里建的函数共用一份作用域)。
 * effect 的依赖里没有世界、历史时,换了世界它也不重跑 —— 旧世界就一直放不掉。
 * 下面两个在模块里建清理函数,只记着自己要用的那一点。
 */

/** 取消这个 setTimeout 的清理函数:useEffect(() => { const t = setTimeout(…); return cancelTimeout(t); }, [...]) */
export function cancelTimeout(t: ReturnType<typeof setTimeout>): () => void {
  return () => clearTimeout(t);
}

/** p 完成后调 done(还没取消的话),返回取消的函数;调过或取消以后就不再记着 done */
export function whenDone(p: Promise<unknown>, done: () => void): () => void {
  const box: { done: (() => void) | null } = { done };
  void p.then(() => {
    const f = box.done;
    box.done = null;
    f?.();
  });
  return () => {
    box.done = null;
  };
}
