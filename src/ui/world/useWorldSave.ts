/**
 * 存档那一边要 App 接上的几样(存档本身在 ../saveStore.ts,结果的原件在 ../resultStore.ts):
 *   useAutoSave   自动存、自动恢复、读档;建好的世界推完以后,把这次的结果(原件)存进浏览器
 *   useSaveThumbs 缩略图("我的世界"的卡片、存档菜单、「地图」页签);推演完记下结束那一年现存几国
 * 两样在 App 里分开调,各放在原来那一段的位置(和前后别的 effect 的先后不变)
 */
import { useEffect } from 'react';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import { CIV_SHOW_OFF, civOverlaySteps, drawCivOverlay, type CivDrawParams } from '../../render/civ/overlay';
import { getEdits } from '../editsStore';
import { eraData, eraIndex, eraReady } from '../eras';
import { THUMB_H, THUMB_W, currentWorld, setMapThumbMaker, setThumbMaker, setWorldStats, startAutoSave } from '../saveStore';
import { startResults } from '../resultStore';
import { terrainStroking } from '../TerrainTools';
import { baseReady, overlayReady } from '../thumbPrep';
import type { CivRefs, GenRefs, MapRefs, Ref } from './worldRefs';
import { aliveAtEnd } from './worldTarget';

/** 自动存、自动恢复、读档;建好的世界推完以后把这次的结果(原件)存进浏览器 */
export function useAutoSave(): void {
  // ---- 存档(阶段 4):自动存、自动恢复、读档 ----
  useEffect(() => startAutoSave(), []);
  // 建好的世界推完以后,把这次的结果(原件)存进浏览器
  useEffect(() => startResults(), []);
}

/** 世界和主图(地图上画的、缩略图要画的那一段) */
type WorldData = { world: World; raster: Raster };

/** useSaveThumbs 要的 App 状态 */
export interface SaveThumbsDeps {
  gen: Pick<GenRefs, 'targetRef' | 'fresh' | 'regenRef' | 'rawRef'>;
  civ: Pick<CivRefs, 'civLater'>;
  map: Pick<MapRefs, 'baseRef' | 'eraMapsRef' | 'eraPatches'>;
  /** 地图上画着的那一段(还没有世界 = null) */
  dataRef: Ref<WorldData | null>;
  /** 正在按新的干预重推历史(缩略图等推完再截) */
  resimRef: Ref<boolean>;
  /** 地图上这份历史(推演完、重推以后换一份) */
  rawCiv: Civ | null;
  /** 画好的整张底图的缓存(App「渲染」那一段在后面才定义,经这里调) */
  later: {
    /** d 这一张图的缓存(画风 / 图层 → 离屏画布) */
    mapsOf: (d: { raster: Raster }) => Map<string, HTMLCanvasElement>;
    /** 某画风的整张底图:缓存里有就直接给,没有就画一张放进缓存 */
    baseCanvas: (key: string, d?: WorldData) => HTMLCanvasElement | null;
  };
}

