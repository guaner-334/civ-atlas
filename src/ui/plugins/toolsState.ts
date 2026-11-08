/** 插件工具在地图、侧栏那边要知道的几样;工具菜单、插件卡、点选本身在 tools/ 里,点开「工具」才下载 */
import type { MutableRefObject, RefObject } from 'react';
import type { Civ } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import { createStore } from '../createStore';
import type { MarkApi } from '../MarkLayer';

/** 地图那边交给工具的:这个世界(地图上那一段的;root = 换了世界才变的那份)、两份历史(套没套改名)、地图换算、地图那一层;active = 现在能用工具 */
export interface ToolsProps {
  phone: boolean;
  world: World;
  root: World;
  civ: Civ | null;
  raw: Civ | null;
  api: MutableRefObject<MarkApi | null>;
  stage: RefObject<HTMLElement>;
  active: boolean;
}

/** 工具菜单开着 */
export const toolsMenu = createStore(false);
/** 有插件卡占着卡片的位置(侧栏里 / 手机底部) */
export const toolCard = createStore(false);
/** 插件开着(工具按钮按下去的样子) */
export const toolRunning = createStore(false);
/** 插件卡挂进来的空位 */
export const toolSlot = createStore<HTMLElement | null>(null);

/** 插件请用的人在地图上点一处:点地图交给 done(地块编号) */
export interface ToolCellPick {
  done: (cell: number) => void;
}
export const toolCellPick = createStore<ToolCellPick | null>(null);

let closer: (() => void) | null = null;
/** 关掉插件卡的做法(工具那边挂上) */
export function setToolCloser(f: (() => void) | null): void {
  closer = f;
}
/** 关掉插件卡,插件跟着停 */
export function closeToolCard(): void {
  closer?.();
}
