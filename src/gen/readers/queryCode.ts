/**
 * 查询读取代码对外的样子:一个版本的查询读取器就是这份清单。
 * 只转出,不写算法。老版本的存底里也有一份这个文件(见 index.ts),转出的是存底里的旧代码。
 */
export { ownersAt } from '../civ/engine/timeline';
export { capitalAt, polityAlive, polityName, polityTierAt, populationAt, portAt, regionPopulationAt, ruinRank, ruinSites, settlementRank } from '../civ/growth';
export { faithAt } from '../civ/religion';
export { developmentAt, resourcesAt } from '../civ/development';
export { controlAt } from '../civ/control';
export { ideologyAt } from '../civ/ideology';
export { rulerAt } from '../civ/story/peopleInfo';
