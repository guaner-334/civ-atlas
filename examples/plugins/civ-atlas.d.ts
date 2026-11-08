// 插件拿到的全局对象 civAtlas 的类型,给编辑器提示用(插件包里不用带)。
// 工具插件(runtime worker)拿到的是 CivAtlas 那些调用;推演插件、地图插件(runtime quickjs)只有 civAtlas.sim 或 civAtlas.map,和 civAtlas.params。
// 示例拷到别处时:工具插件把 src/plugin/types.ts 一起拷过去、改一下下面的路径;推演插件只要 civ-atlas-sim.d.ts,地图插件只要 civ-atlas-map.d.ts
import type { CivAtlas } from '../../src/plugin/types';
import type { CivAtlasSim } from './civ-atlas-sim';
import type { CivAtlasMap } from './civ-atlas-map';

declare global {
  const civAtlas: CivAtlas & CivAtlasSim & CivAtlasMap;
}
