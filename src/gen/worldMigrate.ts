/**
 * 世界文件里每一块都记着自己的结构版本(schema)。结构变了的时候,旧文件读进来先在这里逐级转到现在的结构,后面的代码只见得到现在的结构。
 *
 * 以后要改一块的结构,只做两件事:
 * 1. 在下面 MIGRATIONS 那一块的列表末尾加一步(第 k 项把第 k + 1 版转成第 k + 2 版)。现在的版本号就是步数 + 1,不用另外改
 * 2. 校验器(worldValidate.ts)和读这块的代码改成新结构
 *
 * 每一步的规矩:
 * - 只改结构,不改事实:字段换个写法、搬个地方可以;国界、人口、年份、文字这些世界里的事实一个不许动,也不许按现在的算法重算
 *   (编年史第 2 版那一步要用现在的代码算一遍,但只拿来核对:算出来和存的一字不差才换写法,对不上的留原文,文字一个字不变)
 * - 拿到的值是刚从文件解出来的一份,可以就地改,原件的字节碰不到;改完 return(必须有返回值)
 * - 转不了就抛错(什么错都行):这个世界会按「只读」提示(readonly),原件不动。不要猜着补数据
 *
 * 纯计算,不碰 DOM。
 */
import type { Civ } from './civ';
import type { ChronicleEntry } from './civ/story/chronicle';
import { chronicleFromV1 } from './civ/story/nameTokens';
import { WorldFileError, type WorldManifest } from './worldFormat';

/** 已经读好、转到现在的结构的那几块(按文件里的先后读;这一块排在后面才看得到前面的) */
export type MigratedParts = Readonly<{ civ?: Civ }>;

/** 一步迁移:把一块的值转成下一版结构。manifest = 这个文件的清单(只读,比如要看它是哪一版软件存的) */
export type MigrationStep = (value: unknown, manifest: Readonly<WorldManifest>, parts: MigratedParts) => unknown;

/** 每一块的迁移步骤;没列的块只有第 1 版 */
export type MigrationTable = Readonly<Record<string, readonly MigrationStep[]>>;

/**
 * 编年史第 1 版 → 第 2 版:第 1 版是算好的文字(ChronicleEntry[]),第 2 版文字里的名字是占位符(civ/story/nameTokens.ts)。
 * 文字是按存的时候的改名算的,配方里记着改名(只改了名、没重推的世界对不上,留原文)
 */
const chronicleV2: MigrationStep = (value, manifest, parts) => {
  if (!Array.isArray(value)) throw new Error('不是条目的列表');
  const stored = value as ChronicleEntry[];
  if (!parts.civ) return { entries: stored };
  const recipe = manifest.recipe as { edits?: { names?: Record<string, string> } };
  return chronicleFromV1(stored, parts.civ, recipe.edits?.names ?? {});
};

/** 现在的迁移步骤 */
export const MIGRATIONS: MigrationTable = {
  map: [],
  eras: [],
  civ: [],
  chronicle: [chronicleV2],
  flags: [],
  author: [],
  thumb: [],
};

function stepsOf(table: MigrationTable, name: string): readonly MigrationStep[] {
  return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : [];
}

/** 这一块现在是第几版结构 */
export function currentSchema(name: string, table: MigrationTable = MIGRATIONS): number {
  return stepsOf(table, name).length + 1;
}

/**
 * 把一块的值从第 schema 版逐级转到现在的结构,交回转好的值(已经是现在的版本就交回原值)。
 * 转不了(某一步抛错、没有返回值)报 readonly;比现在的版本新的报 newer(打开文件时已经拦过,这里再防一道)
 */
export function migratePart(name: string, schema: number, value: unknown, manifest: Readonly<WorldManifest>, table: MigrationTable = MIGRATIONS, parts: MigratedParts = {}): unknown {
  const steps = stepsOf(table, name);
  if (schema > steps.length + 1) throw new WorldFileError('newer', `${name} 这一块比软件新(第 ${schema} 版)`);
  let v = value;
  for (let from = schema; from <= steps.length; from++) {
    try {
      v = steps[from - 1](v, manifest, parts);
    } catch (err) {
      throw new WorldFileError('readonly', `${name} 这一块转不到第 ${from + 1} 版:${err instanceof Error ? err.message : String(err)}`);
    }
    if (v === undefined) throw new WorldFileError('readonly', `${name} 这一块转不到第 ${from + 1} 版`);
  }
  return v;
}
