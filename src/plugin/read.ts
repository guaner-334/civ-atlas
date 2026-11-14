/**
 * 插件读世界:把地图、历史、你写的东西换成接口上的样子(types.ts)。纯计算,不碰 DOM。
 * 数组一律新做一份交给 give(网站转交给插件,原来的那份不能交出去)。
 */
import { BIOMES } from '../gen/biomes';
import type { Civ } from '../gen/civ/types';
import { controlShare } from '../gen/civ/control';
import { CAP_COUNT, CAPS, eraLevel, RESOURCE_COUNT, RESOURCES } from '../gen/civ/development';
import { relationsAt } from '../gen/civ/diplomacy';
import { civAtEra } from '../gen/civ/eraCiv';
import { cellAreas } from '../gen/civ/geo';
import { dynastyTitle } from '../gen/civ/growth';
import { THOUGHT_COUNT, THOUGHTS } from '../gen/civ/ideology';
import { KM_PER_UNIT } from '../gen/civ/scale';
import type { ChronicleEntry } from '../gen/civ/story/chronicle';
import { treatyBook, treatyMembersAt, treatyTitle } from '../gen/civ/story/treatyInfo';
import { cultureKey, dynastyKey, faithKey, personKey, placeKeyOf, polityKey, regionKey, resolveKey, settlementKey, tradeKey, treatyKey, YEAR_TICKS, type WorldEdits } from '../gen/edits';
import { geometryOf } from '../gen/geometry';
import { driftOf } from '../gen/plateOps';
import {
  capitalAt,
  controlAt,
  developmentAt,
  faithAt,
  ideologyAt,
  ownersAt,
  polityAlive,
  polityName,
  populationAt,
  portAt,
  regionPopulationAt,
  resourcesAt,
  settlementRank,
} from '../gen/readers/openQuery';
import type { World } from '../gen/world';
import type { AuthorNote } from '../gen/worldFormat';
import { argsOf, bad, list, num, optInt, over, PluginApiError } from './check';
import type {
  AuthorMarkInfo,
  AuthorNoteInfo,
  AuthorTerrainInfo,
  CellArrays,
  CellField,
  CellOwners,
  CultureInfo,
  DynastyInfo,
  EventInfo,
  FaithInfo,
  Hex,
  HistorySpan,
  InterventionInfo,
  LegendEntry,
  MigrationInfo,
  Neighbors,
  OwnerField,
  Page,
  PersonInfo,
  PlaceInfo,
  PlateInfo,
  PolityInfo,
  RegionInfo,
  RegionStat,
  RelationsInfo,
  ResourceName,
  RiverInfo,
  RouteInfo,
  SettlementInfo,
  TradeInfo,
  TreatyInfo,
  WorldInfo,
  ZoneInfo,
} from './types';

/** 交给插件之前登记一下(转交、算取了多少) */
export type Give = <T extends ArrayBufferView>(a: T) => T;

export const CELL_FIELDS_MAX = 16;
export const EVENTS_MAX = 2000;
export const PEOPLE_MAX = 2000;
/** 朝代、约、中立地、商道、大迁徙一页最多几项 */
export const LIST_MAX = 2000;
export const NOTES_MAX = 100;

const unavailable = (text: string): never => {
  throw new PluginApiError('unavailable', text);
};
/** 整段历史:地图上画的是地形大事以前那一段时,界面手里的是那一段,整段挂在 history 上 */
export const needCiv = (civ: Civ | null): Civ => civ?.history ?? civ ?? unavailable('这个世界还没有历史');

/** 第 year 年那一段地形的历史(州、道路、地名换成那一段的;大事那一年的年初发生) */
function eraCiv(civ: Civ, year: number): Civ {
  const f = civ.upheavals;
  let k = 0;
  while (f && k < f.length && f[k].year <= year) k++;
  return civAtEra(civ, k);
}

const hexOf = (c: readonly number[]): Hex => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

