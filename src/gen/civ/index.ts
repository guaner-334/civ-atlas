/**
 * 文明生成总流程:generateWorld() 之后在 worker 里调用。纯计算,不碰 DOM。
 *
 * 步骤顺序固定:
 *   ① 宜居度 + 州          habitat.ts / regions.ts(只跟地形、文明种子有关;调用方可以经 params.base 传预先算好的,见 civBase)
 *   ② 民族扩张 + 回放引擎   sim.ts / cultures.ts   → cultures、log、checkpoints、culture
 *   ③ 城市成长 + 国家       polities.ts            → settlements、polities、polity
 *   ④ 道路网               routes.ts              → routes(推演里走过的航线一定画出来,见 usedLanes)
 *   ⑤ 地理名称             places.ts              → places(地图上画的关隘也在里面:passSites.ts 按地形、大路、守关战挑,起名排在最后)
 *   ⑥ 人物                 people.ts              → people(历代君主、战争里的统帅;按推出来的历史排,不改历史)
 *   ⑦ 信仰                 religion.ts            → religion(民间信仰、大教、国教、教派;照推出来的历史贴上去,不改历史)
 *   发展度(物产、五种能力、时代)在推演里每 20 年算一步,反过来影响人口上限、军力、远洋(development.ts → development)
 *
 * 阶段 4 干预(params.interventions,interventions.ts):带着干预从第 0 年整段重推;干预年份之前和不干预时逐字节一致。
 * 阶段 4 改地形(world.terrain):扩张节拍、城的人口折算按没改地形时的同一颗星球定(planetTempo),只有改动附近的历史跟着地形变。
 * 改过地形(地形修改或草图)的世界,山海湖岛的地名同一处地方沿用没改过时的(nameRefOf):重推以后远处民族的语感变了,地名也不跟着换。
 *
 * 随机数一律从 subSeed(seed, 'civ-…') 取(见 rand.ts),不用 Math.random。seed 是文明种子(params.civSeed):
 * 没给 = 地图种子(world.params.seed),和加这一项以前逐字节一样;给了 = 同一张地图上另一段历史(州、民族、国家、名字……都另起)。
 */
import { generateWorld, type Progress, type World, type WorldParams } from '../world';
import type { Sketch } from '../sketch';
import type { Annal, ChangeLog, Civ, CivBase, CivParams, Culture, Habitat, PlanetTempo, Place, Polity, Route, Settlement } from './types';
import { computeHabitat } from './habitat';
import { buildRegions, emptyRegions, reshapeRegions } from './regions';
import { CivSim, quantize } from './sim';
import { BIRTH_SPAN, cultureKey, cultureModelOf, finishCultures, installCultures, planCultures } from './cultures';
import { buildRoutes, usedLanes } from './routes';
import { capacityNorm, finishPolities, installPolities, planPolities, polityModelOf, routeCities, ruinGaps } from './polities';
import { findPlaces, keepPlaceNames, nameRefs, type NameRef } from './places';
import { passSites } from './passSites';
import { installWars } from './wars';
import { installPolitics } from './politics';
import { installDynasty } from './dynasty';
import { installAssimilation } from './assimilation';
import { installCities } from './cities';
import { installDiplomacy } from './diplomacy';
import { warModelOf } from './wars';
import { installInterventions, scheduleInterventions } from './interventions';
import { buildPeople } from './people';
import { installUpheaval, reshapeCities, scheduleUpheaval, upheavalImpact, type TerrainEra } from './upheaval';
import type { CultureModel } from './cultures';
import type { PolityModel } from './polities';
import type { InterventionModel } from './interventions';
import type { CivEra, NamePins, Regions, UpheavalFact } from './types';
import { cleanInterventions, sameInterventions, type Intervention, type TerrainOp } from '../edits';
import { buildReligion } from './religion';
import { finishDevelopment, installDevelopment } from './development';
import { installUnrest } from './unrest';
import { installControl } from './control';
import { installCouncil } from './council';
import { installRegency } from './regency';
import { installMarriage } from './marriage';
import { installPlague } from './plague';
import { installPandemic } from './pandemic';
import { breakRoads } from './pandemicInfo';
import { cleanCalamity } from './calamity';
import { installTreaties } from './treaties';
import { installMigration, migrationsOf } from './migration';
import { cleanMix, type NameMix } from '../names';
import { cleanFrontier, cleanOrigins, type Frontier, type Origins } from './frontier';

export * from './types';

export const DEFAULT_CIV_PARAMS: CivParams = {
  endYear: 3000,
  cultures: 'auto',
  polities: 'auto',
  regionArea: 750,
  pace: 1,
};

/** 可居地块(宜居分 ≥ 这个值)的总面积占陆地不到这个比例时,认为这颗星球没有文明 */
const MIN_HABITABLE_SUIT = 1;
const MIN_HABITABLE_FRAC = 0.02;

