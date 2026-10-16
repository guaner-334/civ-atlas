/**
 * 封闭内海的处理:完全被陆地围住、和外洋不相通的海域("海"这一类的水)。
 *
 * 真实世界里地中海、黑海都有海峡通外洋;四面是陆、没有出口的"海"在地图上很突兀(也会让河流流进一个孤零零的水洼)。
 * 海陆定好以后、算海底深度之前过一遍:
 *   - 碎屑(几个地块)直接填成陆地;
 *   - 离外洋很近的,凿一道海峡接通(陆地被凿掉几块);
 *   - 离得远的,填成陆地(内陆平原,湖由后面的洼地、湖泊那一步自己积);
 *   - 本身就大到像另一片大洋的(超过最大海域的一小截)不动。
 * 只看海陆和邻接关系,不用随机数:同一个种子永远得到同一个结果。作者草图涂过的地块不动。
 */
import type { Mesh } from './mesh';

/** 比最大海域的这个比例还大的封闭海域,当作另一片大洋,不处理 */
const KEEP_FRACTION = 0.025;
/** 碎屑:不超过这么多地块(36000 块时),直接填掉 */
const CRUMB = 12;
/** 海峡最多凿穿这么多块陆地(36000 块时;地块越小,按边长比例放长) */
const STRAIT = 3;

/** 改 land 本身:0 海 / 1 陆。protect 里非 0 的地块不改(草图涂过的) */
export function connectInlandSeas(mesh: Mesh, land: Uint8Array, protect: Uint8Array | null = null): void {
  const { n, adjStart, adj } = mesh;
  const comp = new Int32Array(n).fill(-1);
  const comps: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (land[i] || comp[i] >= 0) continue;
    const c = [i];
    comp[i] = comps.length;
    for (let q = 0; q < c.length; q++) {
      const a = c[q];
      for (let k = adjStart[a]; k < adjStart[a + 1]; k++) {
        const j = adj[k];
        if (!land[j] && comp[j] < 0) {
          comp[j] = comps.length;
          c.push(j);
        }
      }
    }
    comps.push(c);
  }
  if (comps.length < 2) return;
  let main = 0;
  for (let c = 1; c < comps.length; c++) if (comps[c].length > comps[main].length) main = c;
  const mainSize = comps[main].length;

  // target = 接得上的外洋:最大海域,以及大到像另一片大洋的海域
  const target = new Uint8Array(n);
  const closed: number[] = [];
  for (let c = 0; c < comps.length; c++) {
    if (c === main || comps[c].length > mainSize * KEEP_FRACTION) for (const i of comps[c]) target[i] = 1;
    else closed.push(c);
  }
  // 大的先处理(大小相同按编号):接通以后它也成了外洋,小的可以接到它上面
  closed.sort((a, b) => comps[b].length - comps[a].length || a - b);

  const scale = n / 36000;
  const crumb = Math.max(3, Math.round(CRUMB * scale));
  const strait = Math.max(1, Math.round(STRAIT * Math.sqrt(scale)));
  const depth = new Int32Array(n);
  const from = new Int32Array(n);

  for (const c of closed) {
    const cells = comps[c];
    if (protect && cells.some((i) => protect[i])) continue;
    if (cells.length > crumb) {
      // 从这片海往外一圈圈走(只穿过陆地),碰到外洋就量出要凿几块
      depth.fill(-1);
      const queue: number[] = [];
      for (const i of cells) {
        depth[i] = 0;
        from[i] = -1;
        queue.push(i);
      }
      let hit = -1;
      for (let q = 0; q < queue.length && hit < 0; q++) {
        const a = queue[q];
        if (depth[a] > strait) break;
        for (let k = adjStart[a]; k < adjStart[a + 1]; k++) {
          const j = adj[k];
          if (depth[j] >= 0) continue;
          if (target[j]) {
            if (depth[a] > 0 && depth[a] <= strait) {
              hit = a;
              break;
            }
            continue;
          }
          if (!land[j] || (protect && protect[j])) continue;
          depth[j] = depth[a] + 1;
          from[j] = a;
          queue.push(j);
        }
      }
      if (hit >= 0) {
        // 凿开的海峡也算外洋,后面的小海可以接到它上面
        for (let a = hit; a >= 0 && land[a]; a = from[a]) {
          land[a] = 0;
          target[a] = 1;
        }
        for (const i of cells) target[i] = 1;
        continue;
      }
    }
    for (const i of cells) land[i] = 1;
  }
}
