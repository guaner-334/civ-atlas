/**
 * 世界的生成参数(滑条上的那些数)和默认值。生成总流程在 world.ts(那边照旧导出这两样);
 * 存档、网址、新建弹窗只用到参数本身,从这里拿,不用带上整套生成代码。
 */

/**
 * 生成参数(滑条上的那些数)。世界是一整颗星球:东西无缝、有南北极,主图是等距圆柱投影
 */
export interface WorldParams {
  seed: number;
  /** 大约多少个地块(越多越细,越慢):整颗球的地块数 */
  cells: number;
  landFraction: number;
  /** 板块一共几块(有大有小:几块巨大的 + 许多小的;越多陆地越碎、岛越多) */
  plates: number;
  mountains: number;
  temperature: number;
  rainfall: number;
  // ---- 大陆参数(新建时可调;默认值 = 加这几样之前的生成方式,老世界、老链接没有这几样时按默认值生成) ----
  /** 主要大陆几块(0 = 自动,按种子 2~5 块;另外的大岛、群岛照旧) */
  continents: number;
  /** 大陆聚在一起的程度(0 = 彼此尽量远,1 = 挤在一起,留出大片大洋) */
  gather: number;
  /** 破碎度(1 = 原样;小 = 大陆完整、海岸平直;大 = 支离破碎、岛多) */
  rugged: number;
  /** 板块硬度(1 = 原样;硬 = 内陆平坦、山脉窄;软 = 丘陵多、山脉宽) */
  hardness: number;
  /** 陆地偏向哪个半球(-1 南 … 0 均匀 … 1 北) */
  north: number;
}

export const DEFAULT_PARAMS: WorldParams = {
  seed: 1,
  cells: 36000,
  landFraction: 0.33,
  plates: 30,
  mountains: 1,
  temperature: 0,
  rainfall: 1,
  continents: 0,
  gather: 0,
  rugged: 1,
  hardness: 1,
  north: 0,
};