/** 陆地有几块、能不能有文明(可居的地方够不够) */
function viability(world: World, habitat: Habitat): { land: number; viable: boolean } {
  let land = 0;
  let habitable = 0;
  for (let i = 0; i < world.mesh.n; i++) {
    if (world.water[i] !== 0) continue;
    land++;
    if (habitat.suitability[i] >= MIN_HABITABLE_SUIT) habitable++;
  }
  return { land, viable: land > 0 && habitable >= land * MIN_HABITABLE_FRAC };
}

/**
 * 一颗星球的扩张节拍(民族走一个"标准路程"要几年,不含 pace;cultures.ts 的 calibrate)和城的人口折算(polities.ts 的 capacityNorm),
 * 按**没改地形**的这组世界参数生成、标定。
 * 两个数都是整个世界一起定的(节拍:到第 3000 年约九成可居州有人住;折算:可居州人口上限的第 90 百分位):
 * 改过地形的世界要是按改后的地形重算,远海放一座小岛也会把全世界的扩张拨快或拨慢、城都大一点或小一点,各处的历史全跟着错开。
 * 所以改过地形的世界沿用原来星球的这两个数,只有改动附近(和受它牵连)的历史跟着地形变。
 * 要多生成一遍没改过的地形;worker 按参数缓存,经 CivParams.tempo 传给 generateCiv。
 * 草图(新建世界时画的大陆和海)算星球的一部分:画过草图的世界,"没改地形的星球"是照草图长出来的那一颗(sketch 传进来)。
 * 没改过的星球长不出文明 = undefined(改过的世界按它自己标定)
 */
export function planetTempo(params: WorldParams, civ: Partial<CivParams> = {}, sketch?: Sketch | null): PlanetTempo | undefined {
  const p: CivParams = { ...DEFAULT_CIV_PARAMS, ...civ };
  const world = generateWorld(params, undefined, undefined, sketch);
  const habitat = computeHabitat(world);
  if (!viability(world, habitat).viable) return undefined;
  const seed = params.seed;
  const regions = buildRegions(world, habitat, { regionArea: p.regionArea, seed });
  const model = planCultures(world, habitat, regions, { seed, cultures: p.cultures, pace: 1, birthSpan: p.birthSpan ?? BIRTH_SPAN });
  return model ? { spread: model.spreadYears, capNorm: capacityNorm(model.terrain) } : undefined;
}

/**
 * 推文明的底子:宜居度和州(generateCiv 的头两步,和它算的一模一样)。只跟地形、文明种子、每州面积有关:
 * 调用方(worker)按"这个世界 + 文明种子"留着一份,改了干预、拓荒、起源、地名风格、推演年数重推时经 CivParams.base 传回 generateCiv
 */
export function civBase(world: World, params: Partial<CivParams> = {}): CivBase {
  const p: CivParams = { ...DEFAULT_CIV_PARAMS, ...params };
  const seed = p.civSeed ?? world.params.seed;
  const habitat = computeHabitat(world);
  const { land } = viability(world, habitat);
  const regions = land > 0 ? buildRegions(world, habitat, { regionArea: p.regionArea, seed }) : emptyRegions(world.mesh.n);
  return { world, seed, regionArea: p.regionArea, habitat, regions };
}

/** 复制一份(类型化数组、普通数组各复制一份,别的照搬):预先算好的底子不跟着推演改、不随 Civ 交出去 */
function copyArrays<T extends object>(o: T): T {
  const out = { ...o } as unknown as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (ArrayBuffer.isView(v)) out[k] = (v as Uint8Array).slice();
    else if (Array.isArray(v)) out[k] = v.slice();
  }
  return out as T;
}

/** 改过地形:带地形修改或草图(草图只改了板块的也算) */
const edited = (world: World) => !!world.terrain?.length || !!world.sketch;

/** 文明这边定"谁住在哪、按什么语感起名"的几项设定(地名照着沿用的那一份按它们算,见 nameRefOf) */
interface RefSetup {
  p: CivParams;
  mix?: NameMix;
  frontier?: Frontier;
  origins?: Origins;
}

/**
 * 地名照着沿用的那一份按什么认:世界参数 + 文明种子、地名风格、每州面积、民族数、扩张快慢、诞生跨度、拓荒、起源。
 * 推演年数、干预、地形大事、国家数不算:地名只看计划中的疆域和各民族的语感(和推到哪一年无关),干预立国来的民族不在计划中的疆域里
 */
function refKeyOf(params: WorldParams, s: RefSetup): string {
  const { p } = s;
  const entries = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([entries, p.civSeed ?? null, s.mix ?? null, p.regionArea, p.cultures, p.pace, p.birthSpan ?? null, s.frontier ?? null, s.origins ?? null]);
}

/** 记着的几份(按 refKeyOf;最近用过的在后面) */
const refMemo = new Map<string, readonly NameRef[]>();
const REF_KEEP = 4;
function rememberRef(key: string, ref: readonly NameRef[]): void {
  refMemo.delete(key);
  refMemo.set(key, ref);
  if (refMemo.size > REF_KEEP) refMemo.delete(refMemo.keys().next().value!);
}

