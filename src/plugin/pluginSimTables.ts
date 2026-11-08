/**
 * 推演插件的表另一半的检查:公式能不能编译、读的表有没有、先后(after)绕没绕圈,要建一遍数表引擎才查得出。
 * 网页主线程不带数表引擎(不 import 这个文件),推演线程装插件时、服务器、单测查。纯计算
 */
import { TableEngine, TableSetupError } from '../gen/civ/engine/tables/engine';
import type { TableCard } from '../gen/civ/engine/tables/cards';
import { PluginFileError, openPluginFile, type OpenedPlugin } from './pluginFile';
import { OWNER_TABLE, type SimManifest } from './pluginSim';

/** 和引擎里插件按国记表时补的那张州 → 国的编号表一样 */
const OWNER_CARD: TableCard = { id: OWNER_TABLE, name: OWNER_TABLE, unit: 'region', kind: 'id', min: -1, max: 2 ** 15, off: -1 };
/** 只有一个州、没有邻州:查表的公式不用真的地图 */
const ONE_REGION = { count: 1, adjStart: new Int32Array(2), adj: new Int32Array(0), seat: new Int32Array(1) };

/** sim 段的表交给数表引擎建一遍(checkSimManifest 查过的);写错了抛 Error */
export function checkSimTables(sim: Pick<SimManifest, 'tables'>): void {
  const cards = sim.tables ?? [];
  if (!cards.length) return;
  const polity = cards.some((c) => c.unit === 'polity');
  try {
    new TableEngine({ seed: 0, cards: polity ? [...cards, OWNER_CARD] : cards, units: { region: ONE_REGION }, ...(polity ? { owner: OWNER_TABLE } : {}), backend: 'closure' });
  } catch (e) {
    throw new Error(`清单的 sim.tables:${e instanceof TableSetupError ? e.problems.join(';') : e instanceof Error ? e.message : String(e)}`);
  }
}

/** 打开、核对插件文件,推演插件连表的公式也查(同 openPluginFile:坏的抛 PluginFileError(broken)) */
export async function openPluginFileFully(file: Blob | Uint8Array): Promise<OpenedPlugin> {
  const p = await openPluginFile(file);
  if (p.manifest.role === 'sim' && p.manifest.sim) {
    try {
      checkSimTables(p.manifest.sim);
    } catch (e) {
      throw new PluginFileError('broken', e instanceof Error ? e.message : String(e));
    }
  }
  return p;
}
