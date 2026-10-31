/**
 * 国旗(规则见 gen/civ/flags.ts):App 按"世界 + 套了改名的历史 + 作者改过的旗"算出所有国家历代的旗,放在这里交给
 * 国家卡片、列表、地图上的国都城堡(useFlags)。算一次几毫秒,改名、改旗时重算。
 *
 * 预览:「换一面」点一面、「自己改」边改边看时,那一面先"假装"已经改了(卡片和地图马上换成它),
 * 点「用这面」「完成」才记进修改(editsStore 的 setFlags,能撤销);关掉不点 = 不换。
 */
import type { World } from '../gen/world';
import type { Civ } from '../gen/civ/types';
import { flagBook, flagOverrides, polityFlagAt, type FlagBook, type FlagEra, type FlagSpec } from '../gen/civ/flags';
import { createStore } from './createStore';

export interface FlagView {
  world: World;
  civ: Civ;
  book: FlagBook;
}

const view = createStore<FlagView | null>(null);

/** App 算好以后放进来 */
export function setFlagView(v: FlagView | null) {
  view.set(v);
}

/** 现在这个世界的旗(还没有历史 = null;不跟着重画时用) */
export const getFlags = (): FlagView | null => view.get();

/** 现在这个世界的旗(还没有历史 = null) */
export function useFlags(): FlagView | null {
  return view.use();
}

/** 某国某年的那一面(没立国 = 第一面,已亡 = 最后一面) */
export function flagOf(v: FlagView | null, id: number, year: number): FlagEra | null {
  return v ? polityFlagAt(v.book, id, year) : null;
}

// ---- 预览 ----

export interface FlagPreview {
  key: string;
  spec: FlagSpec;
}

const preview = createStore<FlagPreview | null>(null);

export function setFlagPreview(p: FlagPreview | null) {
  preview.set(p);
}

export function useFlagPreview(): FlagPreview | null {
  return preview.use();
}

/** 算旗:作者改过的 + 正在预览的那一面。geo = 按哪份地形配(有地形大事时是第一件以前的那一份;不给 = world、civ) */
export function makeFlagView(
  world: World,
  civ: Civ,
  flags: Readonly<Record<string, string>> | undefined,
  p: FlagPreview | null,
  geo?: { world: World; civ: Civ },
): FlagView {
  const ov = flagOverrides(flags);
  if (p) ov[p.key] = p.spec;
  return { world, civ, book: flagBook(geo?.world ?? world, geo?.civ ?? civ, ov) };
}
