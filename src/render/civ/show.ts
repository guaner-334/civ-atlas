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
  /** 管辖色块(管辖图层;开着时按中央管得到几成给各州铺色,画法同时代,国家只画国界和城镇;割据的州国界照旧画在原国里) */
  control: boolean;
  /**
   * 思潮色块(思潮图层;一次看一说,各州按信这一说的有几成铺一种颜色的五档深浅,画法同管辖,国家只画国界和城镇;见 thoughts.ts)。
   * 看哪一说是 thought(THOUGHTS 的下标;没给 = 这一年到半成的州最多的那说)
   */
  ideology: boolean;
  /** 思潮图层看哪一说(网址 ideo=;没给 / 那一年还没有人倡 = 默认的那说,见 thoughts.ts 的 thoughtFocus) */
  thought?: number;
  /** 物产圆章(物产图层;州治上画这一年能用的物产,见 resources.ts) */
  resources: boolean;
  /** 战事:正在打的仗(战线、易手的州、交战处的双剑);要开着"国家"才画(默认打开) */
  wars: boolean;
  /** 瘟疫:正在闹、疫过不久的州铺墨点(plague.ts);要开着"国家"才画(默认打开) */
  plague: boolean;
  /**
   * 地图上写哪些名字(图层面板填色下面「地图上写」那一行),每种填色各记各的;
   * 没有 / 这种填色没勾过 = 按这种填色的默认(namesDefault)
   */
  names?: Partial<Record<CivFill, CivNames>>;
}

/** 填色:哪种颜色铺满底图(图层面板「填色」那一排) */
export type CivFill = 'none' | 'polities' | 'cultures' | 'faiths' | 'eras' | 'control' | 'ideology';
export const CIV_FILLS: readonly CivFill[] = ['none', 'polities', 'cultures', 'faiths', 'eras', 'control', 'ideology'];

/** 地图上写哪些名字(不给 = 按填色的默认) */
export interface CivNames {
  /** 国名 */
  polities?: boolean;
  /** 族名 */
  cultures?: boolean;
  /** 教名(大教和教派;民间信仰不写) */
  faiths?: boolean;
  /** 时代名 */
  eras?: boolean;
}

/** 「地图上写」那一行的几种名字(和跟着它当主角的填色同名:国名 ↔ 国家填色,族名 ↔ 民族填色……) */
export type CivNameKind = keyof CivNames;
export const CIV_NAME_KINDS: readonly CivNameKind[] = ['polities', 'cultures', 'faiths', 'eras'];

/** 开关算哪种填色(先看信仰、时代、管辖、思潮,再看国家、再看民族) */
export function civFillOf(show: { polities: boolean; cultures: boolean; faiths?: boolean; eras?: boolean; control?: boolean; ideology?: boolean }): CivFill {
  if (show.faiths) return 'faiths';
  if (show.eras) return 'eras';
  if (show.control) return 'control';
  if (show.ideology) return 'ideology';
  if (show.polities) return 'polities';
  if (show.cultures) return 'cultures';
  return 'none';
}

/**
 * 这种填色默认写哪些名字:国家、信仰、时代、管辖、思潮填色写国名(信仰、时代、管辖、思潮上是小一号的灰字),民族填色写族名,
 * 信仰填色写教名,时代填色写时代名;不填色时都不写
 */
export function namesDefault(fill: CivFill): Required<CivNames> {
  return {
    polities: fill === 'polities' || fill === 'faiths' || fill === 'eras' || fill === 'control' || fill === 'ideology',
    cultures: fill === 'cultures',
    faiths: fill === 'faiths',
    eras: fill === 'eras',
  };
}

/**
 * 地图上写不写国名:这种填色勾过就照勾的;没勾过按默认 —— 开着国家就写
 * (国家、信仰、时代、管辖、思潮填色都开着国家;只开了信仰、没开国家的旧链接照旧不写)
 */
export function polityNamesOn(show: CivShow): boolean {
  return show.names?.[civFillOf(show)]?.polities ?? show.polities;
}

/** 国名是不是主角(国家填色:大字、带本国颜色);别的填色上写的国名是配角(小一号、灰墨) */
export function polityNamesLead(show: CivShow): boolean {
  return civFillOf(show) === 'polities';
}

/** 地图上写不写族名:这种填色勾过就照勾的;没勾过按默认 —— 民族填色写,别的填色不写 */
export function cultureNamesOn(show: CivShow): boolean {
  const fill = civFillOf(show);
  return show.names?.[fill]?.cultures ?? namesDefault(fill).cultures;
}

/** 族名是不是主角(民族填色:大字、带本族颜色);别的填色上写的族名是配角(小一号、灰墨,照旧斜体) */
export function cultureNamesLead(show: CivShow): boolean {
  return civFillOf(show) === 'cultures';
}

/** 「地图上写」里这种名字勾没勾着:这种填色勾过就照勾的,没勾过按默认(namesDefault;国名见 polityNamesOn) */
export function namesOn(show: CivShow, kind: CivNameKind): boolean {
  if (kind === 'polities') return polityNamesOn(show);
  const fill = civFillOf(show);
  return show.names?.[fill]?.[kind] ?? namesDefault(fill)[kind];
}

/**
 * 这种名字是不是主角:跟着填色的那种名字是主角(国家填色上的国名、民族填色上的族名、信仰填色上的教名、时代填色上的时代名),
 * 大字、带本色;别的都是配角(小一号、灰墨)
 */
export function namesLead(show: CivShow, kind: CivNameKind): boolean {
  return civFillOf(show) === kind;
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
  control: false,
  ideology: false,
  resources: false,
  wars: false,
  plague: false,
};
/** 打开页面时的默认显示:地名、战事、瘟疫(战事、瘟疫要开着"国家"才画) */
export const CIV_SHOW_DEFAULT: CivShow = { ...CIV_SHOW_OFF, labels: true, wars: true, plague: true };