// ---------------------------------------------------------------------------
// 地图

export function worldInfo(world: World, title: string): WorldInfo {
  return { title, seed: world.params.seed, cells: world.mesh.n, width: world.width, height: world.height, kmPerUnit: KM_PER_UNIT };
}

const CELL_FIELDS: readonly CellField[] = ['x', 'y', 'lon', 'lat', 'area', 'elevation', 'water', 'temperature', 'precipitation', 'biome', 'flux', 'seaIce', 'plate', 'currentX', 'currentY', 'currentTemp'];

function cellField(world: World, f: CellField): CellArrays[CellField] {
  const { mesh } = world;
  switch (f) {
    case 'x':
      return mesh.x.slice();
    case 'y':
      return mesh.y.slice();
    case 'lon': {
      const out = new Float32Array(mesh.n);
      for (let i = 0; i < mesh.n; i++) out[i] = (mesh.x[i] / world.width) * 360 - 180;
      return out;
    }
    case 'lat': {
      const out = new Float32Array(mesh.n);
      for (let i = 0; i < mesh.n; i++) out[i] = 90 - (mesh.y[i] / world.height) * 180;
      return out;
    }
    case 'area': {
      const a = cellAreas(mesh);
      const out = new Float32Array(mesh.n);
      for (let i = 0; i < mesh.n; i++) out[i] = a[i] * KM_PER_UNIT * KM_PER_UNIT;
      return out;
    }
    case 'elevation':
      return world.elevation.slice();
    case 'water':
      return world.water.slice();
    case 'temperature':
      return world.temperature.slice();
    case 'precipitation':
      return world.precipitation.slice();
    case 'biome':
      return world.biome.slice();
    case 'flux':
      return world.flux.slice();
    case 'seaIce':
      return world.seaIce.slice();
    case 'plate':
      return world.tect.plate.slice();
    case 'currentX':
      return world.currents.u.slice();
    case 'currentY':
      return world.currents.v.slice();
    case 'currentTemp':
      return world.currents.sst.slice();
  }
}

export function worldCells(world: World, raw: unknown, give: Give): Partial<CellArrays> {
  const a = argsOf(raw);
  const fields = list(a.fields, 'fields', CELL_FIELDS_MAX);
  if (!fields.length) bad('fields 至少一种');
  const out: Partial<Record<CellField, ArrayBufferView>> = {};
  for (const f of fields) {
    if (!CELL_FIELDS.includes(f as CellField)) bad(`fields 里的 ${String(f).slice(0, 20)} 不认得,能取的有 ${CELL_FIELDS.join('、')}`);
    out[f as CellField] ??= give(cellField(world, f as CellField));
  }
  return out as Partial<CellArrays>;
}

export function worldNeighbors(world: World, give: Give): Neighbors {
  return { start: give(world.mesh.adjStart.slice()), list: give(world.mesh.adj.slice()) };
}

export function worldRivers(world: World, give: Give): RiverInfo[] {
  return world.rivers.map((r) => ({ cells: give(r.cells.slice()) }));
}

const WATER_NAMES = ['陆地', '海洋', '湖泊'];

export function worldLegend(raw: unknown): LegendEntry[] {
  const kind = argsOf(raw).kind;
  if (kind === 'biome') return BIOMES.map((b) => ({ value: b.id, name: b.name }));
  if (kind === 'water') return WATER_NAMES.map((name, value) => ({ value, name }));
  return bad('kind 只能是 biome、water');
}

