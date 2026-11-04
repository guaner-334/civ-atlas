/**
 * 世界文件里每一块都记着自己的结构版本(schema)。结构变了的时候,旧文件读进来先在这里逐级转到现在的结构,后面的代码只见得到现在的结构。
 *
 * 以后要改一块的结构,只做两件事:
 * 1. 在下面 MIGRATIONS 那一块的列表末尾加一步(第 k 项把第 k + 1 版转成第 k + 2 版)。现在的版本号就是步数 + 1,不用另外改
 * 2. 校验器(worldValidate.ts)和读这块的代码改成新结构
 *
 * 每一步的规矩:
 * - 只改结构,不改事实:字段换个写法、搬个地方可以;国界、人口、年份、文字这些世界里的事实一个不许动,也不许按现在的算法重算
 * - 拿到的值是刚从文件解出来的一份,可以就地改,原件的字节碰不到;改完 return(必须有返回值)
 * - 转不了就抛错(什么错都行):这个世界会按「只读」提示(readonly),原件不动。不要猜着补数据
 *
 * 纯计算,不碰 DOM。
 */
import { WorldFileError, type WorldManifest } from './worldFormat';

/** 一步迁移:把一块的值转成下一版结构。manifest = 这个文件的清单(只读,比如要看它是哪一版软件存的) */
export type MigrationStep = (value: unknown, manifest: Readonly<WorldManifest>) => unknown;

/** 每一块的迁移步骤;没列的块只有第 1 版 */
export type MigrationTable = Readonly<Record<string, readonly MigrationStep[]>>;

/** 现在的迁移步骤(第 1 版,还没有) */
export const MIGRATIONS: MigrationTable = {
  map: [],
  eras: [],
  civ: [],
  chronicle: [],
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
export function migratePart(name: string, schema: number, value: unknown, manifest: Readonly<WorldManifest>, table: MigrationTable = MIGRATIONS): unknown {
  const steps = stepsOf(table, name);
  if (schema > steps.length + 1) throw new WorldFileError('newer', `${name} 这一块比软件新(第 ${schema} 版)`);
  let v = value;
  for (let from = schema; from <= steps.length; from++) {
    try {
      v = steps[from - 1](v, manifest);
    } catch (err) {
      throw new WorldFileError('readonly', `${name} 这一块转不到第 ${from + 1} 版:${err instanceof Error ? err.message : String(err)}`);
    }
    if (v === undefined) throw new WorldFileError('readonly', `${name} 这一块转不到第 ${from + 1} 版`);
  }
  return v;
}
