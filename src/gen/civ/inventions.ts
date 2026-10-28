/**
 * 发展度的尺子里只有数据的那几样:五种能力的名字、发明表。
 * 只放数据,不依赖推演模块:做法表(practices.ts)、政局的数表(stateTables.ts)在模块加载时就要读它,
 * 放在 development.ts 里会绕回推演那一圈模块(先后加载时读到还没定义的值)。development.ts 照旧导出这两样。
 */

/** 五种能力(下标就是快照里每州的第几样,同 development.ts 的 Cap) */
export const CAPS = ['生产', '运输', '信息', '行政', '动员'] as const;

/**
 * 发明:哪样能力(Cap)到了哪一档(和时代同一把尺子),世上第一次到的那一州记一条 invent。
 * major = 编年史里算大事(见 developmentText.ts)。和时代同名的(青铜、铁器、火药……)不另列
 */
export const INVENTIONS: readonly { name: string; cap: number; level: number; major?: boolean }[] = [
  { name: '陶轮', cap: 0, level: 0.5 },
  { name: '车轮', cap: 1, level: 0.6 },
  { name: '文字', cap: 2, level: 0.7, major: true },
  { name: '战车', cap: 4, level: 0.9 },
  { name: '成文法', cap: 3, level: 1 },
  { name: '帆船', cap: 1, level: 1.2 },
  { name: '犁耕', cap: 0, level: 1.5 },
  { name: '字母', cap: 2, level: 1.6 },
  { name: '户籍', cap: 3, level: 1.8 },
  { name: '驿道', cap: 1, level: 2 },
  { name: '马镫', cap: 4, level: 2.2, major: true },
  { name: '造纸', cap: 2, level: 2.5, major: true },
  { name: '水车', cap: 0, level: 2.6 },
  { name: '文官考选', cap: 3, level: 2.8 },
  { name: '指南针', cap: 1, level: 3, major: true },
  { name: '常备军', cap: 4, level: 3 },
  { name: '高炉', cap: 0, level: 3.4 },
  { name: '印刷术', cap: 2, level: 3.4, major: true },
  { name: '远洋帆船', cap: 1, level: 3.7 },
  { name: '火器', cap: 4, level: 4.1 },
  { name: '人口普查', cap: 3, level: 4.5 },
  { name: '报刊', cap: 2, level: 4.6 },
  { name: '机械织机', cap: 0, level: 4.6 },
  { name: '征兵制', cap: 4, level: 5 },
  { name: '蒸汽机', cap: 0, level: 5.2, major: true },
  { name: '铁路', cap: 1, level: 5.4 },
  { name: '电报', cap: 2, level: 5.6, major: true },
  { name: '电力', cap: 0, level: 6.2 },
  { name: '汽车', cap: 1, level: 6.3 },
  { name: '无线电', cap: 2, level: 6.5 },
  { name: '飞机', cap: 1, level: 6.9 },
  { name: '计算机', cap: 2, level: 7.3, major: true },
];
