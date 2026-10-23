/**
 * 帮手模式(helperProtocol.ts)交给后台的名字和几样数:某一年看得到的、网站生成出来的名字,不套用作者改的名字
 * (历史用推演出来的原样,不过 applyNames;服务器拿它对出作者改的名字原来叫什么)。纯计算,单测直接调。
 *
 * 那一年看得到的:
 *   国名     那年存在的国家(那年的全称,键 = 国家);东方国家改朝换代以后,那年的全称用的是那一朝的国号(键 = 那一朝),
 *            立国时那一朝的国名另列一条(键 = 国家:改国名改的是它)
 *   朝代名   这些国家到那年为止的各朝(东方第一朝就是国名、东方当朝就是国名,不另列)
 *   族名     那年还在的民族;教名:那年以前创立的信仰(大教的创教者另列一个人名)
 *   城名     那年以前建的城(毁了的还留着遗址,照样列);州名:全部的州(州和历史无关)
 *   地名     那年的山河湖海岛(地形大事以后按那一段的)
 *   人名     那年在世的人物(君主、将领、名臣、宗室;作者的人物不算,他们的名字是作者写的);字、号另列
 * 先后照上面(人名最多,放在最后),最多 TEXTS_MAX 条。key 是和存档里改名同一套的稳定键(gen/edits.ts)。
 *
 * 还有:后台交来的作品(存档、新建参数)读成要交给后台线程生成的那一个(helperJob;galleryHelper.ts 拿去生成、画封面)。
 * 作者改的名字不带;干预"立国"里作者起的国名也不带(那是作者写的字,后台另外列),生成出来的是这个国家本来会叫的名字。
 */
import type { Civ, Person, Place, Polity } from '../gen/civ/types';
import type { WorkerRequest } from '../worker';
import { cleanCivSeed, cleanEndYear, cleanPlay, cultureKey, type Intervention, dynastyKey, faithKey, personKey, placeKeyOf, polityKey, regionKey, settlementKey } from '../gen/edits';
import { cleanFrontier, cleanOrigins } from '../gen/civ/frontier';
import { parseSave } from '../gen/savefile';
import { DEFAULT_PARAMS, type WorldParams } from '../gen/params';
import { decodePresetHash } from './presetLink';
import { dynastyAt, polityAlive, polityName } from '../gen/civ/growth';
import { cultureLabel, regionLabel } from '../gen/civ/display';
import { generalRole, ministerRole, princeRole, rulerRole } from '../gen/civ/peopleText';
import { personArt } from '../gen/civ/officialText';
import { TEXTS_MAX, type HelperKind, type HelperText, type RenderRequest } from './helperProtocol';

/**
 * 照作品要生成的那一个:请求(不带编号;不带作者改的名字)、封面停在哪年(世界的;没有 = 结束那年)、中央经线(度)
 */
export interface HelperJob {
  kind: HelperKind;
  params: WorldParams;
  input: Omit<Extract<WorkerRequest, { type: 'generate' }>, 'type' | 'id'>;
  moment?: { year?: number } | null;
  lon?: number;
}

/** 干预"立国"里作者起的国名去掉(其余照旧) */
function withoutFoundNames(list: readonly Intervention[]): Intervention[] {
  return list.map((x) => {
    if (x.kind !== 'found' || x.name === undefined) return x;
    const { name: _, ...rest } = x;
    return rest;
  });
}

/** 后台交来的作品 → 要生成的那一个;存档、新建参数读不出来 = 抛出给管理员看的中文 */
export function helperJob(r: RenderRequest): HelperJob {
  if (r.kind === 'preset') {
    const p = decodePresetHash(r.preset ?? '');
    if (!p.ok) throw new Error(`新建参数读不出来：${p.error}`);
    const params: WorldParams = { ...DEFAULT_PARAMS, ...p.preset.params, seed: p.preset.seed ?? DEFAULT_PARAMS.seed };
    const endYear = cleanEndYear(p.preset.endYear);
    return { kind: r.kind, params, input: { params, scale: 1, ...(endYear ? { endYear } : {}) } };
  }
  const p = parseSave(JSON.stringify(r.save ?? null));
  if (!p.ok) throw new Error(`存档读不出来：${p.error}`);
  const sv = p.save;
  const e = sv.edits;
  const endYear = cleanEndYear(e.endYear);
  const frontier = cleanFrontier(e.frontier);
  const origins = cleanOrigins(e.origins);
  const civSeed = cleanCivSeed(e.civSeed);
  const played = cleanPlay(e.play);
  const play = played && { ...played, commands: withoutFoundNames(played.commands) };
  const input: HelperJob['input'] = {
    params: sv.params,
    scale: 1,
    terrain: [...e.terrain],
    ...(e.sketch ? { sketch: e.sketch } : {}),
    interventions: withoutFoundNames(e.interventions),
    ...(e.upheavals?.length ? { upheavals: [...e.upheavals] } : {}),
    ...(e.nameMix ? { names: e.nameMix } : {}),
    ...(endYear ? { endYear } : {}),
    ...(frontier ? { frontier } : {}),
    ...(origins ? { origins } : {}),
    ...(civSeed !== undefined ? { civSeed } : {}),
    ...(play ? { play } : {}),
  };
  const world = r.kind === 'world';
  const lon = world && sv.view && Number.isFinite(sv.view.center) ? sv.view.center : undefined;
  return { kind: r.kind, params: sv.params, input, moment: world ? (sv.moment ?? null) : undefined, lon };
}

