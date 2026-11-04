/**
 * 界面、画风、AI 用的查询都从这里取:某年的归属、信仰、人口、城市等级、国都、国号、君主、开发度这些。
 * 它们在界面上是同步调的,没法每次 await 版本,所以开世界时先取好那个世界要的一版(setQueryReader),这里跟着换;没开世界、新建的世界就是当前版本。
 *
 * 这几个名字是 ES 模块的活绑定:import 它们的地方拿到的总是换好以后的那个函数,调用时不多一层转手,放大、拖时间轴这些高频路径不受影响。
 * 同一页同一时间只开一个世界,所以只存一份;gen/ 里的代码不从这里取(那些代码就在读取代码里面,老版本的存底自带一份)。
 *
 * 老世界(记着老版本的)不会混进这一版新推的历史:改历史要先另存成新版(ui/world/useWorldPages.ts 的 setHistoryGate),另存的是新世界,用当前版本。
 */
import { currentQuery, type QueryReader } from './queryReader';

export let ownersAt: QueryReader['ownersAt'] = currentQuery.ownersAt;
export let capitalAt: QueryReader['capitalAt'] = currentQuery.capitalAt;
export let polityAlive: QueryReader['polityAlive'] = currentQuery.polityAlive;
export let polityName: QueryReader['polityName'] = currentQuery.polityName;
export let polityTierAt: QueryReader['polityTierAt'] = currentQuery.polityTierAt;
export let populationAt: QueryReader['populationAt'] = currentQuery.populationAt;
export let portAt: QueryReader['portAt'] = currentQuery.portAt;
export let regionPopulationAt: QueryReader['regionPopulationAt'] = currentQuery.regionPopulationAt;
export let ruinRank: QueryReader['ruinRank'] = currentQuery.ruinRank;
export let ruinSites: QueryReader['ruinSites'] = currentQuery.ruinSites;
export let settlementRank: QueryReader['settlementRank'] = currentQuery.settlementRank;
export let faithAt: QueryReader['faithAt'] = currentQuery.faithAt;
export let developmentAt: QueryReader['developmentAt'] = currentQuery.developmentAt;
export let resourcesAt: QueryReader['resourcesAt'] = currentQuery.resourcesAt;
export let controlAt: QueryReader['controlAt'] = currentQuery.controlAt;
export let ideologyAt: QueryReader['ideologyAt'] = currentQuery.ideologyAt;
export let rulerAt: QueryReader['rulerAt'] = currentQuery.rulerAt;

/** 换成这一版的查询(开世界时;换了别的世界再换回来) */
export function setQueryReader(q: QueryReader): void {
  ownersAt = q.ownersAt;
  capitalAt = q.capitalAt;
  polityAlive = q.polityAlive;
  polityName = q.polityName;
  polityTierAt = q.polityTierAt;
  populationAt = q.populationAt;
  portAt = q.portAt;
  regionPopulationAt = q.regionPopulationAt;
  ruinRank = q.ruinRank;
  ruinSites = q.ruinSites;
  settlementRank = q.settlementRank;
  faithAt = q.faithAt;
  developmentAt = q.developmentAt;
  resourcesAt = q.resourcesAt;
  controlAt = q.controlAt;
  ideologyAt = q.ideologyAt;
  rulerAt = q.rulerAt;
}
