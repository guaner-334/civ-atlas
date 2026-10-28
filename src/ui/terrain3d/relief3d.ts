/**
 * 立体地形(地图上框一块立起来看):这一包只在点「立体」时才下载(App 里按需加载),首页不变大。
 *   Pick.tsx  框一块(放在地图舞台里)
 *   View.tsx  立体模式(盖住地图那一块;手机占满整屏)
 *   stage.ts  画布、镜头、拖动和手势;jobs.ts 后台线程;region.ts 这一块叫什么
 * 画法、网格、镜头的计算在 render/terrain3d/,后台线程在 terrain3dWorker.ts。
 */
export { ReliefPick } from './Pick';
export { ReliefView } from './View';
