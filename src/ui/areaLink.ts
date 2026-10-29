/**
 * 地区模式写进网址(刷新、复制网址、分享链接都还在;不进存档):
 *
 *   area=1470,440,70,46     框的那一块:中心 x、中心 y、宽、高(世界单位,两位小数);有它 = 打开就进地区模式
 *   face=3d                 看的是立体(不写 = 平面图,地区图)
 *   ang=10,28,1,0,0,3.2     立体的角度:朝向、俯角(度)、远近(比刚打开时近几倍)、看点(占方框东西、南北的几成)、看点多高(公里;可以不写),
 *                           见 render/terrain3d/camera.ts 的 ReliefAngle
 *   ex=13                   立体的起伏倍数(1–30)
 *
 * 认不出的一样不管(框不像样就整个不进地区模式);老网址没有这几样,照旧打开。纯计算,不碰 DOM。
 */
import type { ReliefBox } from '../render/terrain3d/box';
import { PITCH_MAX, PITCH_MIN, TARGET_H_MAX, ZOOM_MAX, ZOOM_MIN, wrapYaw, type ReliefAngle } from '../render/terrain3d/camera';

/** 地区模式在网址里用的几样(回到我的世界、离开地区模式时一起去掉) */
export const AREA_KEYS = ['area', 'face', 'ang', 'ex'] as const;

export interface AreaLink {
  box: ReliefBox;
  face: 'flat' | 'relief';
  /** 立体的角度;没写(或认不出)= 按刚打开时的 */
  angle: ReliefAngle | null;
  /** 立体的起伏倍数;没写 = 按框的大小自动定 */
  ex: number | null;
}

const EX_MIN = 1;
const EX_MAX = 30;

const nums = (s: string | null, n: number): number[] | null => {
  if (s === null) return null;
  const parts = s.split(',');
  if (parts.length !== n || parts.some((p) => p.trim() === '')) return null;
  const v = parts.map(Number);
  return v.every(Number.isFinite) ? v : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** 去掉多余的 0:1.50 → 1.5,2.00 → 2 */
const fix = (v: number, d: number) => String(Number(v.toFixed(d)) || 0);

/** 网址 → 地区模式(没有 area 或不像样 = null);框还要按世界夹一次(render/terrain3d/box.ts 的 clampBox) */
export function readAreaLink(q: URLSearchParams): AreaLink | null {
  const b = nums(q.get('area'), 4);
  if (!b || !(b[2] > 0) || !(b[3] > 0)) return null;
  const face = q.get('face') === '3d' ? 'relief' : 'flat';
  const ang = face === 'relief' ? q.get('ang') : null;
  const a = nums(ang, 6) ?? nums(ang, 5);
  const angle: ReliefAngle | null = a
    ? {
        yaw: wrapYaw(a[0]),
        pitch: clamp(a[1], PITCH_MIN, PITCH_MAX),
        zoom: clamp(a[2], ZOOM_MIN, ZOOM_MAX),
        px: clamp(a[3], -0.5, 0.5),
        pz: clamp(a[4], -0.5, 0.5),
        ...(a.length > 5 ? { h: clamp(a[5], 0, TARGET_H_MAX) } : {}),
      }
    : null;
  const e = face === 'relief' ? nums(q.get('ex'), 1) : null;
  return { box: { cx: b[0], cy: b[1], w: b[2], h: b[3] }, face, angle, ex: e ? clamp(Math.round(e[0]), EX_MIN, EX_MAX) : null };
}

/** 地区模式 → 网址(null = 去掉这几样);别的参数照留 */
export function writeAreaLink(q: URLSearchParams, link: AreaLink | null): URLSearchParams {
  const o = new URLSearchParams(q);
  for (const k of AREA_KEYS) o.delete(k);
  if (!link) return o;
  const { box: b } = link;
  o.set('area', [b.cx, b.cy, b.w, b.h].map((v) => fix(v, 2)).join(','));
  if (link.face !== 'relief') return o;
  o.set('face', '3d');
  const a = link.angle;
  if (a) o.set('ang', [fix(wrapYaw(a.yaw), 1), fix(a.pitch, 1), fix(a.zoom, 3), fix(a.px, 3), fix(a.pz, 3), ...(a.h === undefined ? [] : [fix(a.h, 2)])].join(','));
  if (link.ex !== null) o.set('ex', String(clamp(Math.round(link.ex), EX_MIN, EX_MAX)));
  return o;
}
