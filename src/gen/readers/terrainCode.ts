/**
 * 地貌读取代码对外的样子:一个版本的地貌读取器就是这份清单。
 * 只转出,不写算法。老版本的存底里也有一份这个文件(见 index.ts),转出的是存底里的旧代码。
 */
export { finishGully, finishVeins, gullyHeights, rasterize, rasterizeDeferred, rasterizeDeferredSteps, streamsOf, veinsOf } from '../raster';
export { WINDOW_PAD, rasterizeWindow, zoomSource } from '../rasterWindow';
export { composeOnto, composeRaster, diffRaster } from '../rasterPatch';
export { streamBeds } from '../pixelDrain';
export { CREEK_FRAC, creeksOf } from '../creeks';
export { riverGeometry } from '../riverGeometry';