/**
 * 改过地形的世界里,山海湖岛的地名照着沿用的那一份(places.ts 的 PlaceNaming.ref):没改过地形(不带地形修改、不带草图)的
 * 同一颗星球、同样的文明设定起出来的地名。改地形以后历史重推,远处民族的分布和语感会变,按当地民族起的地名也会跟着换 ——
 * 照着它起,没改到的地方名字不变。没改过地形的世界、CivParams.placeRef = false(照原样打开的旧版本世界)= undefined(照常起名)。
 * 要多生成一遍没改过的星球、推到第 0 年(地名和推到哪一年无关,tests/names-stable.test.ts 钉住);
 * 按设定记着最近几份,没改过地形的世界推完时顺手记下(新建世界以后头一次改地形就不用再生成)
 */
function nameRefOf(world: World, s: RefSetup): readonly NameRef[] | undefined {
  if (!edited(world) || s.p.placeRef === false) return undefined;
  const key = refKeyOf(world.params, s);
  let ref = refMemo.get(key);
  if (!ref) {
    const { p, mix, frontier, origins } = s;
    const w0 = generateWorld(world.params);
    const c0 = generateCiv(w0, {
      endYear: 0,
      regionArea: p.regionArea,
      cultures: p.cultures,
      pace: p.pace,
      ...(p.birthSpan !== undefined ? { birthSpan: p.birthSpan } : {}),
      ...(p.civSeed !== undefined ? { civSeed: p.civSeed } : {}),
      ...(mix ? { names: mix } : {}),
      ...(frontier ? { frontier } : {}),
      ...(origins ? { origins } : {}),
    });
    ref = nameRefs(w0, c0.places, c0.cultures, c0.regions);
  }
  rememberRef(key, ref);
  return ref;
}

