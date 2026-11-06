/**
 * 推不下去(世界的历史停在算不下去的那一年,Civ.stuck):那张卡开没开、这次是怎么推的(卡上的说法和按钮跟着变)。
 * 只有刚算出来的那一次自动弹卡(等时间轴走到停住那年);读存下的世界打开不弹,时间轴上「推不下去」点了再看。
 * 纯状态,不碰 DOM。
 */
import { createStore } from './createStore';
import type { Intervention } from '../gen/edits';

/** 这次是怎么推出来的:新建 / 另存重推 / 打开别人分享的(new),改了一条干预重推(iv),再推(extend) */
export type StuckWhy =
  | { kind: 'new' }
  /** label = 这条干预怎么称呼(和下了以后那条提示条上一样) */
  | { kind: 'iv'; iv: Intervention; label: string }
  | { kind: 'extend'; from: number; undo: () => void };

export interface StuckState {
  /** 读存下的世界打开的 = null(只照规则说) */
  why: StuckWhy | null;
  /** 等着弹:时间轴停在停住那年(或放到那里停下)时弹 */
  pending: boolean;
  open: boolean;
}

const IDLE: StuckState = { why: null, pending: false, open: false };
const store = createStore<StuckState>(IDLE);

export const getStuck = store.get;
export const useStuck = store.use;

/** 刚算出来的一份历史换上了:推不下去的等着弹卡;推完的收起 */
export function noteStuck(stuck: boolean, why: StuckWhy): void {
  store.set(stuck ? { why, pending: true, open: false } : IDLE);
}

/** 换了世界、读存下的打开、撤销回推完的那份:收起,不弹 */
export function resetStuck(): void {
  store.set(IDLE);
}

export function openStuck(): void {
  store.update((s) => ({ ...s, pending: false, open: true }));
}

export function closeStuck(): void {
  store.update((s) => (s.open || s.pending ? { ...s, pending: false, open: false } : s));
}

/** 网址带 simFail=1820:推演推过那一年就故意出错(冒烟检查、截图看推不下去时的样子) */
export function simFailOpt(): { simFail?: number } {
  const v = Number(new URLSearchParams(location.search).get('simFail'));
  return Number.isFinite(v) && v > 0 ? { simFail: v } : {};
}