export function worldPlates(world: World): PlateInfo[] {
  const { mesh, tect } = world;
  const P = tect.plateCount;
  const cnt = new Float64Array(P);
  for (let i = 0; i < mesh.n; i++) cnt[tect.plate[i]]++;
  const cen = geometryOf(mesh).groupCentroids(tect.plate, P, cnt);
  const out: PlateInfo[] = [];
  for (let p = 0; p < P; p++) {
    if (!cnt[p]) continue;
    const { dir, speed } = driftOf(tect.plateVx[p], tect.plateVy[p]);
    out.push({ id: p, continental: tect.plateContinental[p] === 1, cells: cnt[p], x: cen.x[p], y: cen.y[p], dir, speed });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 历史

export function historySpan(civ: Civ): HistorySpan {
  return { from: 0, to: civ.endYear };
}

/** 年份:在历史的头尾之间 */
function yearOf(civ: Civ, v: unknown, at = 'year'): number {
  return num(v, at, 0, civ.endYear);
}
const optYear = (civ: Civ, v: unknown) => (v === undefined ? undefined : yearOf(civ, v));

const OWNER_FIELDS: readonly OwnerField[] = ['polity', 'culture', 'faith', 'region'];

export function historyAt(world: World, civ: Civ, raw: unknown, give: Give): Partial<CellOwners> {
  const a = argsOf(raw);
  const year = yearOf(civ, a.year);
  const fields = list(a.fields, 'fields', OWNER_FIELDS.length * 2);
  if (!fields.length) bad('fields 至少一种');
  for (const f of fields) if (!OWNER_FIELDS.includes(f as OwnerField)) bad(`fields 里的 ${String(f).slice(0, 20)} 不认得,能取的有 ${OWNER_FIELDS.join('、')}`);
  const want = new Set(fields as OwnerField[]);
  const n = world.mesh.n;
  const of = eraCiv(civ, year).regions.of;
  const out: Partial<CellOwners> = {};
  const spread = (byRegion: Int16Array) => {
    const cells = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const r = of[i];
      cells[i] = r >= 0 && r < byRegion.length ? byRegion[r] : -1;
    }
    return give(cells);
  };
  if (want.has('polity') || want.has('culture')) {
    const own = ownersAt(civ, year);
    if (want.has('polity')) out.polity = spread(own.polity);
    if (want.has('culture')) out.culture = spread(own.culture);
  }
  if (want.has('faith')) out.faith = spread(faithAt(civ, year));
  if (want.has('region')) out.region = give(of.slice(0, n));
  return out;
}

const lastYear = (civ: Civ, ended: number | undefined) => Math.max(0, Math.min(civ.endYear, ended === undefined ? civ.endYear : ended - 1 / 256));

export function historyPolities(civ: Civ, raw: unknown): PolityInfo[] {
  const year = optYear(civ, argsOf(raw).year);
  const out: PolityInfo[] = [];
  for (const p of civ.polities) {
    if (year !== undefined && !(year >= p.founded && (p.ended === undefined || year < p.ended))) continue;
    const at = year ?? lastYear(civ, p.ended);
    const info: PolityInfo = {
      id: p.id,
      key: polityKey(civ, p.id),
      name: polityName(p, at),
      root: p.name,
      color: hexOf(p.color),
      founded: p.founded,
      capital: capitalAt(p, at),
      culture: p.culture,
    };
    if (p.ended !== undefined) info.ended = p.ended;
    if (p.parent !== undefined) info.parent = p.parent;
    out.push(info);
  }
  return out;
}

export function historySettlements(civ: Civ, raw: unknown): SettlementInfo[] {
  const year = optYear(civ, argsOf(raw).year);
  const out: SettlementInfo[] = [];
  for (const s of civ.settlements) {
    if (year !== undefined && !(year >= s.founded && (s.ended === undefined || year < s.ended))) continue;
    const info: SettlementInfo = { id: s.id, key: settlementKey(civ, s.id), name: s.name, cell: s.cell, region: s.region, founded: s.founded, port: year === undefined ? s.port : portAt(s, year) };
    if (s.ended !== undefined) info.ended = s.ended;
    if (year !== undefined) {
      info.population = populationAt(s, year);
      info.rank = settlementRank(info.population);
    }
    out.push(info);
  }
  return out;
}

export function historyRoutes(civ: Civ, raw: unknown, give: Give): RouteInfo[] {
  const year = optYear(civ, argsOf(raw).year);
  const out: RouteInfo[] = [];
  for (const r of (year === undefined ? civ : eraCiv(civ, year)).routes) {
    if (year !== undefined && !(year >= r.built && (r.abandoned === undefined || year < r.abandoned))) continue;
    const info: RouteInfo = { kind: r.kind, cells: give(r.cells.slice()), built: r.built };
    if (r.abandoned !== undefined) info.abandoned = r.abandoned;
    out.push(info);
  }
  return out;
}

export function historyPlaces(civ: Civ): PlaceInfo[] {
  return civ.places.map((p, i) => {
    const info: PlaceInfo = { id: i, key: placeKeyOf(civ, i), kind: p.kind, name: p.name, rank: p.rank };
    if (p.cell !== undefined) info.cell = p.cell;
    return info;
  });
}

export function historyCultures(civ: Civ): CultureInfo[] {
  return civ.cultures.map((c) => {
    const info: CultureInfo = { id: c.id, key: cultureKey(civ, c.id), name: c.name, kind: c.kind, hearth: c.hearth, born: c.born, color: hexOf(c.color) };
    if (c.ended !== undefined) info.ended = c.ended;
    if (c.parent !== undefined) info.parent = c.parent;
    return info;
  });
}

export function historyFaiths(civ: Civ): FaithInfo[] {
  return (civ.religion?.faiths ?? []).map((f) => {
    const info: FaithInfo = { id: f.id, key: faithKey(civ, f.id), name: f.name, kind: f.kind, color: hexOf(f.color) };
    if (f.form !== undefined) info.form = f.form;
    if (f.culture !== undefined) info.culture = f.culture;
    if (f.parent !== undefined) info.parent = f.parent;
    if (f.founded !== undefined) info.founded = f.founded;
    if (f.holy !== undefined) info.holy = f.holy;
    return info;
  });
}

export function historyRegions(civ: Civ, raw: unknown): RegionInfo[] {
  const year = optYear(civ, argsOf(raw).year);
  const R = (year === undefined ? civ : eraCiv(civ, year)).regions;
  const out: RegionInfo[] = [];
  for (let r = 0; r < R.count; r++) {
    const info: RegionInfo = {
      id: r,
      key: regionKey(civ, r),
      name: civ.regionNames?.[r] || R.name?.[r] || '',
      seat: R.seat[r],
      area: R.area[r] * KM_PER_UNIT * KM_PER_UNIT,
    };
    if (year !== undefined) info.population = regionPopulationAt(civ, r, year);
    out.push(info);
  }
  return out;
}

function pageArgs(a: Record<string, unknown>, max: number): { offset: number; limit: number } {
  const offset = optInt(a.offset, 'offset', 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const limit = optInt(a.limit, 'limit', 1, Number.MAX_SAFE_INTEGER) ?? max;
  return { offset, limit: limit > max ? over(`limit 最多 ${max}`) : limit };
}
function page<T>(all: readonly T[], offset: number, limit: number): Page<T> {
  const items = all.slice(offset, offset + limit);
  return { items, total: all.length, next: offset + items.length < all.length ? offset + items.length : null };
}

const ROLES = ['ruler', 'general', 'prince', 'minister', 'consort'];

export function historyPeople(civ: Civ, raw: unknown): Page<PersonInfo> {
  const a = argsOf(raw);
  const { offset, limit } = pageArgs(a, PEOPLE_MAX);
  const polity = optInt(a.polity, 'polity', 0, civ.polities.length - 1);
  if (a.role !== undefined && !ROLES.includes(a.role as string)) bad(`role 只能是 ${ROLES.join('、')}`);
  const role = a.role as PersonInfo['role'] | undefined;
  const people = (civ.people ?? []).filter((p) => (polity === undefined || p.polity === polity) && (role === undefined || p.role === role));
  const pg = page(people, offset, limit);
  return {
    ...pg,
    items: pg.items.map((p) => {
      const info: PersonInfo = {
        id: p.id,
        key: personKey(civ, p.id),
        name: p.name || (p.author !== undefined ? (civ.authorNames?.[p.author] ?? '') : ''),
        role: p.role,
        polity: p.polity,
        born: p.born,
      };
      if (p.died !== undefined) info.died = p.died;
      if (p.from !== undefined) info.from = p.from;
      if (p.until !== undefined) info.until = p.until;
      if (p.title) info.title = p.title;
      if (p.female) info.female = true;
      if (p.parent !== undefined) info.parent = p.parent;
      if (p.adopted) info.adopted = true;
      if (p.mom !== undefined) info.mom = p.mom;
      if (p.husband !== undefined) info.husband = p.husband;
      if (p.spouses?.length)
        info.spouses = p.spouses.map((s) => {
          const o: NonNullable<PersonInfo['spouses']>[number] = { polity: s.polity, father: s.father, year: s.year };
          if (s.person !== undefined) o.person = s.person;
          return o;
        });
      if (p.dynasty !== undefined) info.dynasty = p.dynasty;
      if (p.descent) info.descent = { from: p.descent.from, gen: p.descent.gen };
      return info;
    }),
  };
}

export function historyDynasties(civ: Civ, raw: unknown): Page<DynastyInfo> {
  const a = argsOf(raw);
  const { offset, limit } = pageArgs(a, LIST_MAX);
  const polity = optInt(a.polity, 'polity', 0, civ.polities.length - 1);
  const all: [number, number][] = [];
  for (const p of polity === undefined ? civ.polities : [civ.polities[polity]]) p.dynasties?.forEach((_, i) => all.push([p.id, i]));
  const pg = page(all, offset, limit);
  return {
    ...pg,
    items: pg.items.map(([id, i]) => {
      const p = civ.polities[id];
      const d = p.dynasties![i];
      const until = p.dynasties![i + 1]?.year ?? p.ended;
      const info: DynastyInfo = { polity: id, index: i, key: dynastyKey(civ, id, i), name: dynastyTitle(p, i), from: d.year, seat: d.seat };
      if (until !== undefined) info.until = until;
      if (d.regime) info.regime = d.regime;
      return info;
    }),
  };
}

const inForce = (year: number | undefined, from: number, ended: number | undefined) => year === undefined || (year >= from && (ended === undefined || year < ended));

export function historyTreaties(civ: Civ, raw: unknown): Page<TreatyInfo> {
  const a = argsOf(raw);
  const year = optYear(civ, a.year);
  const { offset, limit } = pageArgs(a, LIST_MAX);
  const hit = treatyBook(civ).treaties.filter((x) => x && inForce(year, x.start, x.ended));
  const pg = page(hit, offset, limit);
  return {
    ...pg,
    items: pg.items.map((x) => {
      const info: TreatyInfo = {
        id: x.id,
        key: treatyKey(civ, x.id),
        name: treatyTitle(civ, x.id),
        kind: x.kind,
        how: x.how,
        parties: x.parties.slice(),
        start: x.start,
        term: x.term,
        settlement: x.settlement,
        region: x.region,
        by: x.by,
        foe: x.foe,
        renewals: x.renewals.map((r) => ({ year: r.year, parties: r.parties.slice(), term: r.term })),
        breaches: x.breaches.map((b) => ({ year: b.year, by: b.by, against: b.against })),
        zone: x.zone,
      };
      if (Number.isFinite(x.until)) info.until = x.until;
      if (x.ended !== undefined) info.ended = x.ended;
      if (x.end) info.end = x.end;
      if (x.keep) info.keep = true;
      if (year !== undefined) info.members = treatyMembersAt(civ, x, year);
      return info;
    }),
  };
}

export function historyZones(civ: Civ, raw: unknown): Page<ZoneInfo> {
  const a = argsOf(raw);
  const year = optYear(civ, a.year);
  const { offset, limit } = pageArgs(a, LIST_MAX);
  const hit = treatyBook(civ).zones.filter((z) => z && inForce(year, z.from, z.ended));
  const pg = page(hit, offset, limit);
  return {
    ...pg,
    items: pg.items.map((z) => {
      const info: ZoneInfo = { id: z.id, region: z.region, settlement: z.settlement, treaty: z.treaty, how: z.how, founders: z.founders.slice(), owner: z.owner, from: z.from, residents: z.residents.slice() };
      if (z.ended !== undefined) info.ended = z.ended;
      if (z.back !== undefined) info.back = z.back;
      return info;
    }),
  };
}

/** 盟约照国家卡片上的算:推演里结的,加上用的人下令结的(那一年在约期内、两国都在) */
export function historyRelations(civ: Civ, raw: unknown): RelationsInfo {
  const year = yearOf(civ, argsOf(raw).year);
  const r = relationsAt(civ, year);
  const alliances: RelationsInfo['alliances'] = r.pacts.map((x) => ({ a: x.a, b: x.b, since: x.since, foe: x.foe }));
  const has = new Set(alliances.map((x) => `${Math.min(x.a, x.b)},${Math.max(x.a, x.b)}`));
  for (const v of civ.interventions ?? []) {
    if (v.kind !== 'ally') continue;
    const from = v.from + (v.fromTick ?? 0) / YEAR_TICKS;
    if (year < from || (v.until !== undefined && year >= v.until)) continue;
    const A = resolveKey(civ, v.a);
    const B = resolveKey(civ, v.b);
    if (A?.kind !== 'polity' || B?.kind !== 'polity' || A.id === B.id) continue;
    const pa = civ.polities[A.id];
    const pb = civ.polities[B.id];
    const k = `${Math.min(A.id, B.id)},${Math.max(A.id, B.id)}`;
    if (!pa || !pb || !polityAlive(pa, year) || !polityAlive(pb, year) || has.has(k)) continue;
    has.add(k);
    alliances.push({ a: A.id, b: B.id, since: Math.max(from, pa.founded, pb.founded), foe: -1, decree: true });
  }
  return { alliances, vassals: [...r.liege].map(([polity, x]) => ({ polity, liege: x.liege, since: x.since })) };
}

const RESOURCE_NAMES: readonly ResourceName[] = ['grain', 'livestock', 'copper', 'iron', 'coal', 'timber', 'salt', 'fish', 'oil', 'rare', 'gold'];
/** 推演里的物产下标 → 接口上的名字(按中文名对,推演那边换了先后也不错位) */
const RES_ZH: Readonly<Record<ResourceName, string>> = { grain: '粮', livestock: '牲畜', copper: '铜锡', iron: '铁', coal: '煤', timber: '木材', salt: '盐', fish: '渔获', oil: '石油', rare: '稀有矿', gold: '金银' };
const resourceName = (i: number): ResourceName => RESOURCE_NAMES.find((n) => RES_ZH[n] === RESOURCES[i]) ?? unavailable(`认不得第 ${i} 样物产`);

export function historyTrade(civ: Civ, raw: unknown): Page<TradeInfo> {
  const a = argsOf(raw);
  const year = optYear(civ, a.year);
  const { offset, limit } = pageArgs(a, LIST_MAX);
  const routes = civ.trade?.routes ?? [];
  const hit = year === undefined ? routes : routes.filter((r) => r.events.length && inForce(year, r.events[0].year, r.events.find((e) => e.kind === 'end')?.year));
  const pg = page(hit, offset, limit);
  return {
    ...pg,
    items: pg.items.map((r) => ({
      id: r.id,
      key: tradeKey(civ, r.id),
      name: r.name,
      buyer: r.buyer,
      from: r.from,
      goods: r.goods.map((g) => (g.until === undefined ? { resource: resourceName(g.res), from: g.from } : { resource: resourceName(g.res), from: g.from, until: g.until })),
      events: r.events.map((e) => {
        const o: TradeInfo['events'][number] = { year: e.year, kind: e.kind };
        if (e.foe !== undefined) o.foe = e.foe;
        if (e.why) o.why = e.why;
        return o;
      }),
      paths: r.paths.map((p) => ({ year: p.year, regions: p.regions.slice() })),
    })),
  };
}

const DIRS: Readonly<Record<string, MigrationInfo['dir']>> = { 东: 'east', 南: 'south', 西: 'west', 北: 'north' };

export function historyMigrations(civ: Civ, raw: unknown): Page<MigrationInfo> {
  const { offset, limit } = pageArgs(argsOf(raw), LIST_MAX);
  const all = civ.migrations ?? [];
  const pg = page(all, offset, limit);
  return {
    ...pg,
    items: pg.items.map((m, j) => {
      const info: MigrationInfo = {
        id: offset + j,
        culture: m.culture,
        year: m.year,
        route: m.route.slice(),
        years: m.years.slice(),
        dir: DIRS[m.dir],
        size: m.size,
        push: m.push,
        pull: m.pull,
        target: m.target,
      };
      if (m.settled !== undefined) info.settled = m.settled;
      if (m.outcome) info.outcome = m.outcome;
      if (m.outcomeYear !== undefined) info.outcomeYear = m.outcomeYear;
      if (m.polity !== undefined) info.polity = m.polity;
      return info;
    }),
  };
}

const DEV_ZH: Readonly<Record<string, string>> = { production: '生产', transport: '运输', information: '信息', administration: '行政', mobilization: '动员' };
const IDEO_ZH: Readonly<Record<string, string>> = { mandate: '天命之说', law: '律法之说', council: '共治之说', craft: '技艺之说', rights: '民权之说', nation: '国族之说', commons: '均产之说' };
const REGION_STATS: readonly RegionStat[] = [
  'population',
  'control',
  'era',
  ...(Object.keys(DEV_ZH).map((k) => `dev.${k}`) as RegionStat[]),
  ...RESOURCE_NAMES.map((k) => `res.${k}` as const),
  ...(Object.keys(IDEO_ZH).map((k) => `ideology.${k}`) as RegionStat[]),
];
export const REGION_STATS_MAX = 32;

/**
 * 发展、物产、思潮在两份快照之间线性插值,和网站自己的图层一样;
 * 管辖是分档的,取不晚于那一年的最近一份(比第一份早 = NaN)
 */
export function historyRegionStats(civ: Civ, raw: unknown, give: Give): Partial<Record<RegionStat, Float32Array>> {
  const a = argsOf(raw);
  const year = yearOf(civ, a.year);
  const fields = list(a.fields, 'fields', REGION_STATS_MAX);
  if (!fields.length) bad('fields 至少一种');
  for (const f of fields) if (!REGION_STATS.includes(f as RegionStat)) bad(`fields 里的 ${String(f).slice(0, 24)} 不认得,能取的有 ${REGION_STATS.join('、')}`);
  const R = civ.regions.count;
  const dev = civ.development;
  let lv: Float32Array | null | undefined;
  let res: Float32Array | null | undefined;
  let ideo: Float32Array | null | undefined;
  const levels = () => (lv === undefined ? (lv = dev ? developmentAt(dev, year) : null) : lv);
  /** 一州 k 栏的表(R × K)→ 每州一个数;表比州少的(更早的地形)补 NaN */
  const column = (src: Float32Array | null, K: number, k: number) => {
    const out = new Float32Array(R).fill(NaN);
    if (src && k >= 0) for (let r = 0; r < R && r * K + k < src.length; r++) out[r] = src[r * K + k];
    return out;
  };
  const one = (f: RegionStat): Float32Array => {
    if (f === 'population') {
      const out = new Float32Array(R);
      for (let r = 0; r < R; r++) out[r] = regionPopulationAt(civ, r, year);
      return out;
    }
    if (f === 'control') {
      const snap = controlAt(civ, year);
      const out = new Float32Array(R).fill(NaN);
      if (snap) for (let r = 0; r < R && r < snap.length; r++) out[r] = controlShare(snap[r]);
      return out;
    }
    if (f === 'era') {
      const l = levels();
      const out = new Float32Array(R).fill(NaN);
      if (l) for (let r = 0; r < R && (r + 1) * CAP_COUNT <= l.length; r++) out[r] = eraLevel(l, r);
      return out;
    }
    const [group, name] = f.split('.');
    if (group === 'dev') return column(levels(), CAP_COUNT, CAPS.indexOf(DEV_ZH[name] as (typeof CAPS)[number]));
    if (group === 'res') {
      if (res === undefined) res = dev ? resourcesAt(dev, year) : null;
      return column(res, RESOURCE_COUNT, RESOURCES.indexOf(RES_ZH[name as ResourceName] as (typeof RESOURCES)[number]));
    }
    if (ideo === undefined) ideo = civ.ideology ? ideologyAt(civ.ideology, year) : null;
    return column(ideo, THOUGHT_COUNT, THOUGHTS.findIndex((t) => t.name === IDEO_ZH[name]));
  };
  const out: Partial<Record<RegionStat, Float32Array>> = {};
  for (const f of fields as RegionStat[]) out[f] ??= give(one(f));
  return out;
}

export function historyEvents(civ: Civ, chronicle: readonly ChronicleEntry[] | null, raw: unknown): Page<EventInfo> {
  if (!chronicle) return unavailable('编年史还没写好');
  const a = argsOf(raw);
  const from = a.from === undefined ? 0 : yearOf(civ, a.from, 'from');
  const to = a.to === undefined ? civ.endYear : yearOf(civ, a.to, 'to');
  if (to < from) bad('to 不能早于 from');
  const { offset, limit } = pageArgs(a, EVENTS_MAX);
  const hit = chronicle.filter((e) => e.year >= from && e.year <= to);
  const pg = page(hit, offset, limit);
  return {
    ...pg,
    items: pg.items.map((e) => {
      const info: EventInfo = {
        id: e.id,
        year: e.year,
        end: e.end,
        tag: e.tag,
        text: e.text,
        importance: e.importance,
        polities: e.polities.slice(),
        regions: e.regions.slice(),
        settlement: e.settlement,
      };
      if (e.people?.length) info.people = e.people.slice();
      return info;
    }),
  };
}

// ---------------------------------------------------------------------------
// 你写的东西

export function authorMarks(edits: WorldEdits): AuthorMarkInfo[] {
  return (edits.marks ?? []).map((m): AuthorMarkInfo => structuredClone(m));
}

export function authorNames(edits: WorldEdits): Record<string, string> {
  return { ...edits.names };
}

export function authorCharacters(edits: WorldEdits): unknown[] {
  return structuredClone(edits.characters ?? []);
}

export function authorInterventions(edits: WorldEdits): InterventionInfo[] {
  return structuredClone(edits.interventions);
}

export function authorTerrain(edits: WorldEdits): AuthorTerrainInfo {
  const out: AuthorTerrainInfo = { terrain: structuredClone(edits.terrain ?? []), upheavals: structuredClone(edits.upheavals ?? []) };
  if (edits.sketch) out.sketch = structuredClone(edits.sketch);
  return out;
}

export function authorNotes(notes: readonly AuthorNote[], raw: unknown): Page<AuthorNoteInfo> {
  const { offset, limit } = pageArgs(argsOf(raw), NOTES_MAX);
  const pg = page(notes, offset, limit);
  return { ...pg, items: pg.items.map((n) => ({ key: n.key, kind: n.kind, title: n.title, text: n.text, createdAt: n.createdAt })) };
}