const PLACE_KIND: Record<Place['kind'], string> = {
  sea: '海',
  mountains: '山脉',
  river: '河流',
  lake: '湖泊',
  island: '岛屿',
  desert: '荒漠',
};

/** 民族那一年还在(兴起了、还没消亡) */
export function cultureAlive(c: Civ['cultures'][number], year: number): boolean {
  return !c.unborn && c.born <= year && (c.ended === undefined || year < c.ended);
}

/** 人物那一年在世 */
function personAlive(x: Person, year: number): boolean {
  return x.born <= year && (x.died === undefined || year < x.died);
}

function personRole(civ: Civ, x: Person): string {
  if (x.role === 'ruler') return rulerRole(civ, x) || '君主';
  if (x.role === 'general') return generalRole(civ, x);
  if (x.role === 'minister') return ministerRole(civ, x);
  return princeRole(civ, x);
}

/**
 * civ 在第 year 年看得到的生成名字。geo = 那一年的山河湖海岛用的那一段历史(地形大事以后各段的地名不同,见 ui/eras.ts 的 civAtEra;
 * 不给 = civ)。civ 不能是套过改名的那份
 */
export function helperTexts(civ: Civ, year: number, geo: Civ = civ): HelperText[] {
  const out: HelperText[] = [];
  const full = () => out.length >= TEXTS_MAX;
  const S = civ.settlements;
  const alive = civ.viable ? civ.polities.filter((p) => polityAlive(p, year)) : [];
  /** 东方国家那年是第几朝(全称用这一朝的国号);西幻的国名不随朝代变 = 0 */
  const eastAt = (p: Polity) => {
    const d = p.eastern && p.dynasties && p.dynasties.length > 1 ? dynastyAt(p, year) : undefined;
    return d ? Math.max(0, p.dynasties!.indexOf(d)) : 0;
  };
  for (const p of alive) {
    const now = polityName(p, year);
    const di = eastAt(p);
    if (!di) {
      out.push({ cat: '国名', text: now, key: polityKey(civ, p.id), where: '国家' });
      continue;
    }
    out.push({ cat: '国名', text: now, key: dynastyKey(civ, p.id, di), where: '国家' });
    out.push({ cat: '国名', text: polityName(p, p.founded), key: polityKey(civ, p.id), where: `${now}立国时的国名` });
  }
  for (const p of alive) {
    const now = polityName(p, year);
    const di = eastAt(p);
    (p.dynasties ?? []).forEach((d, i) => {
      if (d.year > year || !d.name || (p.eastern && (i === 0 || i === di))) return;
      out.push({ cat: '朝代名', text: p.eastern ? d.name : `${d.name}王朝`, key: dynastyKey(civ, p.id, i), where: `${now}的第 ${i + 1} 朝` });
    });
  }
  if (civ.viable) {
    civ.cultures.forEach((c, id) => {
      if (cultureAlive(c, year)) out.push({ cat: '族名', text: cultureLabel(c), key: cultureKey(civ, id), where: '民族' });
    });
    for (const f of civ.religion?.faiths ?? []) {
      if ((f.founded ?? 0) > year) continue;
      if (f.kind === 'folk' && civ.cultures[f.culture ?? f.id] && !cultureAlive(civ.cultures[f.culture ?? f.id], year)) continue;
      out.push({ cat: '教名', text: f.name, key: faithKey(civ, f.id), where: f.kind === 'folk' ? '民间信仰' : f.kind === 'sect' ? '教派' : '宗教' });
      if (f.founder?.name) out.push({ cat: '人名', text: f.founder.name, where: `${f.name}的创教者` });
    }
    for (const s of S) {
      if (s.founded > year) continue;
      out.push({ cat: '城名', text: s.name, key: settlementKey(civ, s.id), where: `城，在${regionLabel(civ, s.region)}` });
    }
  }
  for (let r = 0; r < civ.regions.count; r++) {
    const name = civ.regions.name?.[r];
    if (name) out.push({ cat: '州名', text: name, key: regionKey(civ, r), where: '州' });
  }
  geo.places.forEach((pl, i) => out.push({ cat: '地名', text: pl.name, key: placeKeyOf(geo, i), where: PLACE_KIND[pl.kind] }));
  if (civ.viable) {
    for (const x of civ.people ?? []) {
      if (full()) break;
      if (x.author !== undefined || !x.name || !personAlive(x, year)) continue;
      const role = personRole(civ, x);
      out.push({ cat: '人名', text: x.name, key: personKey(civ, x.id) || undefined, where: role });
      if (x.courtesy) out.push({ cat: '人名', text: x.courtesy, where: `${x.name}的字` });
      const art = personArt(civ, x);
      if (art) out.push({ cat: '人名', text: art, where: `${x.name}的号` });
    }
  }
  return out.slice(0, TEXTS_MAX);
}

/** 那一年现存几国、几族(没长出文明 = 0) */
export function helperCounts(civ: Civ | null, year: number): { states: number; peoples: number } {
  if (!civ?.viable) return { states: 0, peoples: 0 };
  return { states: civ.polities.filter((p) => polityAlive(p, year)).length, peoples: civ.cultures.filter((c) => cultureAlive(c, year)).length };
}
