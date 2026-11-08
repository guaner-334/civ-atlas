/**
 * 官方规则包的影响口:推演插件交数,官方在对应的决策点乘上或加上。口名、单位、上下限给出去就是承诺,只加不改。
 * 插件的影响都落在存下来的数上(城的 devCap、乡村人口、政局和发展度的数表、史事、归属),看世界不需要插件。
 */
import type { InfluencePoint } from './engine/influence';

export const OFFICIAL_INFLUENCES: readonly InfluencePoint[] = [
  /** 城的人口上限倍数(development.ts 每 20 年定一次、建城时记起) */
  { id: 'city.capacity', unit: 'region', op: 'mul', min: 0.25, max: 4 },
  /** 乡村人口的上限(population.ts 每步填的乡容) */
  { id: 'rural.capacity', unit: 'region', op: 'mul', min: 0.25, max: 4 },
  /** 动荡:各州的数按本国的州平均,加进本国的动荡(压到 0 以上之前) */
  { id: 'unrest.add', unit: 'region', op: 'add', min: -0.5, max: 0.5 },
  /** 发展度五种能力(生产、运输、信息、行政、动员)长得多快:自己长、向邻居学都乘它,至多长到门槛、追平邻居 */
  { id: 'dev.rate', unit: 'region', cols: 5, op: 'mul', min: 0, max: 4 },
  /** 同化的速率(本国治下的异族州、部落地带的孤地) */
  { id: 'assim.rate', unit: 'region', op: 'mul', min: 0, max: 4 },
  /** 中央管得到的远近 */
  { id: 'control.reach', unit: 'polity', op: 'mul', min: 0.25, max: 4 },
  /** 看邻国时宣战的赔率(挑好了打谁以后) */
  { id: 'war.odds', unit: 'polity', op: 'mul', min: 0, max: 4 },
  /** 国力:乘在国力加减那一处(打仗、邦交、立约比的国力,政局数表里的国力都跟着变) */
  { id: 'war.power', unit: 'polity', op: 'mul', min: 0.25, max: 4 },
  /** 起兵自立(分裂)的赔率 */
  { id: 'split.odds', unit: 'polity', op: 'mul', min: 0, max: 4 },
  /** 改朝换代的赔率 */
  { id: 'dynasty.odds', unit: 'polity', op: 'mul', min: 0, max: 4 },
  /** 自己起疫的几率(各城掷的那一次) */
  { id: 'plague.odds', unit: 'region', op: 'mul', min: 0, max: 4 },
  /** 自己起的瘟疫里染疫的城死几成(不含全球大疫、作者下的瘟疫;最多死到「天灾很多」的上限) */
  { id: 'plague.loss', unit: 'region', op: 'mul', min: 0.25, max: 4 },
];

/** 按国的口里一国的数:后立的国(超出插件交的格数)按不影响算 */
export const mulOf = (col: Float64Array, p: number): number => (p < col.length ? col[p] : 1);