/** 缩略图("我的世界"的卡片、存档菜单、地图缩略图)交给 saveStore 来要;推演完记下结束那一年现存几国 */
export function useSaveThumbs(deps: SaveThumbsDeps): void {
  const { targetRef, fresh, regenRef, rawRef } = deps.gen;
  const { civLater } = deps.civ;
  const { baseRef, eraMapsRef, eraPatches } = deps.map;
  const { dataRef, resimRef, rawCiv } = deps;
  const { mapsOf, baseCanvas } = deps.later;
  // 缩略图("我的世界"的卡片、存档菜单):手绘风的地形 480×240;建好的世界叠上结束那一年的国家色块(和正在看哪个图层、哪一年无关)。
  // 地形是结束那一年的(地形大事以后的那一段)。世界还在生成、按新地形重新生成、按新的干预重推历史、那一段的主图还没铺好时 = null,
  // saveStore 过一会儿再来要;编辑地形正涂着(手指、鼠标按着)也先不截。
  // 还没补推历史(编辑地形时生成的):新建中、没有地形大事的不叠国家、地形就是第 0 年的,不再等的那一次(now)照样截
  useEffect(() => {
    setThumbMaker((id, now) => {
      const t = targetRef.current;
      const b = baseRef.current;
      if (!dataRef.current || !b || fresh.current || regenRef.current || resimRef.current || !t || t.id !== id) return null;
      if (!now && terrainStroking()) return null;
      if (civLater.current && !(now && currentWorld()?.kind === 'draft' && !getEdits().upheavals?.length)) return null;
      const kEnd = eraIndex(rawRef.current, null);
      if (!eraReady(eraMapsRef.current, eraPatches.current, kEnd)) return null;
      const d = eraData(b, eraMapsRef.current, eraPatches.current, kEnd);
      // 整张底图先在后台分小步备好(ui/thumbPrep.ts),不在主线程上一口气画
      if (!now && !mapsOf(d).has('fantasy') && !baseReady('fantasy', d.world, d.raster)) return null;
      const rc = rawRef.current;
      const kind = currentWorld()?.kind;
      const cp: CivDrawParams | null =
        kind !== 'draft' && rc && rc.viable && rc.habitat.suitability.length === d.world.mesh.n
          ? { world: d.world, raster: d.raster, civ: rc, style: 'fantasy', year: rc.endYear, show: { ...CIV_SHOW_OFF, polities: true }, thumb: true }
          : null;
      // 国家色块、国界也先在后台分小步备好
      if (!now && cp && !overlayReady(cp.civ, cp.raster, () => civOverlaySteps(cp))) return null;
      const base = baseCanvas('fantasy', d);
      if (!base) return null;
      const cv = document.createElement('canvas');
      cv.width = THUMB_W;
      cv.height = THUMB_H;
      const x = cv.getContext('2d');
      if (!x) return null;
      x.imageSmoothingQuality = 'high';
      x.drawImage(base, 0, 0, cv.width, cv.height);
      if (cp) {
        const ov = document.createElement('canvas');
        ov.width = d.raster.w;
        ov.height = d.raster.h;
        const octx = ov.getContext('2d');
        if (octx) {
          drawCivOverlay(octx, cp);
          x.drawImage(ov, 0, 0, cv.width, cv.height);
        }
        ov.width = ov.height = 0;
      }
      const url = cv.toDataURL('image/jpeg', 0.8);
      cv.width = cv.height = 0;
      return url;
    });
    // 地图缩略图(我的世界的「地图」页签):实景、第 0 年的地形(地形大事以前),不带国界和地名
    setMapThumbMaker((id, now) => {
      const t = targetRef.current;
      const b = baseRef.current;
      if (!b || fresh.current || regenRef.current || !t || t.id !== id) return null;
      if (!now && terrainStroking()) return null;
      if (!now && !mapsOf(b).has('realistic') && !baseReady('realistic', b.world, b.raster)) return null;
      const base = baseCanvas('realistic', b);
      if (!base) return null;
      const cv = document.createElement('canvas');
      cv.width = THUMB_W;
      cv.height = THUMB_H;
      const x = cv.getContext('2d');
      if (!x) return null;
      x.imageSmoothingQuality = 'high';
      x.drawImage(base, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL('image/jpeg', 0.8);
      cv.width = cv.height = 0;
      return url;
    });
    return () => {
      setThumbMaker(null);
      setMapThumbMaker(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 推演完(重推历史以后也是):结束那一年现存几国记下来,我的世界的卡片上写
  useEffect(() => {
    const cur = currentWorld();
    if (!rawCiv || !cur || cur.kind === 'draft' || cur.id !== targetRef.current?.id || fresh.current) return;
    setWorldStats(aliveAtEnd(rawCiv));
  }, [rawCiv]);
}
