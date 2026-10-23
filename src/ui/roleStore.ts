/**
 * 逐年推演里"你是谁"(和 civView.ts 一样的小 store;界面:开始窗口 / 推进设置的「你是」、顶上常驻的方针条 RoleBar.tsx):
 *
 *   造物主  照原来那样,哪国都能改(默认)
 *   演一国  认领一国(记它的稳定键):只管它 —— 别国卡片上的干预入口变灰、写一句"切回造物主才能改";导播默认关注它;
 *           顶上常驻一条"演 某国 · 方针 扩张 · 改方针 · 切回造物主"。不记分、不设限,随时能切回造物主
 *
 * 只认当前这个世界(记着是哪个世界认领的;换了世界、离开逐年推演就不算了);记在浏览器里,刷新以后还在。
 * 开始演绎时还没有那个世界(另存出来以后才打开):先记下要演哪国(armRole),进了逐年推演再认到新世界上(bindArmedRole)。
 * 纯状态,不碰 DOM(浏览器存储读写失败就只记在这次打开的页面里)。
 */
import { useSyncExternalStore } from 'react';
import { currentWorld } from './saveStore';

const KEY = 'wenming-ditu:play-role';

interface Role {
  /** 哪个世界认领的 */
  world: string;
  /** 演的那一国(国家的稳定键) */
  polity: string;
}

function load(): Role | null {
  try {
    const raw = localStorage.getItem(KEY);
    const o = raw ? (JSON.parse(raw) as Partial<Role>) : null;
    return o && typeof o.world === 'string' && typeof o.polity === 'string' ? { world: o.world, polity: o.polity } : null;
  } catch {
    return null;
  }
}

let role: Role | null = typeof window !== 'undefined' ? load() : null;
/** 开始演绎时挑好的那一国(还没有新世界);undefined = 没有要认的 */
let armed: { polity: string | null; from: string } | undefined;
let version = 0;
const subs = new Set<() => void>();

function emit() {
  version++;
  for (const f of subs) f();
}

function save() {
  try {
    if (role) localStorage.setItem(KEY, JSON.stringify(role));
    else localStorage.removeItem(KEY);
  } catch {
    // 存不进浏览器:这次打开的页面里照样记着
  }
}

/** 现在演的那一国(稳定键;造物主 / 不是这个世界认领的 = null) */
export function getRole(): string | null {
  const w = currentWorld()?.id;
  return role && w && role.world === w ? role.polity : null;
}

/** 认领一国(polity = 稳定键)/ 切回造物主(null) */
export function setRole(polity: string | null) {
  const w = currentWorld()?.id;
  const next = polity && w ? { world: w, polity } : null;
  if (JSON.stringify(next) === JSON.stringify(role)) return;
  role = next;
  save();
  emit();
}

/** 开始演绎:先记下要演哪国(null = 造物主),逐年推演的新世界打开以后再认上去 */
export function armRole(polity: string | null) {
  armed = { polity, from: currentWorld()?.id ?? '' };
}

/** 逐年推演的世界打开了:开始演绎时挑好的认上去;返回认上的那国(没有要认的 = undefined) */
export function bindArmedRole(): string | null | undefined {
  const w = currentWorld()?.id;
  if (!armed || !w || w === armed.from) return undefined;
  const p = armed.polity;
  armed = undefined;
  setRole(p);
  return p;
}

export function useRole(): string | null {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
    () => version,
  );
  return getRole();
}

/** 测试用 */
export function _resetRole() {
  role = null;
  armed = undefined;
  emit();
}