export function generateCiv(world: World, params: Partial<CivParams> = {}, progress: Progress = () => {}): Civ {
  const p: CivParams = { ...DEFAULT_CIV_PARAMS, ...params };
  const n = world.mesh.n;
  /** 整个世界的地名风格(清理过;自动 = undefined) */
  const mix = cleanMix(p.names);
  /** 拓荒设定、自选的起源(清理过;默认 = undefined) */
  const frontier = cleanFrontier(p.frontier);
  const origins = cleanOrigins(p.origins);
  /** 文明种子:没给 = 地图种子 */
  const seed = p.civSeed ?? world.params.seed;
  /** 预先算好的宜居度和州:同一个世界、同一个文明种子、同样的每州面积才用 */
  const pre = p.base && p.base.world === world && p.base.seed === seed && p.base.regionArea === p.regionArea ? p.base : undefined;

  progress('宜居度', 0);
  const habitat = pre ? copyArrays(pre.habitat) : computeHabitat(world);
  const { land, viable } = viability(world, habitat);

  progress('划分州', 0.3);
  const regions = land > 0 ? (pre ? copyArrays(pre.regions) : buildRegions(world, habitat, { regionArea: p.regionArea, seed })) : emptyRegions(n);

  progress('文明', 0.8);
  const R = regions.count;
  // ---- 以下各步:viable 为 false 时一律保持为空 ----
  // ② 民族扩张 + 回放引擎(cultures.ts / sim.ts):定民族 → 按年推演到 endYear → 按最终疆域配色、起名。
  // ③ 城市成长 + 国家(polities.ts):在 sim.run 之前装上自己的事件(建城、立国、国家到达、升格),
  //    同一个引擎、同一本日志
  const sim = new CivSim(R);
  // 「天灾」(calamity.ts):平常 = undefined,和没有这一项逐字节一样
  sim.calamity = cleanCalamity(p.calamity);
  const birthSpan = p.birthSpan ?? BIRTH_SPAN;
  // 改过地形:扩张节拍、城的人口折算沿用没改地形时的同一颗星球(planetTempo);没改 = 按这个世界自己标定。
  // 给了文明种子的(一张地图上新开的历史)一律按这张地图本身标定:地图是定下来的那一张,不另按现在的生成器长一颗没改地形的星球
  const tempo = viable && world.terrain?.length && p.civSeed === undefined ? (p.tempo === undefined ? planetTempo(world.params, p, world.sketch) : (p.tempo ?? undefined)) : undefined;
  const model = viable
    ? planCultures(world, habitat, regions, { seed, cultures: p.cultures, pace: p.pace, birthSpan, tempo: tempo?.spread, frontier, origins, interventions: p.interventions })
    : null;
  const pm = model ? planPolities(world, model, { polities: p.polities, pace: p.pace, capNorm: tempo?.capNorm, expand: frontier?.expand }) : null;
  // 阶段 4 干预(interventions.ts):事件最先预约(同一刻里只排在地形大事和看王朝、新君即位、迁都后重看边地后面,干预之前的历史一字不差)
  const iv = pm ? scheduleInterventions(sim, seed, p.interventions) : null;
  if (model) installCultures(sim, model);
  if (pm) installPolities(sim, pm);
  if (pm) installWars(sim, pm, world); // 阶段 3 战争与攻占(wars.ts):宣战、攻占、迁都、灭亡、议和
  if (pm) installPolitics(sim, pm, world); // 阶段 3 分与合(politics.ts):分裂、合并、复国、主动迁都、部落地带补立国
  if (pm) installDynasty(sim, pm); // 阶段 3 王朝更替(dynasty.ts):改朝换代、王室更迭,新朝定都根据地
  if (pm) installAssimilation(sim, pm, world); // 阶段 3 同化与迁徙(assimilation.ts):同化、随征服而来的移民、避兵外迁、民族消亡
  if (pm) installCities(sim, pm, warModelOf(sim)!); // 阶段 3 城市兴衰(cities.ts):洗劫、毁城、重建、旧都衰落
  if (pm) installDiplomacy(sim, pm); // 邦交(diplomacy.ts):称臣纳贡、结盟、背盟、援盟、讨伐叛藩
  if (pm) installDevelopment(sim, world, pm, habitat, seed); // 发展度(development.ts):每 20 年算各州的能力,影响人口上限、军力、远洋
  if (pm) installUnrest(sim, pm, seed); // 动荡(unrest.ts):饥荒、民变、大崩解
  if (pm) installControl(sim, seed); // 中央管到什么程度(control.ts):割据、抗命不出兵
  if (pm) installCouncil(sim, seed); // 议事(council.ts):直征、分封、削藩
  if (pm) installRegency(sim, pm); // 掌实权(regency.ts):引兵入朝、太子监国、宗室摄政、名臣辅政、大臣大将专权
  if (pm) installMarriage(sim, pm); // 联姻(marriage.ts):两国宗室结亲,少开战、易结盟
  if (pm) installPlague(sim, pm, seed); // 瘟疫(plague.ts)
  if (pm) installPandemic(sim, pm, seed); // 全球大疫、疫后凋敝;「天灾」多 / 很多时自己发生的全球大疫、地震水旱(pandemic.ts)
  if (pm) installTreaties(sim, pm, world); // 立约与中立地(treaties.ts):互不侵犯 / 有限竞争之约、背约、续约,共建中立地、放逐
  if (pm) installMigration(sim, pm, world); // 大迁徙(migration.ts):草原、寒地的民族分出一支举族远走,到了立国、开战,打进国都
  if (iv) installInterventions(sim, iv); // 阶段 4 干预:不许灭、结盟、宣战、禁止分裂(各机制在决策点查 WarModel.iv)
  progress('民族推演', 0.85);
  // 地形大事:推到第一件的前一刻,之后每件套上新地形接着推(upheaval.ts)
  const ups = pm ? (p.upheavals ?? []).filter((u) => u.year > 0 && u.year < p.endYear) : [];
  sim.run(ups.length ? ups[0].year - 1 / 256 : p.endYear);
  let fin = { sim, model, pm, world, habitat, regions };
  const pins: NamePins | undefined = ups.length ? { regionNames: [], polities: new Map(), settlements: new Map() } : undefined;
  const eras: CivEra[] = [];
  const facts: UpheavalFact[] = [];
  // 各段的州地形(城的人口上限和它最后一次记下的那一段比,reshapeCities)
  const terrains: TerrainEra[] = pm ? [{ from: -Infinity, terrain: pm.terrain }] : [];
  for (let k = 0; k < ups.length; k++) {
    const u = ups[k];
    const before = fin.regions;
    const eraWorld = fin.world;
    const eraHabitat = fin.habitat;
    // 名字、配色、这一段的地名和道路:照"没有这件大事、照原样推到底"的那份历史(大事之前和它一模一样,见 NamePins)
    const same = partialCiv(fin.sim, fin.model!, fin.pm!, eraHabitat, before, seed, iv, frontier);
    same.upheavals = facts.slice(); // 早先几件大事的经过:分支里也认得出沉过海的城址(见下面 half.upheavals)
    // 接着推和一口气推完一样(CivSim.fromCiv):这一支和"没有这件大事、照原样推到底"一模一样
    const branch = CivSim.fromCiv(eraWorld, same, same.interventions ?? []);
    branch.run(p.endYear);
    // 起名只读这一段的分支,不影响之后的推演
    const b = pinNames(pins!, eraWorld, branch, k ? ups[k - 1].year : -Infinity, u.year, k === 0, mix, iv?.list);
    // 第一段:改过地形的世界照没改过时的地名(nameRefOf);之后各段沿用前一段的
    const eraRef = k ? undefined : nameRefOf(eraWorld, { p, mix, frontier, origins });
    const br = branch.result();
    const eraLanes = usedLanes(before, br.log, b.cultures, k ? ups[k - 1].year : -Infinity);
    const eraRoutes = buildRoutes(eraWorld, eraHabitat, before, {
      cities: b.settlements.length ? routeCities(b.settlements, b.polities, p.endYear) : undefined,
      lanes: eraLanes,
      ruins: ruinGaps(b.settlements),
    });
    // 关隘也照这一支(和没有这件大事时一样;passSites.ts)
    const eraPasses = passSites(eraWorld, before, eraRoutes, { regions: before, checkpoints: br.checkpoints, log: br.log, annals: br.annals });
    const eraAvoid = b.settlements.map((s) => ({ name: s.name, from: s.founded }));
    const eraPlaces = findPlaces(eraWorld, before, { cultures: b.cultures, culture: b.planned, names: mix, seed, passes: eraPasses, avoid: eraAvoid, ...(eraRef ? { ref: eraRef } : {}) });
    if (k) keepPlaceNames(eraWorld, eras[k - 1].places, eraPlaces);
    eras.push({ until: u.year, habitat: eraHabitat, regions: before, places: eraPlaces, routes: eraRoutes });
    // 新地形:州沿用编号,只改变了的地方;比出这件大事改了什么
    const h1 = computeHabitat(u.world);
    const r1 = reshapeRegions(u.world, h1, before, { regionArea: p.regionArea, seed });
    const impact = upheavalImpact(fin.world, before, u.world, r1, u.ops);
    const { joined, ...rest } = impact;
    const fact: UpheavalFact = { year: u.year, kinds: kindsOf(u.ops), items: u.items.slice(), ...rest, polity: -1, drownedBy: [], ...(joined ? { joined } : {}) };
    facts.push(fact);
    const half = partialCiv(fin.sim, fin.model!, fin.pm!, h1, r1, seed, iv, frontier);
    // 还在的城:港口、人口上限照新地形换值(从大事那一刻起;接着推时立国的年份按新的上限算)
    half.settlements = reshapeCities(half.settlements, terrains, u.world, h1, r1, u.year, u.ops);
    // 早先几件大事的经过(接着推时认得出哪些城址沉过海,cities.ts 的 resumeCities)
    half.upheavals = facts.slice(0, k);
    // 从前一刻接着推:大事那一刻的事件照常补上(同一年下的干预、民族诞生……),排在大事后面;
    // 按新地形重算出来的、本该更早发生的事(新海路上的到达……)一律从大事那一刻起(CivSim.floor)
    const s1 = CivSim.fromCiv(
      u.world,
      half,
      half.interventions ?? [],
      (s) => {
        s.floor = u.year;
        scheduleUpheaval(s, k, u.year);
      },
    );
    installUpheaval(s1, k, u, impact, fact, fin.world);
    s1.run(k + 1 < ups.length ? ups[k + 1].year - 1 / 256 : p.endYear);
    const m1 = cultureModelOf(s1)!;
    const pm1 = polityModelOf(s1)!;
    pm1.cultures = m1.cultures; // 接着推时两层各复制了一份民族表:起城名、国名要用起好名的那份
    fin = { sim: s1, model: m1, pm: pm1, world: u.world, habitat: h1, regions: r1 };
    terrains.push({ from: u.year, terrain: pm1.terrain });
  }
  return finishCiv({ fin, p, seed, viable, mix, frontier, origins, interventions: iv?.list, model, pm, pins, eras, facts, progress });
}

