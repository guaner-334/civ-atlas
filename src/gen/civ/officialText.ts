/**
 * 名臣、将领的字号、官职、生平怎么写(纯计算,不碰 DOM;数据见 officials.ts)。国名、城名、君主的称呼一律现查,作者改了名跟着变。
 *
 * - personArt      号:籍贯城名 + 后半("揽霞居士");没有号 = ''
 * - personByname   西幻的别称:"索伦纳的阿尔德里克"(没有字号的语感用籍贯区分同名的人);东方 = ''
 * - postAt / topPost  某一年的官职 / 做过最高的官
 * - ministerRole   "大景丞相"(国名按做到最高那个官那年的简称)
 * - deedLine       一句为什么有名(人物页一行、名人的"事迹")
 * - personBio      一段生平(名臣、将领):籍贯字号、一级级的官、经手的事、结局。东方写得文一些("拜丞相""卒于任上"),西幻、共和国平实些
 */
import type { Civ, Person, PersonDeed, PersonPost, Polity, Year } from './types';
import { polityName, polityShortTitle, polityTierAt } from './growth';
import { cnNumber } from './chronicle';
import { ageAt, personName } from './peopleText';
import { commandFoes, generalTally } from './peopleInfo';
import { artName } from './officials';

const F = Math.floor;
const clampTier = (t: number) => Math.max(0, Math.min(3, t));

function polityOfPerson(civ: Civ, x: Person): Polity | undefined {
  return civ.polities[x.polity];
}

function cityOf(civ: Civ, id: number | undefined): string {
  return id !== undefined && id >= 0 && id < civ.settlements.length ? civ.settlements[id].name || '' : '';
}

/** 国名的简称(按那一年的档位) */
function shortName(p: Polity, year: Year): string {
  return polityShortTitle(p, clampTier(polityTierAt(p, year)), year);
}

/** 号("揽霞居士");没有 = '' */
export function personArt(civ: Civ, x: Person): string {
  const city = cityOf(civ, x.home);
  return x.art && city ? artName(city, x.art) : '';
}

/** 西幻的别称:"索伦纳的阿尔德里克"(名臣、将领;东方、没有籍贯的 = '') */
export function personByname(civ: Civ, x: Person): string {
  const p = polityOfPerson(civ, x);
  const city = cityOf(civ, x.home);
  if (!p || p.eastern || !city || (x.role !== 'minister' && x.role !== 'general')) return '';
  return `${city}的${x.name}`;
}

/** 某一年的官职(还没入仕 = undefined) */
export function postAt(x: Person, year: Year): PersonPost | undefined {
  let out: PersonPost | undefined;
  for (const p of x.posts ?? []) if (p.from <= year + 1e-9) out = p;
  return out;
}

/** 做过最高的官(最后一任) */
export function topPost(x: Person): PersonPost | undefined {
  const ps = x.posts ?? [];
  return ps[ps.length - 1];
}

/** "大景丞相""兹拉季纳首相"(国名按做到最高那个官那年) */
export function ministerRole(civ: Civ, x: Person): string {
  const p = polityOfPerson(civ, x);
  const top = topPost(x);
  if (!p) return top?.title ?? '大臣';
  return `${shortName(p, top?.from ?? x.from ?? x.born)}${top?.title ?? '大臣'}`;
}

/** 史事里本国得、失了几州(议和:紧挨在 peace 前面的割让) */
function peaceSwing(civ: Civ, idx: number, polity: number): { got: number; lost: number } {
  const e = civ.annals[idx];
  let got = 0;
  let lost = 0;
  if (!e || !(e.region > 0)) return { got, lost };
  for (let j = Math.max(0, idx - e.region); j < idx; j++) {
    const c = civ.annals[j];
    if (c.kind !== 'conquer' || c.war !== e.war) continue;
    if (c.a === polity) got++;
    else if (c.b === polity) lost++;
  }
  return { got, lost };
}

/** 对面那国(宣战、议和) */
function foeOf(civ: Civ, idx: number | undefined, polity: number): Polity | undefined {
  const e = idx !== undefined ? civ.annals[idx] : undefined;
  if (!e) return undefined;
  return civ.polities[e.a === polity ? e.b : e.a];
}

