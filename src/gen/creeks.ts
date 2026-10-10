/**
 * 小溪(只在放大后画,世界数据不变):比成河门槛小的水流也串成线 —— 真实地图放大以后,河网要比全图上看到的密得多。
 * 和河流同一套排水方向(生成时最后那次排水,按同样的参数重算一遍),从每条溪的源头往下游走,
 * 碰到河、湖、海或别的溪就停;接到河上的那一点就是河上的那个地块,画的时候和河连成一张河网。
 * 地块中心连成的线放大后太直:相邻两点之间加一个往旁边偏一点的中点(偏多少按两个地块的编号定),画出来弯弯曲曲。
 * 纯计算:不碰页面,worker / Node 都能跑;同一个世界结果一样。
 */
import type { River, World } from './world';
import { drainage } from './erosion';
import { geometryOf } from './geometry';

/** 溪流的门槛 = 成河门槛的几分之一 */
export const CREEK_FRAC = 0.2;
/** 中点往旁边最多偏这一段长的几分之一 */
const MEANDER = 0.22;

/** 两个地块编号 → 0..1 */
function pairHash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const cache = new WeakMap<World, River[]>();

/** 这个世界的小溪(流量在成河门槛的 CREEK_FRAC ~ 1 倍之间;记住上一次的) */
export function creeksOf(world: World): River[] {
  let c = cache.get(world);
  if (!c) cache.set(world, (c = traceCreeks(world)));
  return c;
}

function traceCreeks(world: World): River[] {
  const { mesh, water, flux, riverThreshold } = world;
  const land = world.tect.land;
  const { n, x, y } = mesh;
  const receiver = drainage(mesh, land, world.elevation, 1e-3).receiver;
  const geo = geometryOf(mesh);
  const thr = riverThreshold * CREEK_FRAC;
  // 河流经过的地块(溪流走到这里就接上)
  const onRiver = new Uint8Array(n);
  for (const r of world.rivers) for (const c of r.cells) onRiver[c] = 1;
  const isCreek = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (water[i] === 0 && !onRiver[i] && flux[i] >= thr) isCreek[i] = 1;
  const hasDonor = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (isCreek[i] && receiver[i] >= 0) hasDonor[receiver[i]] = 1;
  const sources: number[] = [];
  for (let i = 0; i < n; i++) if (isCreek[i] && !hasDonor[i]) sources.push(i);
  sources.sort((a, b) => flux[b] - flux[a] || a - b);

  const visited = new Uint8Array(n);
  const out: River[] = [];
  const m = [0, 0];
  const pts: number[] = [];
  const chain: number[] = [];
  for (const s of sources) {
    pts.length = 0;
    chain.length = 0;
    let i = s;
    visited[i] = 1;
    pts.push(x[i], y[i], flux[i]);
    chain.push(i);
    for (;;) {
      const r = receiver[i];
      if (r < 0) break;
      if (water[r] !== 0) {
        // 入海 / 入湖:停在两地块之间
        geo.mid(i, r, m);
        pts.push(m[0], m[1], flux[i]);
        chain.push(r);
        break;
      }
      // 接到河上:最后一点是河上的那个地块(流量记成溪自己的,画的时候不在汇合前变粗)
      if (onRiver[r]) {
        pts.push(x[r], y[r], flux[i]);
        chain.push(r);
        break;
      }
      pts.push(x[r], y[r], flux[r]);
      chain.push(r);
      if (visited[r]) break;
      visited[r] = 1;
      i = r;
    }
    if (pts.length >= 6) out.push(meander(pts, chain, world.width));
  }
  return out;
}

/** 相邻两点之间加一个往旁边偏的中点(流量、地块取上游那一点的;跨 180° 经线的那一段不加) */
function meander(pts: number[], chain: number[], width: number): River {
  const m = pts.length / 3;
  const p: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < m; i++) {
    p.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    c.push(chain[i]);
    if (i === m - 1) break;
    const dx = pts[i * 3 + 3] - pts[i * 3];
    const dy = pts[i * 3 + 4] - pts[i * 3 + 1];
    if (Math.abs(dx) > width / 2) continue;
    const off = (pairHash(chain[i], chain[i + 1]) - 0.5) * 2 * MEANDER;
    p.push(pts[i * 3] + 0.5 * dx - off * dy, pts[i * 3 + 1] + 0.5 * dy + off * dx, pts[i * 3 + 2]);
    c.push(chain[i]);
  }
  return { pts: Float32Array.from(p), cells: Int32Array.from(c) };
}