/**
 * 接着往后推:从一份推到 civ.endYear 的历史(可以是存档读回来的)接着推到 params.endYear,和一次推到 params.endYear 的结果完全一样
 * (归属、日志、史事、检查点,名字、配色、人物、道路、信仰……)。params 要和推出 civ 时的一样(endYear 除外)。
 * 推演完以后的整理(起名、配色、人物、道路、信仰)只看每样东西出现以前的历史,所以已经发生的不随后来推多远而变。
 * 有地形大事的世界、要推的年份不比 civ 晚的,照常从第 0 年整段重推(结果一样,只是不省时间)。
 * params.interventions(不给 = civ 推出来时带着的):可以是 civ 的干预后面接上几条比 civ.endYear 晚才生效的(逐年推演时下的新命令,play.ts),
 * 接着推的结果和带着它们一口气推完一样;不是这样接上的(改了、删了早先的干预)照常整段重推。
 * 返回的是生成出来的名字:用户改过的名字(gen/edits.ts 的 applyNames)不在 Civ 里随推演走,照常在结果上再套一遍。
 * 传进来的 civ 不改(worker 留着它,下次再推还从它接着推)
 */
export function continueCiv(world: World, civ: Civ, params: Partial<CivParams> = {}, progress: Progress = () => {}): Civ {
  const run = startContinue(world, civ, params, progress);
  return run ? run.finish() : generateCiv(world, params, progress);
}

/** 分段接着推(startContinue):推到哪一刻了、再推一段、推完整理 */
export interface Continuation {
  /** 从哪一刻接着推(传进来的 civ.endYear) */
  readonly from: number;
  /** 推到哪一刻为止(params.endYear) */
  readonly to: number;
  /** 已经推到哪一刻 */
  readonly year: number;
  /** 再推到 untilYear(超过 to 的按 to);分几段推和一口气推结果逐字节一样(推演只按事件的时刻走,不看在哪儿停过) */
  advance(untilYear: number): void;
  /** 推到 to(还没推到的接着推完),整理成 Civ(起名、配色、人物、道路、信仰);只调一次 */
  finish(): Civ;
  /**
   * 推到 to,不整理:只够查史事、归属和再接着推的一份历史(还没起名;地名、道路、人物、信仰是空的)。
   * 从它接着推(continueCiv / startContinue)和从整理过的同一刻接着推结果一样。和 finish 二选一,只调一次
   */
  partial(): Civ;
}

