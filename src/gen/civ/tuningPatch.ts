/**
 * 一套规则(tuning.ts 的 TuningValues:70 项里改过的那些项的值)换成推演用的一套旋钮改动(CivParams.knobs)。
 * 要查旋钮表里的官方值(civ/knobs.ts 的 CIV_KNOBS,连着各子系统的文件),所以和项表分开放:
 * 只读、清理、写摘要的地方(存档、链接、本机的「我的规则」)引用 tuning.ts 就够了,不用把整个推演载进来。
 * 纯计算,不碰 DOM。
 */
import { CIV_KNOBS } from './knobs';
import type { KnobPatch, KnobValue } from './engine/knobs';
import { TUNING_ITEMS, cleanTuning, type TuningItem, type TuningValue } from './tuning';

const tables = new Map(CIV_KNOBS.map((t) => [t.id, t]));
/** "表.项" 官方的值(登记表里没有就报错:编号对不上旋钮是写错了) */
function officialKnob(k: string): KnobValue {
  const [t, name] = k.split('.');
  const v = tables.get(t)?.values[name];
  if (v === undefined) throw new Error(`规则项改的旋钮 ${k} 不在旋钮表里`);
  return v;
}

/** 一项的值换成它改的那几处旋钮的值(值是清理过的) */
function knobValues(x: TuningItem, v: TuningValue): [string, KnobValue][] {
  if (x.kind === 'mult') {
    const m = v as number;
    return x.knobs.map((k) => {
      const o = officialKnob(k) as number;
      return [k, x.inv ? (m === 0 ? Infinity : o / m) : o * m];
    });
  }
  if (x.kind === 'range') {
    const [a, b] = v as readonly [number, number];
    return x.knobs.map((k) => [k, [a, b]]);
  }
  const kv = v === 'never' ? x.neverKnob! : v === 'off' ? x.offKnob! : (v as number);
  return x.knobs.map((k) => [k, kv]);
}

/**
 * 一套规则 → 推演用的一套旋钮改动(CivParams.knobs)。先过 cleanTuning(读进来的乱值不会变成乱旋钮);
 * 什么都没改 = undefined(官方)
 */
export function tuningPatch(values: unknown): KnobPatch | undefined {
  const clean = cleanTuning(values).values;
  const out: Record<string, Record<string, KnobValue>> = {};
  let any = false;
  for (const x of TUNING_ITEMS) {
    if (!(x.id in clean)) continue;
    for (const [k, kv] of knobValues(x, clean[x.id])) {
      const [t, name] = k.split('.');
      (out[t] ??= {})[name] = kv;
      any = true;
    }
  }
  return any ? out : undefined;
}