/** 先君(被弑的那位:拥立的新君的前一位) */
function prevRuler(civ: Civ, r: Person): Person | undefined {
  let best: Person | undefined;
  for (const y of civ.people ?? []) if (y.role === 'ruler' && y.polity === r.polity && y.until === r.from && y !== r) best = y;
  return best;
}

const UPHEAVAL_WORD: Record<string, string> = { volcano: '火山喷发', raise: '地动山摇', sink: '海水倒灌' };

/** 一件事的说法(东方 / 西幻);带年份的在 personBio 里加 */
function deedText(civ: Civ, x: Person, d: PersonDeed, east: boolean): string {
  const p = civ.polities[x.polity];
  const who = d.person !== undefined ? civ.people?.[d.person] : undefined;
  const whoName = who ? personName(civ, who) : '';
  const foe = foeOf(civ, d.annal, x.polity);
  const foeName = foe ? polityName(foe, d.year) : '';
  switch (d.kind) {
    case 'found': {
      const rise = who?.rise;
      const top = postAt(x, d.year)?.title ?? '';
      if (east) {
        const act = rise === 'rebel' ? '随' + whoName + '自立' : rise === 'restore' ? '随' + whoName + '复国' : rise === 'rise' ? '从' + whoName + '起兵开国' : '佐' + whoName + '开国';
        return top ? `${act}，以佐命之功拜${top}` : act;
      }
      const act = rise === 'rebel' ? `追随${whoName}自立` : rise === 'restore' ? `追随${whoName}复国` : `追随${whoName}建国`;
      return top ? `${act}，任${top}` : act;
    }
    case 'regent': {
      const age = who ? ageAt(who, d.year) : 0;
      const years = d.until !== undefined ? Math.max(1, F(d.until) - F(d.year)) : 0;
      if (east) return `${whoName}即位，年方 ${age} 岁，受遗命辅政${years ? ` ${years} 年` : ''}`;
      return `${whoName}年幼即位（${age} 岁），受命摄政${years ? ` ${years} 年` : ''}`;
    }
    case 'enthrone': {
      const prev = who ? prevRuler(civ, who) : undefined;
      const prevName = prev ? personName(civ, prev) : '先君';
      return east ? `${prevName}遇弑，迎立${whoName}` : `${prevName}遇刺，拥立${whoName}继位`;
    }
    case 'rank': {
      const tier = clampTier(polityTierAt(p, d.year));
      if (p.lineage === 'republic') return '力主改行帝制';
      if (east) return tier >= 3 ? `率群臣劝进，${whoName}称帝` : `劝${whoName}称王`;
      return tier >= 3 ? `力主${whoName}加冕称帝` : `力主${whoName}称王`;
    }
    case 'capital': {
      const e = d.annal !== undefined ? civ.annals[d.annal] : undefined;
      const city = e ? cityOf(civ, e.settlement) : '';
      if (e && e.war >= 0) return east ? `国都失守，护驾迁都${city}` : `国都失守，护送王室迁往${city}`;
      return east ? `力主迁都${city}` : `主张迁都${city}`;
    }
    case 'relief': {
      const u = d.upheaval !== undefined ? civ.upheavals?.[d.upheaval] : undefined;
      const what = u?.kinds.length ? UPHEAVAL_WORD[u.kinds[0]] : '天灾';
      return east ? `${what}，主持赈济` : `${what}，主持赈灾`;
    }
    case 'peace': {
      const { got, lost } = d.annal !== undefined ? peaceSwing(civ, d.annal, x.polity) : { got: 0, lost: 0 };
      const swing = got && lost ? `，得${cnNumber(got)}州、割${cnNumber(lost)}州` : got ? `，得${cnNumber(got)}州` : lost ? `，割${cnNumber(lost)}州` : '';
      return east ? `奉命出使${foeName}议和${swing}` : `出使${foeName}议和${swing}`;
    }
    case 'war':
      return east ? `力主伐${foeName}` : `力主对${foeName}开战`;
    case 'defend':
      return east ? `${foeName}来攻，督运粮草` : `${foeName}来犯，筹措军需`;
  }
}

