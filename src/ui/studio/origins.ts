/**
 * 选文明起源(OriginsPage.tsx)用的几样计算:点在星球上的哪(屏幕 ↔ 世界坐标,地球仪和各种平面投影),
 * 一处起源落在哪一州、能不能住人、列表上怎么写。纯计算,不碰 DOM。
 */
import { BIOMES } from '../../gen/biomes';
import type { Civ } from '../../gen/civ/types';
import { HABITABLE_SUIT, regionLabel } from '../../gen/civ/display';
import { ORIGINS_MAX, nearestCell, originRegion } from '../../gen/civ/frontier';
import type { World } from '../../gen/world';
import { lonLatToScreen, screenToLonLat } from '../../render/globe';
import { labelProjection, mapProj } from '../../render/projection';
import type { StillPose } from './scene';

const TAU = Math.PI * 2;

/** 停住的星球上:世界坐标 ↔ 视口坐标(CSS 像素) */
export interface PoseMap {
  /** 世界 → 视口;第三个数 > 0 = 看得见(地球仪的背面看不见) */
  fwd(x: number, y: number): [number, number, number];
  /** 视口 → 世界(x 在 [0, W) 里);点在星球外面 = null */
  inv(sx: number, sy: number): [number, number] | null;
}

export function poseMap(pose: StillPose, W: number, H: number): PoseMap {
  if (pose.proj === 'globe') {
    const v = { lon: pose.lon, lat: pose.lat, k: 1 };
    const f = { w: pose.w, h: pose.h, cx: pose.cx, cy: pose.cy, R: pose.k };
    return {
      fwd: (x, y) => lonLatToScreen(v, f, (x / W) * TAU - Math.PI, Math.PI / 2 - (y / H) * Math.PI),
      inv: (sx, sy) => {
        const ll = screenToLonLat(v, f, sx, sy);
        if (!ll) return null;
        const t = (ll[0] + Math.PI) / TAU;
        return [(t - Math.floor(t)) * W, ((Math.PI / 2 - ll[1]) / Math.PI) * H];
      },
    };
  }
  const mp = mapProj(pose.proj, (pose.lon * 180) / Math.PI, W, H);
  const lp = labelProjection(mp);
  const r = pose.k / mp.s;
  const ox = pose.cx - (r * W) / 2;
  const oy = pose.cy - (r * H) / 2;
  return {
    fwd: (x, y) => {
      const [mx, my] = lp.fwd(x, y);
      return [ox + mx * r, oy + my * r, 1];
    },
    inv: (sx, sy) => lp.inv((sx - ox) / r, (sy - oy) / r),
  };
}

/**
 * 起源落在第 0 年的星球上(推演时就是这样):有地形大事的世界换成最早那一段的州和宜居度。
 * world 也要是大事以前的那颗(陆地、海在哪)
 */
export function originCiv(civ: Civ): Civ {
  const e = civ.eras?.[0];
  return e ? { ...civ, regions: e.regions, habitat: e.habitat } : civ;
}

/** 列表上的一处起源 */
export interface OriginSpot {
  x: number;
  y: number;
  /** 落在哪一州(海上、湖上 = −1) */
  region: number;
  /** 推演时用得上(住得了人、不和前面的同一州) */
  ok: boolean;
  /** 列表上第一行:州名(落在水上 = "海上") */
  name: string;
  /** 第二行:地形(用得上时,"热带季雨林，沿海")或为什么用不上 */
  note: string;
}

/** 州治所的宜居分够不够住人(推演里的同一条规矩) */
function habitable(civ: Civ, r: number): boolean {
  return civ.habitat.suitability[civ.regions.seat[r]] >= HABITABLE_SUIT;
}

/** 这一州的地形:"稀树草原""热带季雨林，沿海" */
function regionTerrain(civ: Civ, r: number): string {
  const g = civ.regions;
  let coast = false;
  for (let k = g.cellStart[r]; k < g.cellStart[r + 1] && !coast; k++) if (civ.habitat.harbor[g.cells[k]] > 0) coast = true;
  const b = BIOMES[g.biome[r]]?.name ?? '';
  return coast ? `${b}，沿海` : b;
}

/** 点了的几处(世界坐标,按先后)在这颗星球上落在哪、用不用得上 */
export function originSpots(world: World, civ: Civ, pts: readonly number[]): OriginSpot[] {
  const out: OriginSpot[] = [];
  const seen = new Map<number, number>();
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    const r = originRegion(world, civ.regions, x, y);
    if (r < 0) {
      out.push({ x, y, region: -1, ok: false, name: '海上', note: '落在水上，创建时跳过' });
      continue;
    }
    const name = regionLabel(civ, r);
    if (!habitable(civ, r)) out.push({ x, y, region: r, ok: false, name, note: `${BIOMES[civ.regions.biome[r]]?.name ?? ''}住不了人，创建时跳过` });
    else if (seen.has(r)) out.push({ x, y, region: r, ok: false, name, note: `和第 ${seen.get(r)! + 1} 处在同一州，创建时跳过` });
    else {
      seen.set(r, out.length);
      out.push({ x, y, region: r, ok: true, name, note: regionTerrain(civ, r) });
    }
  }
  return out;
}

/** 在 (x, y) 放一处行不行:行 = null,不行 = 为什么(底下提示的那句) */
export function originRefusal(world: World, civ: Civ, x: number, y: number, spots: readonly OriginSpot[]): string | null {
  const c = nearestCell(world, x, y);
  if (c < 0) return null;
  const w = world.water[c];
  if (w === 1) return '这里是海，住不了人，换一处试试';
  if (w === 2) return '这里是湖，住不了人，换一处试试';
  const r = civ.regions.of[c];
  if (r < 0) return '这里住不了人，换一处试试';
  if (!habitable(civ, r)) return `这里是${BIOMES[civ.regions.biome[r]]?.name ?? '荒地'}，住不了人，换一处试试`;
  const same = spots.findIndex((s) => s.region === r);
  if (same >= 0) return `这一州已经放了第 ${same + 1} 处`;
  if (spots.length >= ORIGINS_MAX) return `最多 ${ORIGINS_MAX} 处，先拿掉一处再点`;
  return null;
}

/** 这颗星球自动的话一共几支民族(立国带来的新民族不算) */
export function autoPeoples(civ: Civ): number {
  return civ.cultures.filter((c) => c.pioneer === undefined).length;
}
