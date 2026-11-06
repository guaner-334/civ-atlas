/**
 * 打开的世界文件和本机一个世界是同一个、内容不一样时问的那一下:正在问什么、选了哪个。
 * 窗口(SameWorldDialog.tsx)跟着打开文件的代码下载,首页只带这一小段和挂窗口的地方(SameWorldHost)。
 * 纯状态,不碰 DOM。
 */
import { createElement, useSyncExternalStore, type ComponentType } from 'react';

export type SameChoice = 'copy' | 'original' | 'cancel';

export interface AskLine {
  text: string;
  bold: boolean;
}

/** 并排的一份 */
export interface AskSide {
  title: string;
  /** 封面(dataURL);没有 = null */
  thumb: string | null;
  lines: AskLine[];
}

export interface SameAsk {
  /** 本机那个的名字 */
  title: string;
  mine: AskSide;
  theirs: AskSide;
  /** 除了时间,看得到的几项都一样 */
  alike: boolean;
  /** 另存的那份叫什么 */
  copyTitle: string;
  /** 本机那个就是正开着的:「打开原来的」就是留在这里,不给这个按钮 */
  open: boolean;
}

export type SameView = ComponentType<{ phone: boolean; ask: SameAsk }>;

let pending: { ask: SameAsk; view: SameView; done: (c: SameChoice) => void } | null = null;
const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** 问一下;前一个还开着就当它取消了 */
export function askSameWorld(ask: SameAsk, view: SameView): Promise<SameChoice> {
  pending?.done('cancel');
  return new Promise((done) => {
    pending = { ask, view, done };
    emit();
  });
}

export function answerSameWorld(c: SameChoice): void {
  const p = pending;
  if (!p) return;
  pending = null;
  emit();
  p.done(c);
}

export const sameWorldAsk = (): SameAsk | null => pending?.ask ?? null;

/** 首页和世界页都挂一个 */
export function SameWorldHost({ phone }: { phone: boolean }) {
  const p = useSyncExternalStore(subscribe, () => pending);
  return p ? createElement(p.view, { phone, ask: p.ask }) : null;
}
