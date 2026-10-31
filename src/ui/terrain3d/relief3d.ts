/**
 * 地区(地图上框一块单独看):这一包只在点「地区」时才下载(App 里按需加载),首页不变大。
 *   Pick.tsx       框一块(放在地图舞台里)
 *   Area.tsx       地区模式:平面图(RegionView.tsx,地区图)/ 立体(View.tsx)两面,盖住地图那一块;手机占满整屏
 *   Ghost.tsx      回到地图时刚才的框淡淡留一会儿
 *   stage.ts       立体的画布、镜头、拖动和手势;jobs.ts 后台线程(两面共用);region.ts 这一块叫什么;regionMap.ts 地区图的组装
 * 画法在 render/terrain3d/(立体)、render/regionMap.ts(地区图的四周、山峰),后台线程在 terrain3dWorker.ts。
 */
export { ReliefPick } from './Pick';
export { AreaView } from './Area';
export { ReliefGhost } from './Ghost';