/**
 * continueCiv 拆成几段推(worker 再推 N 年时用:每段之间报进度、看有没有新的请求要停下)。参数和规矩同 continueCiv;
 * 接不上(有地形大事、要推的年份不比 civ 晚、改了早先的干预、civ 停在第 0 年以前:第 0 年那一刻的事还没发生,没有能接着用的……)
 * = null,照常从第 0 年整段重推(generateCiv)。
 * 推演那一步拆开推,推完以后的整理照旧一次做完;不改传进来的 civ
 */
export function startContinue(world: World, civ: Civ, params: Partial<CivParams> = {}, progress: Progress = () => {}): Continuation | null {
  const p: CivParams = { ...DEFAULT_CIV_PARAMS, ...params };
  const had = civ.interventions ?? [];
  const list = params.interventions === undefined ? had : cleanInterventions(params.interventions);
  if (!civ.viable || !civ.cultures.length || !(civ.endYear >= 0) || civ.upheavals?.length || p.upheavals?.length || !(p.endYear > civ.endYear) || !extends_(had, list, civ.endYear))
    return null;
  const seed = p.civSeed ?? world.params.seed;
  progress('民族推演', 0.85);
  // 起名会写州名(regions.name):换一份州,不改传进来的 civ
  const sim = CivSim.fromCiv(world, { ...civ, regions: { ...civ.regions } }, list);
  const to = p.endYear;
  let done = false;
  return {
    from: civ.endYear,
    to,
    get year() {
      return sim.now;
    },
    advance(untilYear: number) {
      if (done) throw new Error('startContinue:已经整理完了');
      if (untilYear > sim.now) sim.run(Math.min(to, untilYear));
    },
    finish() {
      if (done) throw new Error('startContinue:已经整理完了');
      if (to > sim.now) sim.run(to);
      done = true;
      const model = cultureModelOf(sim)!;
      const pm = polityModelOf(sim)!;
      pm.cultures = model.cultures; // 接着推时两层各复制了一份民族表:起城名、国名要用起好名的那份
      const fin = { sim, model, pm, world, habitat: civ.habitat, regions: model.terrain.regions };
      return finishCiv({ fin, p, seed, viable: true, mix: civ.names, frontier: civ.frontier, origins: cleanOrigins(p.origins), interventions: list.length ? list : undefined, model, pm, eras: [], facts: [], progress });
    },
    partial() {
      if (done) throw new Error('startContinue:已经整理完了');
      if (to > sim.now) sim.run(to);
      done = true;
      const model = cultureModelOf(sim)!;
      const pm = polityModelOf(sim)!;
      pm.cultures = model.cultures;
      const out = partialCiv(sim, model, pm, civ.habitat, model.terrain.regions, seed, null, civ.frontier);
      if (list.length) out.interventions = list.slice();
      if (civ.names) out.names = civ.names;
      return out;
    },
  };
}

/** 干预列表 next 是 had 后面接上几条、接上的都在 endYear 以后才生效(接着推得出和从第 0 年重推一样的结果) */
function extends_(had: readonly Intervention[], next: readonly Intervention[], endYear: number): boolean {
  if (next.length < had.length || !sameInterventions(had, next.slice(0, had.length))) return false;
  return next.slice(had.length).every((v) => quantize(v.from) > endYear);
}

/** 推完以后整理成 Civ 要的东西(generateCiv、continueCiv 共用) */
interface Finish {
  /** 推到最后的那一段:引擎、两层模型、这一段的地形 */
  fin: { sim: CivSim; model: CultureModel | null; pm: PolityModel | null; world: World; habitat: Habitat; regions: Regions };
  p: CivParams;
  seed: number;
  viable: boolean;
  mix?: NameMix;
  frontier?: Frontier;
  /** 自选的起源(清理过;地名照着沿用的那一份按它算,见 nameRefOf) */
  origins?: Origins;
  interventions?: readonly Intervention[];
  /** 第一段的两层模型(标定的扩张节拍、人口折算、国家的节拍按它记) */
  model: CultureModel | null;
  pm: PolityModel | null;
  pins?: NamePins;
  eras: CivEra[];
  facts: UpheavalFact[];
  progress: Progress;
}

