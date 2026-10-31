/**
 * 旋钮:推演里"调参"的那些数(开战的赔率、冷却几年、各种倍数……)登记成一张张表,每个子系统的文件里一张(或几张)。
 * 表里是名字和官方的值(说明写在每一项上面的注释里)。
 *
 * **每个世界可以带一套自己的数**:一套改动(KnobPatch,只写和官方不一样的项:表 id → 项名 → 值)配成一套数(KnobSet),
 * 推演按这个世界的那套数算。各文件不在载入时把表里的数取成常量,而是从这次推演带的那套数里取:
 *   - 推演里:引擎上挂着这次推演的那套数(CivSim.knobs),各模块装上、接着推时取一次(knobs.get(表)),之后照常用
 *   - 推演之外(讲故事、界面里现算人物、接着推):从世界带的那套数取(Civ.knobs,civ/knobs.ts 的 knobsOf)
 * 所以同一个线程里交替推两个用不同数的世界,彼此不串。官方那套(OFFICIAL_KNOBS)取出来的就是表本身的 values。
 */

/** 一项旋钮的值:一个数,或几个数(区间、按档的倍数……) */
export type KnobValue = number | readonly number[];

/** 一张旋钮表 */
export interface Knobs<T extends Record<string, KnobValue>> {
  /** 表的名字(子系统的文件名;一个文件里有几段调参的,第二段起带 #2、#3……) */
  readonly id: string;
  /** 各项官方的值 */
  readonly values: Readonly<T>;
  /** 各项的名字(照登记的先后) */
  readonly names: readonly (keyof T & string)[];
}

/** 登记一张旋钮表 */
export function defineKnobs<T extends Record<string, KnobValue>>(id: string, values: T): Knobs<T> {
  return { id, values, names: Object.keys(values) as (keyof T & string)[] };
}

/** 一套改动:表 id → 项名 → 值。只写和官方不一样的项;没有改动 = 官方 */
export type KnobPatch = { readonly [table: string]: { readonly [name: string]: KnobValue } };

/**
 * v 能不能当这一项的值(official = 官方的值):官方是一个数的,要一个数;官方是一串数的,要同样个数的一串数(都不能是 NaN)。
 * 只管形状;每一项合理的范围由开放给用的人调的那一层定(civ/tuning.ts:只开放其中几十项,范围、步长、取整都在那里)
 */
export function knobValueOk(official: KnobValue, v: unknown): v is KnobValue {
  const num = (x: unknown) => typeof x === 'number' && !Number.isNaN(x);
  if (typeof official === 'number') return num(v);
  return Array.isArray(v) && v.length === official.length && v.every(num);
}

/**
 * 一次推演用的一套数:各表按改动换掉改了的项,没改的表取出来就是表本身的 values(官方那套一张也不复制)。
 * 换过的表头一次取时配好、记着。改动里认不出的表、项,值不合用的项,当没有
 */
export class KnobSet {
  /** 改动(没有 = 官方) */
  readonly patch: KnobPatch | undefined;
  private readonly tables = new Map<string, object>();
  constructor(patch?: KnobPatch) {
    this.patch = patch;
  }
  /** 一张表在这套数里的值 */
  get<T extends Record<string, KnobValue>>(t: Knobs<T>): Readonly<T> {
    const p = this.patch?.[t.id];
    if (!p) return t.values;
    let v = this.tables.get(t.id) as Readonly<T> | undefined;
    if (!v) {
      const out: Record<string, KnobValue> = { ...t.values };
      for (const n of t.names) if (Object.prototype.hasOwnProperty.call(p, n) && knobValueOk(t.values[n], p[n])) out[n] = Array.isArray(p[n]) ? Object.freeze([...(p[n] as number[])]) : p[n];
      v = Object.freeze(out) as Readonly<T>;
      this.tables.set(t.id, v);
    }
    return v;
  }
}

/** 官方的那套数 */
export const OFFICIAL_KNOBS = new KnobSet();

const sets = new WeakMap<KnobPatch, KnobSet>();

/** 一份改动的那套数(同一个改动对象认同一套;没有改动 = 官方) */
export function knobSetOf(patch: KnobPatch | undefined): KnobSet {
  if (!patch) return OFFICIAL_KNOBS;
  let s = sets.get(patch);
  if (!s) sets.set(patch, (s = new KnobSet(patch)));
  return s;
}
