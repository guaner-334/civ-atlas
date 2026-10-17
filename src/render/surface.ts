/**
 * 写实地貌的几种画法(同一份地形,只换颜色、明暗、纹理强弱、河画多少;不改海岸、河网、山脊的位置):
 *   classic = 经典卫星(原来的实景画法,原样保留)
 *   detail  = 细节卫星:深海安静成一片,陆地的细节晕渲、纹理更重,大尺度的明暗面更轻
 *   geo     = 地理图:海盆、洋中脊、大陆架分得清,陆地按植被分区上色,河更多
 *   blank   = 白模:海陆平涂(海两档浅蓝、陆地近白、冰雪纯白),不画起伏和纹理
 * 画法的参数见 realistic.ts 的 MATERIALS。
 */
export const SURFACE_LOOKS = ['classic', 'detail', 'geo', 'blank'] as const;
export type SurfaceLook = (typeof SURFACE_LOOKS)[number];

export function isSurfaceLook(x: unknown): x is SurfaceLook {
  return SURFACE_LOOKS.includes(x as SurfaceLook);
}