function finishCiv(x: Finish): Civ {
  const { fin, p, seed, viable, mix, frontier, model, pm, pins, eras, facts, progress } = x;
  const { log, checkpoints, culture, polity, annals } = fin.sim.result();
  progress('起名', 0.92);
  // 计划中的疆域:山河湖海的地名按它的语感起(推得再远地名也不变,见 cultures.ts 的 plannedOwners)
  const planned = fin.model ? finishCultures(fin.world, fin.model, log, pins, mix) : undefined;
  if (fin.pm) finishPolities(fin.world, fin.pm, log, pins, authoredNames(annals, x.interventions));
  const cultures: Culture[] = fin.model?.cultures ?? [];
  const settlements: Settlement[] = fin.pm?.settlements ?? []; // ③ polities.ts
  const polities: Polity[] = fin.pm?.polities ?? []; // ③ polities.ts
  // ④ routes.ts:城镇列表交给道路(国都之间修大路,路的修建年份取两端较晚者);推演里走过的航线一定画(usedLanes)
  // 全球大疫的凋敝里失修断掉、后来修回的路(pandemicInfo.ts 的 breakRoads;没有全球大疫 = 原样)
  const routes: Route[] = viable
    ? breakRoads(
        { seed, annals, settlements, regions: fin.regions },
        buildRoutes(fin.world, fin.habitat, fin.regions, {
          progress,
          cities: settlements.length ? routeCities(settlements, polities, p.endYear) : undefined,
          lanes: usedLanes(fin.regions, log, cultures, facts.length ? facts[facts.length - 1].year : -Infinity),
          ruins: ruinGaps(settlements),
        }),
      )
    : [];
  // ⑤ places.ts(山海湖岛是地理,不看 viable):改过地形的世界同一处地方照没改过时的地名(nameRefOf)
  const setup: RefSetup = { p, mix, frontier, origins: x.origins };
  const ref = eras.length ? undefined : nameRefOf(fin.world, setup);
  // 关隘(passSites.ts):大路翻过去的名关、推演里据险断后守过的口子;只读地形、道路、史事,不改历史。
  // 起名排在山海湖岛之后、只挑没用过的名字,也不和关画上地图以前就有的城重名:别的地名一个不变
  const passes = viable ? passSites(fin.world, fin.regions, routes, { regions: fin.regions, checkpoints, log, annals }) : [];
  const avoid = settlements.map((s) => ({ name: s.name, from: s.founded }));
  const places: Place[] = findPlaces(fin.world, fin.regions, { cultures, culture: planned, names: mix, seed, passes, avoid, ...(ref ? { ref } : {}) });
  // 地形大事以后:同一处地方沿用大事以前的地名
  if (eras.length) keepPlaceNames(fin.world, eras[eras.length - 1].places, places);
  // 没改过地形、没有干预和地形大事的:这就是改地形以后要照着沿用的那一份,记下(nameRefOf)
  if (!edited(fin.world) && !x.interventions?.length && !eras.length) rememberRef(refKeyOf(fin.world.params, setup), nameRefs(fin.world, places, cultures, fin.regions));
  const people = buildPeople({
    seed,
    endYear: p.endYear,
    polities,
    settlements,
    cultures,
    annals,
    log,
    regionCount: fin.regions.count,
    ...(facts.length ? { upheavals: facts } : {}),
    // 生效了的即位(作者立的君主)、作者下令的仗由史事 intervene + 干预列表认(和推演里同一份在位表)
    ...(x.interventions ? { interventions: x.interventions } : {}),
  }); // ⑥ people.ts(君主、统帅、宗室、名臣)

  const civ: Civ = {
    seed,
    endYear: p.endYear,
    habitat: fin.habitat,
    regions: fin.regions,
    cultures,
    settlements,
    polities,
    routes,
    places,
    culture,
    polity,
    log,
    checkpoints,
    annals,
    viable,
    spreadYears: model?.spreadYears,
    capNorm: pm?.capNorm,
    polityYears: pm?.years,
    ...(pm ? { capSpacing: pm.spacing } : {}),
    ...(pm ? { sailFrom: pm.sailFrom } : {}),
    ...(frontier ? { frontier } : {}),
    ...(fin.sim.calamity ? { calamity: fin.sim.calamity } : {}),
    ...(migrationsOf(fin.sim) ? { migrations: migrationsOf(fin.sim)! } : {}),
    ...(x.interventions ? { interventions: x.interventions.slice() } : {}),
    people,
    ...(facts.length ? { upheavals: facts, eras } : {}),
    ...(mix ? { names: mix } : {}),
  };
  // ⑦ religion.ts:要整份 civ(按年份查归属、国都、君主;地形大事以前按那时的州)
  if (viable && cultures.length) civ.religion = buildReligion(fin.world, civ);
  // 发展度:推演里算好的,整理一份(和推演结束那一刻的状态)
  if (viable && cultures.length) {
    const dev = finishDevelopment(fin.sim, p.endYear);
    if (dev) civ.development = dev;
  }
  return civ;
}

/** 作者在干预"立国"时起好的国名:国家编号 → 国名(史事 intervene 的 a = 新国,war = 第几条干预) */
function authoredNames(annals: readonly Annal[], interventions?: readonly Intervention[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!interventions?.length) return out;
  for (const e of annals) {
    if (e.kind !== 'intervene' || e.a < 0) continue;
    const v = interventions[e.war];
    if (v?.kind === 'found' && v.name) out.set(e.a, v.name);
  }
  return out;
}

