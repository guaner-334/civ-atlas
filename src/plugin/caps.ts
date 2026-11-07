/**
 * 插件接口的每个调用、每种事件要哪样能力(能力名表在 pluginCaps.ts);开插件时按清单算给了哪些。
 * 纯数据和纯计算,不碰 DOM。
 */
import { CAP_NAME, PLUGIN_CAPS } from './pluginCaps';
import type { CapRef } from './types';

/**
 * 每个调用要哪样能力(有其中一样就行;空 = 谁都能调)。
 * 线程里的 civAtlas 照这张表长出同名的函数(store.local.get → civAtlas.store.local.get)
 */
export const PLUGIN_METHODS: Readonly<Record<string, readonly CapRef[]>> = {
  'host.info': [],
  log: [],
  'world.info': ['world.read@1'],
  'world.cells': ['world.read@1'],
  'world.neighbors': ['world.read@1'],
  'world.rivers': ['world.read@1'],
  'world.legend': ['world.read@1'],
  'history.span': ['history.read@1'],
  'history.at': ['history.read@1'],
  'history.polities': ['history.read@1'],
  'history.settlements': ['history.read@1'],
  'history.routes': ['history.read@1'],
  'history.places': ['history.read@1'],
  'history.cultures': ['history.read@1'],
  'history.faiths': ['history.read@1'],
  'history.regions': ['history.read@1'],
  'history.people': ['history.read@1'],
  'history.events': ['history.read@1'],
  'author.marks': ['author.read@1'],
  'author.names': ['author.read@1'],
  'author.characters': ['author.read@1'],
  'author.interventions': ['author.read@1'],
  'author.notes': ['author.read@1'],
  'author.apply': ['author.write@1'],
  'view.get': ['view.read@1'],
  'pick.cell': ['input.pick@1'],
  'pick.cells': ['input.pick@1'],
  'pick.box': ['input.pick@1'],
  'panel.set': ['ui.panel@1'],
  'panel.clear': ['ui.panel@1'],
  'layer.cells': ['layer.cells@1'],
  'layer.marks': ['layer.marks@1'],
  'layer.remove': ['layer.cells@1', 'layer.marks@1'],
  'store.local.get': ['store.local@1'],
  'store.local.set': ['store.local@1'],
  'store.world.get': ['store.world@1'],
  'store.world.set': ['store.world@1'],
};

/** 网站发给插件的事件要哪样能力 */
export const PLUGIN_EVENTS: Readonly<Record<string, CapRef>> = {
  'view.year': 'view.read@1',
  'view.select': 'view.read@1',
  'panel.action': 'ui.panel@1',
};

/** requires 和 optional 加起来最多几项(和插件文件的检查一样) */
const CAPS_MAX = 32;

export type CapsCheck =
  | { ok: true; requires: CapRef[]; optional: CapRef[] }
  /** broken = 写法不对;newer = 要的能力这一版网站没有(要更新网站) */
  | { ok: false; kind: 'broken' | 'newer'; text: string };

/**
 * 查清单里要的能力,规矩和插件文件的检查一样:写法不对、写了两遍(两边都写也算)是 broken;
 * requires 有一样网站没有是 newer,不开;optional 里网站没有的不给,照样开
 */
export function checkCaps(requires: unknown, optional?: unknown): CapsCheck {
  const seen = new Set<string>();
  const read = (raw: unknown, what: string): string[] | string => {
    if (raw === undefined && what === 'optional') return [];
    if (!Array.isArray(raw)) return `${what} 要是数组`;
    for (const c of raw) {
      if (typeof c !== 'string' || !CAP_NAME.test(c)) return `${what} 里的 ${String(c).slice(0, 64)} 不是「名字@版本」`;
      if (seen.has(c)) return `${c} 写了两遍`;
      seen.add(c);
    }
    return seen.size > CAPS_MAX ? '要的能力太多' : (raw as string[]);
  };
  const req = read(requires, 'requires');
  if (typeof req === 'string') return { ok: false, kind: 'broken', text: req };
  const opt = read(optional, 'optional');
  if (typeof opt === 'string') return { ok: false, kind: 'broken', text: opt };
  for (const c of req) if (!PLUGIN_CAPS.has(c)) return { ok: false, kind: 'newer', text: `要更新网站才能用:插件要的 ${c} 这一版网站还没有` };
  return { ok: true, requires: req as CapRef[], optional: opt.filter((c) => PLUGIN_CAPS.has(c)) as CapRef[] };
}
