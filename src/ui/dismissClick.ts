/**
 * 点地图收起菜单:这一下只收起菜单,不再当成地图上的单击(不顺带选中国家、不飞过去)。
 *
 * 菜单(存档、导出、图层、「···」)在捕获阶段听 pointerdown 收起自己,收起时调 noteDismiss(e):
 * 按在地图上(主图、地球仪或地图外的空白)就记一笔;地图的单击处理先调 tookDismissClick(),记过就把这一下吃掉。
 * 按下去拖动了、松手在别处没有单击的,一秒后作废,不影响下一次单击。
 */

/** 记下的那一下按在什么时候(没有 = −∞) */
let at = -Infinity;

/** 菜单因为点了外面而收起:按在地图上的那一下,接下来的单击不算 */
export function noteDismiss(e: Event) {
  const t = e.target;
  if (t instanceof Element && (t.matches('.stage') || t.closest('.canvas-wrap, .globe'))) at = performance.now();
}

/** 这一下单击是不是收起菜单的那一下(问过就清掉) */
export function tookDismissClick(): boolean {
  const hit = performance.now() - at < 1000;
  at = -Infinity;
  return hit;
}
