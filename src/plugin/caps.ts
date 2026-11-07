/**
 * 插件接口的能力表:清单 requires / optional 里写 `名字@大版本`,网站只给写了的;每个调用归哪样能力。
 * 纯数据和纯计算,插件包的检查、网站这边的接口、以后的服务器共用。
 */
import type { CapName } from './types';

/** 整套接口的大版本 */
export const PLUGIN_API = 1;

/** 网站认得的能力和各自支持到第几版 */
export const PLUGIN_CAPS: Readonly<Record<CapName, number>> = {
  'world.read': 1,
  'history.read': 1,
  'author.read': 1,
  'author.write': 1,
  'view.read': 1,
  'input.pick': 1,
  'ui.panel': 1,
  'layer.cells': 1,
  'layer.marks': 1,
  'store.local': 1,
  'store.world': 1,
};

/**
 * 每个调用要哪样能力(有其中一样就行;空 = 谁都能调)。
 * 线程里的 civAtlas 照这张表长出同名的函数(store.local.get → civAtlas.store.local.get)
 */
export const PLUGIN_METHODS: Readonly<Record<string, readonly CapName[]>> = {
  'host.info': [],
  log: [],
  'world.info': ['world.read'],
  'world.cells': ['world.read'],
  'world.neighbors': ['world.read'],
  'world.rivers': ['world.read'],
  'world.legend': ['world.read'],
  'history.span': ['history.read'],
  'history.at': ['history.read'],
  'history.polities': ['history.read'],
  'history.settlements': ['history.read'],
  'history.routes': ['history.read'],
  'history.places': ['history.read'],
  'history.cultures': ['history.read'],
  'history.faiths': ['history.read'],
  'history.regions': ['history.read'],
  'history.people': ['history.read'],
  'history.events': ['history.read'],
  'author.marks': ['author.read'],
  'author.names': ['author.read'],
  'author.characters': ['author.read'],
  'author.interventions': ['author.read'],
  'author.notes': ['author.read'],
  'author.apply': ['author.write'],
  'view.get': ['view.read'],
  'pick.cell': ['input.pick'],
  'pick.cells': ['input.pick'],
  'pick.box': ['input.pick'],
  'panel.set': ['ui.panel'],
  'panel.clear': ['ui.panel'],
  'layer.cells': ['layer.cells'],
  'layer.marks': ['layer.marks'],
  'layer.remove': ['layer.cells', 'layer.marks'],
  'store.local.get': ['store.local'],
  'store.local.set': ['store.local'],
  'store.world.get': ['store.world'],
  'store.world.set': ['store.world'],
};

/** 网站发给插件的事件要哪样能力 */
export const PLUGIN_EVENTS: Readonly<Record<string, CapName>> = {
  'view.year': 'view.read',
  'view.select': 'view.read',
  'panel.action': 'ui.panel',
};

/** 清单里一项能力的写法 */
const CAP_REF = /^([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)@([1-9]\d{0,3})$/;
/** 一份清单最多写几项能力 */
export const CAPS_MAX = 32;

export type CapsCheck =
  | { ok: true; requires: CapName[]; optional: CapName[] }
  /** broken = 写法不对;newer = 要的能力这一版网站没有(要更新网站) */
  | { ok: false; kind: 'broken' | 'newer'; text: string };

const isCap = (name: string): name is CapName => Object.prototype.hasOwnProperty.call(PLUGIN_CAPS, name);

function parseList(raw: unknown, what: string): { name: string; v: number }[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return `${what} 要是数组`;
  if (raw.length > CAPS_MAX) return `${what} 最多 ${CAPS_MAX} 项`;
  const out: { name: string; v: number }[] = [];
  for (const x of raw) {
    const m = typeof x === 'string' ? CAP_REF.exec(x) : null;
    if (!m) return `${what} 里的 ${JSON.stringify(x)?.slice(0, 80)} 不是「名字@版本」`;
    out.push({ name: m[1], v: Number(m[2]) });
  }
  return out;
}

/**
 * 查清单里要的能力。requires 有一项网站没有(或要的版本比网站新)就不装;optional 里网站没有的不给,照样能装。
 * 两边都写了的算 requires
 */
export function checkCaps(requires: unknown, optional?: unknown): CapsCheck {
  const req = parseList(requires, 'requires');
  if (typeof req === 'string') return { ok: false, kind: 'broken', text: req };
  const opt = parseList(optional, 'optional');
  if (typeof opt === 'string') return { ok: false, kind: 'broken', text: opt };
  const need = new Set<CapName>();
  for (const { name, v } of req) {
    if (!isCap(name) || v > PLUGIN_CAPS[name]) return { ok: false, kind: 'newer', text: `要新版网站才有 ${name}@${v}` };
    need.add(name);
  }
  const may = new Set<CapName>();
  for (const { name, v } of opt) if (isCap(name) && v <= PLUGIN_CAPS[name] && !need.has(name)) may.add(name);
  return { ok: true, requires: [...need], optional: [...may] };
}