/** 一件地形大事里有哪几种修改(按第一次出现的先后) */
function kindsOf(ops: readonly TerrainOp[]): UpheavalFact['kinds'] {
  const out: UpheavalFact['kinds'] = [];
  for (const o of ops) if ((o.kind === 'volcano' || o.kind === 'raise' || o.kind === 'sink') && !out.includes(o.kind)) out.push(o.kind);
  return out;
}

/**
 * 一段推演(到第 k 件大事的前一刻)不套这件大事、照原样推到底(branch)以后起的名字、配色:
 * 年份在 [from, to) 里出现的国家、城、王朝,和这一段里新划出来的州,钉住(第一段还钉住民族)。
 * 返回 branch 起好名的民族、城、国家和计划中的疆域(这一段的地名、道路照它定)
 */
function pinNames(pins: NamePins, world: World, branch: CivSim, from: number, to: number, first: boolean, mix?: NameMix, interventions?: readonly Intervention[]) {
  const res = branch.result();
  const bm = cultureModelOf(branch)!;
  const bpm = polityModelOf(branch)!;
  bpm.cultures = bm.cultures; // 接着推时两层各复制了一份民族表:起城名、国名要用起好名的那份
  const planned = finishCultures(world, bm, res.log, first ? undefined : pins, mix);
  finishPolities(world, bpm, res.log, pins, authoredNames(res.annals, interventions));
  // 推演中分化出来的民族:大事以前就有的才钉住(大事以后的那份历史里未必还会这样分化);
  // 每一段都补上这一段大事以前新分出来的(前面几段钉过的照旧)
  pins.cultures ??= new Map();
  for (const c of bm.cultures) {
    if (c.parent !== undefined && c.born >= to) continue;
    const k = cultureKey(c);
    if (!pins.cultures.has(k)) pins.cultures.set(k, { name: c.name, style: c.style, ...(c.autoStyle ? { autoStyle: c.autoStyle } : {}), color: [...c.color] as [number, number, number] });
  }
  const names = bm.terrain.regions.name ?? [];
  for (let r = 0; r < bm.terrain.regions.count; r++) if (pins.regionNames[r] === undefined) pins.regionNames[r] = names[r] ?? '';
  for (const q of bpm.polities) {
    let v = pins.polities.get(q.id);
    if (q.founded >= from && q.founded < to) {
      v = { name: q.name, color: [...q.color] as [number, number, number], dynasties: [] };
      pins.polities.set(q.id, v);
    }
    if (!v) continue;
    q.dynasties?.forEach((d, i) => {
      if (d.year >= from && d.year < to) v.dynasties[i] = d.name;
    });
  }
  for (const c of bpm.settlements) if (c.founded >= from && c.founded < to) pins.settlements.set(c.id, c.name);
  return { cultures: bm.cultures, planned, settlements: bpm.settlements, polities: bpm.polities };
}

/** 推到一半的历史(地形大事前一刻)拼成 CivSim.fromCiv 要的 Civ(州、宜居度按给的);归属数组、检查点按州数补齐(新州 = 没人) */
function partialCiv(sim: CivSim, model: CultureModel, pm: PolityModel, habitat: Habitat, regions: Regions, seed: number, iv: InterventionModel | null, frontier?: Frontier): Civ {
  const res = sim.result();
  const dev = finishDevelopment(sim, res.endYear);
  const pad = (a: Int16Array) => {
    if (a.length >= regions.count) return a;
    const b = new Int16Array(regions.count).fill(-1);
    b.set(a);
    return b;
  };
  return {
    seed,
    endYear: res.endYear,
    habitat,
    regions,
    cultures: model.cultures,
    settlements: pm.settlements,
    polities: pm.polities,
    routes: [],
    places: [],
    culture: pad(res.culture),
    polity: pad(res.polity),
    log: res.log,
    checkpoints: res.checkpoints.map((c) => (c.culture.length >= regions.count ? c : { year: c.year, culture: pad(c.culture), polity: pad(c.polity) })),
    annals: res.annals,
    viable: true,
    spreadYears: model.spreadYears,
    capNorm: pm.capNorm,
    polityYears: pm.years,
    capSpacing: pm.spacing,
    sailFrom: pm.sailFrom,
    ...(frontier ? { frontier } : {}),
    ...(sim.calamity ? { calamity: sim.calamity } : {}),
    ...(migrationsOf(sim) ? { migrations: migrationsOf(sim)! } : {}),
    ...(iv ? { interventions: iv.list.slice() } : {}),
    people: [],
    ...(dev ? { development: dev } : {}),
  } as Civ;
}

export function emptyLog(): ChangeLog {
  return {
    size: 0,
    year: new Float32Array(0),
    region: new Int32Array(0),
    layer: new Uint8Array(0),
    value: new Int16Array(0),
    cause: new Uint8Array(0),
  };
}

/** Civ 里所有类型化数组的底层缓冲区(去重),worker 发消息时用 transfer 传,省得复制 */
export function civTransferables(civ: Civ): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 4) return;
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer && v.buffer.byteLength > 0) out.add(v.buffer);
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1);
  };
  walk(civ, 0);
  return [...out];
}
