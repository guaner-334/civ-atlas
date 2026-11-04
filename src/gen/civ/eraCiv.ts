/**
 * 有地形大事的历史里,某一段的样子。不碰 DOM,后台线程和界面共用。
 */
import { keyCells, keySeats } from '../edits';
import type { Civ } from './types';

const eraCivs = new WeakMap<Civ, Civ[]>();

/** 第 k 段的历史:宜居度、州、地名、道路换成那一段的(最后一段 = 原样) */
export function civAtEra(civ: Civ, k: number): Civ {
  const eras = civ.eras;
  if (!eras?.length || k >= eras.length) return civ;
  let list = eraCivs.get(civ);
  if (!list) eraCivs.set(civ, (list = []));
  const hit = list[k];
  if (hit) return hit;
  const e = eras[k];
  const R = civ.regions;
  const out: Civ = {
    ...civ,
    habitat: e.habitat,
    // 州名、稳定键按最后一段的:大事以后新划的州也有名字,键在各段一样
    regions: { ...e.regions, name: R.name, keyOf: keyCells(R) as Int32Array, keySeat: keySeats(R) as Int32Array },
    places: e.places,
    routes: e.routes,
  };
  list[k] = out;
  return out;
}