/**
 * 细沟的门槛:上游至少这么多个地块(按默认精细度 36000 个地块折算)。
 * 和溪流不同,按集水面积而不是流量算 —— 沙漠里雨少、流量小,可旱沟(干河床)照样有
 */
export const WASH_AREA = 2;

/** 细沟接到河上时,从最后一个地块往河上那个地块走多远就停 */
const WASH_REACH = 0.75;

const washCache = new WeakMap<World, River[]>();

/**
 * 细沟(只在写实风里画进地面,不画成蓝线;世界数据不变):上游集水面积够 WASH_AREA 的地块顺着排水方向串成线,
 * 碰到河、湖、海或别的细沟就停。每个点的第三个数是上游有多少个地块(按 36000 个地块折算)。
 */
export function washesOf(world: World): River[] {
  let c = washCache.get(world);
  if (!c) washCache.set(world, (c = traceWashes(world)));
  return c;
}

function traceWashes(world: World): River[] {
  const { mesh, water } = world;
  const land = world.tect.land;
  const { n, x, y } = mesh;
  const { receiver, order, orderLen } = drainage(mesh, land, world.elevation, 1e-3);
  const geo = geometryOf(mesh);
  // 上游地块数:从高往低(排水顺序倒过来)一路加下去
  const area = new Float32Array(n);
  const k = 36000 / n;
  for (let i = 0; i < n; i++) if (land[i] && water[i] === 0) area[i] = k;
  for (let q = orderLen - 1; q >= 0; q--) {
    const i = order[q];
    if (!land[i] || water[i] !== 0) continue;
    const r = receiver[i];
    if (r >= 0 && water[r] === 0) area[r] += area[i];
  }
  const onRiver = new Uint8Array(n);
  for (const r of world.rivers) for (const c of r.cells) onRiver[c] = 1;
  const isWash = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (land[i] && water[i] === 0 && !onRiver[i] && area[i] >= WASH_AREA) isWash[i] = 1;
  const hasDonor = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (isWash[i] && receiver[i] >= 0) hasDonor[receiver[i]] = 1;
  const sources: number[] = [];
  for (let i = 0; i < n; i++) if (isWash[i] && !hasDonor[i]) sources.push(i);
  sources.sort((a, b) => area[b] - area[a] || a - b);

  const visited = new Uint8Array(n);
  const out: River[] = [];
  const m = [0, 0];
  const pts: number[] = [];
  const chain: number[] = [];
  for (const s of sources) {
    pts.length = 0;
    chain.length = 0;
    let i = s;
    visited[i] = 1;
    pts.push(x[i], y[i], area[i]);
    chain.push(i);
    for (;;) {
      const r = receiver[i];
      if (r < 0) break;
      if (water[r] !== 0 || !land[r]) {
        geo.mid(i, r, m);
        pts.push(m[0], m[1], area[i]);
        chain.push(r);
        break;
      }
      // 接到河上:停在快到河的地方(画出来的河是平滑过的,不一定正好过那个地块的中心,接满了会戳到河对岸去)
      if (onRiver[r]) {
        pts.push(x[i] + WASH_REACH * (x[r] - x[i]), y[i] + WASH_REACH * (y[r] - y[i]), area[i]);
        chain.push(r);
        break;
      }
      pts.push(x[r], y[r], area[r]);
      chain.push(r);
      if (visited[r]) break;
      visited[r] = 1;
      i = r;
    }
    // 只有一段的(源头一步就到河 / 海)画出来是一小截浮着的短线,不要
    if (pts.length >= 9) out.push(meander(pts, chain, world.width));
  }
  return out;
}
