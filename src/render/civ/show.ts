/**
 * 文明层的开关(国家、民族、信仰、地名、战事……)和打开页面时的默认值。画法在 overlay.ts(那边照旧导出这几样);
 * 界面状态(ui/civView.ts)只用到开关本身,从这里拿,不用带上画法。
 */

/** 文明层的开关 */
export interface CivShow {
  /** 宜居度热力图 */
  habitat: boolean;
  /** 州界细线 */
  regions: boolean;
  /** 城址圆点 */
  sites: boolean;
  /** 道路与航线 */
  routes: boolean;
  /** 地名(默认打开) */
  labels: boolean;
  /** 民族色块 */
  cultures: boolean;
  /** 国家:国土、国界、城镇。和"民族"一起开时只画国界和城镇,色块是民族的 */
  polities: boolean;
  /** 信仰色块(信仰图层;开着时铺信仰,不铺民族、国土,国家只画国界和城镇) */
  faiths: boolean;
  /** 时代色块(时代图层;开着时按各州所处的时代铺色,画法同信仰,国家只画国界和城镇) */
  eras: boolean;
  /** 物产圆章(物产图层;州治上画这一年能用的物产,见 resources.ts) */
  resources: boolean;
  /** 战事:正在打的仗(战线、易手的州、交战处的双剑);要开着"国家"才画(默认打开) */
  wars: boolean;
  /** 瘟疫:正在闹、疫过不久的州铺墨点(plague.ts);要开着"国家"才画(默认打开) */
  plague: boolean;
}

export const CIV_SHOW_OFF: CivShow = {
  habitat: false,
  regions: false,
  sites: false,
  routes: false,
  labels: false,
  cultures: false,
  polities: false,
  faiths: false,
  eras: false,
  resources: false,
  wars: false,
  plague: false,
};
/** 打开页面时的默认显示:地名、战事、瘟疫(战事、瘟疫要开着"国家"才画) */
export const CIV_SHOW_DEFAULT: CivShow = { ...CIV_SHOW_OFF, labels: true, wars: true, plague: true };