/** 一句为什么有名(人物页一行、名人的"事迹"):最要紧的两件事;没经手大事的写"居相位 N 年" */
export function deedLine(civ: Civ, x: Person): string {
  const p = civ.polities[x.polity];
  if (!p) return '';
  const east = !!p.eastern && p.lineage !== 'khanate';
  const order: PersonDeed['kind'][] = ['found', 'rank', 'enthrone', 'regent', 'peace', 'capital', 'relief', 'war', 'defend'];
  const ds = [...(x.deeds ?? [])].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.year - b.year).slice(0, 2);
  if (ds.length) return ds.map((d) => deedText(civ, x, d, east)).join('；');
  const top = topPost(x);
  const until = x.until ?? civ.endYear;
  if (!top) return '';
  const n = F(until) - F(top.from);
  return n >= 1 ? `任${top.title} ${n} 年` : `任${top.title}`;
}

/** 生平(名臣、将领;别的身份 = '') */
export function personBio(civ: Civ, x: Person): string {
  if (x.role === 'minister') return ministerBio(civ, x);
  if (x.role === 'general') return generalBio(civ, x);
  return '';
}

/** 开头:"柳玄，字子昭，号揽霞居士，揽霞城人。" / "阿尔德里克，生于索伦纳。" */
function opening(civ: Civ, x: Person, east: boolean): string {
  const city = cityOf(civ, x.home);
  if (!east) return city ? `${x.name}，生于${city}。` : `${x.name}。`;
  const parts = [x.name];
  if (x.courtesy) parts.push(`字${x.courtesy}`);
  const art = personArt(civ, x);
  if (art) parts.push(`号${art}`);
  if (city) parts.push(`${city}人`);
  return parts.join('，') + '。';
}

/** 结局(名臣) */
function ministerEnd(civ: Civ, x: Person, east: boolean): string {
  const p = civ.polities[x.polity];
  const until = x.until;
  const age = x.died !== undefined ? ageAt(x, x.died) : 0;
  const died = x.died !== undefined ? (east ? `${F(x.died)} 年卒，享年 ${age} 岁` : `${F(x.died)} 年去世，享年 ${age} 岁`) : '';
  if (until === undefined) return east ? '至今在朝' : '至今在任';
  const top = topPost(x)?.title ?? '';
  // 一朝终了:亡国 / 并入 / 改朝换代
  const fallen = p.ended !== undefined && until === p.ended;
  const oldName = polityName(p, until - 1 / 512);
  const conqueror = fallen ? civ.annals.find((a) => a.kind === 'fall' && a.a === p.id)?.b : undefined;
  const merger = fallen ? civ.annals.find((a) => a.kind === 'merge' && a.b === p.id)?.a : undefined;
  const after = (s: string) => (died && x.died! > until + 1 ? `${s}，${died}` : s);
  switch (x.fate) {
    case 'died':
      return east ? `${F(until)} 年卒于任上，享年 ${age} 岁` : `${F(until)} 年在任上去世，享年 ${age} 岁`;
    case 'retired':
      return after(east ? `${F(until)} 年致仕` : `${F(until)} 年卸任`);
    case 'deposed':
      return after(east ? `${F(until)} 年新君即位，罢${top}` : `${F(until)} 年新君即位后被免去${top}之职`);
    case 'fell':
      return east ? `${F(until)} 年${oldName}亡，殉国` : `${F(until)} 年${oldName}覆灭，随之殉国`;
    case 'surrendered': {
      if (fallen && conqueror !== undefined && conqueror >= 0) {
        const c = polityName(civ.polities[conqueror], until);
        return after(east ? `${F(until)} 年${oldName}亡，降${c}` : `${F(until)} 年${oldName}覆灭，归降${c}`);
      }
      return after(east ? `${F(until)} 年改朝换代，归顺新朝` : `${F(until)} 年王朝更替，效忠新王室`);
    }
    case 'fled':
      return after(east ? `${F(until)} 年${fallen ? oldName + '亡' : '改朝换代'}，归隐不仕` : `${F(until)} 年${fallen ? oldName + '覆灭' : '王朝更替'}，从此隐居`);
    case 'merged': {
      const m = merger !== undefined && merger >= 0 ? polityName(civ.polities[merger], until) : '';
      return after(east ? `${F(until)} 年${oldName}并入${m}，随之归附` : `${F(until)} 年${oldName}并入${m}`);
    }
    default:
      return after(east ? `${F(until)} 年去职` : `${F(until)} 年离任`);
  }
}

