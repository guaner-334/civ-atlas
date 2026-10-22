/**
 * 后台线程交来的编年史(src/chronicleParts.ts):一块一块收齐,等那份历史换上时记进编年史的缓存,主线程不再整段重算。
 *
 * 线程交历史之前先交这份历史的编年史(按发请求时的改名算);交历史的那条消息带着编年史的编号,对上了就按这份历史的史事数组
 * (civ.annals)记下 —— 换上时沿用州(eras.ts 的 reuseRegions)、套改名(applyNames)出来的新对象都共用这个数组。
 * 界面用的整段历史(App 的 realFull)由 namedHistory 套改名:改名和线程算的时候一样,就把这份记进缓存;
 * 不一样(算的时候又改了名)就照旧在主线程上算。
 */
import { joinChronicleParts, type ChroniclePart } from '../chronicleParts';
import { primeChronicle, type ChronicleEntry } from '../gen/civ/chronicle';
import { primeFullChronicle } from '../gen/civ/religionText';
import { applyNames } from '../gen/edits';
import type { Civ } from '../gen/civ';

interface Ready {
  names: Record<string, string>;
  build: ChronicleEntry[];
  full: ChronicleEntry[];
  /** 已经记进过缓存 */
  used?: boolean;
}

const ready = new WeakMap<object, Ready>();
/** 收到了、还没等到那份历史的块 */
let inbox: ChroniclePart[] = [];

/** 线程交来一块(第一块到了,之前没收齐的作废) */
export function takeChroniclePart(p: ChroniclePart) {
  if (p.part === 0) inbox = [];
  inbox.push(p);
}

/** 线程交来一份历史(key = 它的编年史的编号;没有 = 线程没算):收齐了就记下 */
export function adoptChronicle(civ: Civ | null | undefined, key: number | undefined) {
  const parts = inbox;
  inbox = [];
  if (!civ || key === undefined) return;
  const got = joinChronicleParts(parts, key);
  if (got) ready.set(civ.annals, got);
}

/** 线程换了一个(旧线程交了一半的不要了) */
export function dropChronicleParts() {
  inbox = [];
}

function sameNames(a: Record<string, string>, b: Record<string, string>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/** 整段历史套上改名(同 applyNames);线程按同样的改名算好了编年史的,记进缓存 */
export function namedHistory(raw: Civ, names: Record<string, string>): Civ {
  const out = applyNames(raw, names);
  const r = ready.get(raw.annals);
  if (r) {
    if (sameNames(r.names, names)) {
      primeChronicle(out, r.build);
      primeFullChronicle(out, r.full);
      r.used = true;
    } else if (r.used) ready.delete(raw.annals); // 用过了、后来又改了名:这份用不上了,放掉(还没用上的留着:换上那一刻改名可能还没套上)
  }
  return out;
}
