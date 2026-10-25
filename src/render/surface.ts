/**
 * 写实地貌的几种画法(同一份地形,只换颜色、明暗、纹理强弱、河画多少;不改海岸、河网、山脊的位置):
 *   classic = 经典卫星(原来的实景画法,原样保留)
 *   detail  = 卫星(细节):像从太空拍的照片 —— 陆地按植被覆盖度连续上色(沙黄 → 草地 → 深林),远洋一片深蓝,浅暖海泛青绿
 *   simple  = 简化卫星:和细节同一套颜色,纹理和起伏都轻,河更少
 *   geo     = 地理图:像地图册 —— 陆地按海拔分层设色、海按深度分层,中性灰晕渲,海岸描线,荒漠打点,河蓝而多
 *   geoMute = 地理图叠了国家 / 民族 / 信仰 / 时代颜色时的那一份:陆地的层色褪色,颜色让给填色(界面上还是「地理图」,网址、存档不记它)
 *   blank   = 白模:海陆平涂(海两档浅蓝、陆地近白、冰雪纯白),不画起伏和纹理
 * 画法的参数见 realistic.ts 的 MATERIALS。
 */
export const SURFACE_LOOKS = ['classic', 'detail', 'geo', 'blank', 'simple', 'geoMute'] as const;
export type SurfaceLook = (typeof SURFACE_LOOKS)[number];

export function isSurfaceLook(x: unknown): x is SurfaceLook {
  return SURFACE_LOOKS.includes(x as SurfaceLook);
}