/** 名臣的生平 */
function ministerBio(civ: Civ, x: Person): string {
  const p = civ.polities[x.polity];
  if (!p) return '';
  const east = !!p.eastern && p.lineage !== 'khanate';
  const republic = p.lineage === 'republic';
  const posts = x.posts ?? [];
  const deeds = x.deeds ?? [];
  // 官和事按年份排在一起;佐命那件事已经写了拜什么官,那一任不另写
  type Item = { year: Year; text: string };
  const items: Item[] = [];
  const found = deeds.find((d) => d.kind === 'found');
  const foundTop = found ? postAt(x, found.year) : undefined;
  posts.forEach((post, k) => {
    if (post === foundTop) return;
    let t: string;
    if (k === 0) t = republic ? `当选${post.title}` : east ? `入仕，授${post.title}` : `入宫任${post.title}`;
    else if (k === posts.length - 1) t = republic ? `当选${post.title}` : east ? (/相|丞相|宰相/.test(post.title) ? `拜${post.title}` : `升${post.title}`) : `升任${post.title}`;
    else t = republic ? `当选${post.title}` : east ? `迁${post.title}` : `改任${post.title}`;
    items.push({ year: post.from, text: t });
  });
  for (const d of deeds) items.push({ year: d.year, text: deedText(civ, x, d, east) });
  items.sort((a, b) => a.year - b.year);
  // 同一年的几件并成一句
  const sentences: string[] = [];
  for (let i = 0; i < items.length; ) {
    const y = F(items[i].year);
    const same: string[] = [];
    while (i < items.length && F(items[i].year) === y) same.push(items[i++].text);
    sentences.push(`${y} 年${same.join('，')}`);
  }
  if (!deeds.length) {
    const top = topPost(x);
    const until = x.until ?? civ.endYear;
    if (top && until - top.from >= 10) sentences.push(east ? `居${top.title}之位 ${F(until) - F(top.from)} 年，${shortName(p, top.from)}中无大事` : `任${top.title} ${F(until) - F(top.from)} 年，国中太平`);
  }
  sentences.push(ministerEnd(civ, x, east));
  return opening(civ, x, east) + sentences.join('。') + '。';
}

/** 将领的生平:从军、伐谁抗谁、攻下几州守住几次、一路升到什么官、结局 */
function generalBio(civ: Civ, x: Person): string {
  const p = civ.polities[x.polity];
  if (!p) return '';
  const east = !!p.eastern && p.lineage !== 'khanate';
  const posts = x.posts ?? [];
  const cs = x.commands ?? [];
  if (!cs.length) return opening(civ, x, east);
  const out: string[] = [];
  const first = posts[0];
  out.push(east ? `${F(cs[0].from)} 年以${first?.title ?? '将'}领兵` : `${F(cs[0].from)} 年以${first?.title ?? '将领'}身份领兵`);
  const foes = commandFoes(civ, x);
  if (foes.length) out[out.length - 1] += east ? `，${foes.map((f) => `${f.verb}${polityName(civ.polities[f.polity], f.from)}`).join('、')}` : `，${foes.map((f) => `${f.verb === '伐' ? '出征' : '抵御'}${polityName(civ.polities[f.polity], f.from)}`).join('、')}`;
  const { took, held } = generalTally(civ, x);
  const deeds = [took ? `攻取${cnNumber(took)}州` : '', held ? `击退来攻${cnNumber(held)}次` : ''].filter(Boolean).join('，');
  if (deeds) out.push(took + held >= 3 ? (east ? `前后${deeds}` : `先后${deeds}`) : deeds);
  for (let k = 1; k < posts.length; k++) out.push(east ? `${F(posts[k].from)} 年升${posts[k].title}` : `${F(posts[k].from)} 年升任${posts[k].title}`);
  const last = cs[cs.length - 1].until;
  const age = x.died !== undefined ? ageAt(x, x.died) : 0;
  if (x.fate === 'battle' && x.died !== undefined) out.push(east ? `${F(x.died)} 年战死，时年 ${age} 岁` : `${F(x.died)} 年阵亡，时年 ${age} 岁`);
  else if (x.died !== undefined) out.push(x.died - last >= 1 ? (east ? `后卸甲归乡，${F(x.died)} 年卒，享年 ${age} 岁` : `后解甲归乡，${F(x.died)} 年去世，享年 ${age} 岁`) : east ? `${F(x.died)} 年卒于军中` : `${F(x.died)} 年死于军中`);
  return opening(civ, x, east) + out.join('。') + '。';
}
