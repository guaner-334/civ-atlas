// 插件线程里的全局对象 civAtlas 的类型,给编辑器提示用(插件包里不用带)。
// 示例拷到别处时,把 src/plugin/types.ts 一起拷过去,改一下下面的路径
import type { CivAtlas } from '../../src/plugin/types';

declare global {
  const civAtlas: CivAtlas;
}
