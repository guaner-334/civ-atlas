/**
 * 插件读世界:把地图、历史、你写的东西换成接口上的样子(types.ts)。纯计算,不碰 DOM。
 * 数组一律新做一份交给 give(网站转交给插件,原来的那份不能交出去)。
 */
import { BIOMES } from '../gen/biomes';
import type { Civ } from '../gen/civ/types';
import { civAtEra } from '../gen/civ/eraCiv';
import { cellAreas } from '../gen/civ/geo';
import { KM_PER_UNIT } from '../gen/civ/scale';
import type { ChronicleEntry } from '../gen/civ/story/chronicle';
import { cultureKey, faithKey, personKey, placeKeyOf, polityKey, regionKey, settlementKey, type WorldEdits } from '../gen/edits';
import { capitalAt, faithAt, ownersAt, polityName, populationAt, portAt, regionPopulationAt, settlementRank } from '../gen/readers/openQuery';
import type { World } from '../gen/world';
import type { AuthorNote } from '../gen/worldFormat';
import { argsOf, bad, list, num, optInt, over, PluginApiError } from './check';
import type {
  AuthorMarkInfo,
  AuthorNoteInfo,
  CellArrays,
  CellField,
  CellOwners,
  CultureInfo,
  EventInfo,
  FaithInfo,
  Hex,
  HistorySpan,
  LegendEntry,
  Neighbors,
  OwnerField,
  Page,
  PersonInfo,
  PlaceInfo,
  PolityInfo,
  RegionInfo,
  RiverInfo,
  RouteInfo,
  SettlementInfo,
  WorldInfo,
} from './types';

/** 交给插件之前登记一下(转交、算取了多少) */
export type Give = <T extends ArrayBufferView>(a: T) => T;

export const CELL_FIELDS_MAX = 16;
export const EVENTS_MAX = 2000;
export const PEOPLE_MAX = 2000;
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

const CELL_FIELDS: readonly CellField[] = ['x', 'y', 'lon', 'lat', 'area', 'elevation', 'water', 'temperature', 'precipitation', 'biome', 'flux', 'seaIce'];

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
      return info;
    }),
  };
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
  return (edits.marks ?? []).map((m) => structuredClone(m) as AuthorMarkInfo);
}

export function authorNames(edits: WorldEdits): Record<string, string> {
  return { ...edits.names };
}

export function authorCharacters(edits: WorldEdits): unknown[] {
  return structuredClone(edits.characters ?? []);
}

export function authorInterventions(edits: WorldEdits): unknown[] {
  return structuredClone(edits.interventions);
}

export function authorNotes(notes: readonly AuthorNote[], raw: unknown): Page<AuthorNoteInfo> {
  const { offset, limit } = pageArgs(argsOf(raw), NOTES_MAX);
  const pg = page(notes, offset, limit);
  return { ...pg, items: pg.items.map((n) => ({ key: n.key, kind: n.kind, title: n.title, text: n.text, createdAt: n.createdAt })) };
}
