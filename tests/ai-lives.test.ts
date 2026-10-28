/**
 * AI 写列传、家传:材料组装(src/ai/prompts/lives.ts + 界面层的人物卡 src/ui/lifeSource.ts)只用世界里的真事实,
 * 和写史书同一套的后台写作、"克制"重写、没设置 AI、写过了直接打开(src/ui/bookStore.ts)。用假 AI,不联网。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { applyNames, personKey } from '../src/gen/edits';
import { personName } from '../src/gen/civ/peopleText';
import { peopleIndex } from '../src/gen/civ/peopleInfo';
import { dynastyLines, dynastyMembers, dynastyRows } from '../src/gen/civ/lineageInfo';
import { reignRecord } from '../src/gen/civ/reignRecord';
import type { AuthorCharacter } from '../src/gen/characters';
import type { Civ, Person } from '../src/gen/civ/types';
import { setActiveProvider, setMockResponder } from '../src/ai/client';
import { AiError } from '../src/ai/types';
import { battleLines, historyMessages, restrainedLine } from '../src/ai/prompts/history';
import {
  HOUSE_LENGTH,
  LIFE_LENGTH,
  bookLoadScope,
  bookNoteKey,
  bookPrompts,
  bookStoreScope,
  buildLifePrompts,
  houseName,
  lifeOptionLabel,
  lifeTitle,
  type LifeOptions,
  type LifeScope,
} from '../src/ai/prompts/lives';
import { bookHowText, historyNoteStatus, listHistoryNotes } from '../src/ai/history';
import { characterCard, lifeSource } from '../src/ui/lifeSource';
import { personCard } from '../src/ui/PersonPanel';
import { eventKey } from '../src/ui/characterInfo';
import { _resetBook, getBook, lifeNoteKey, openHistoryBook, setBookContext, startBook, writeLife } from '../src/ui/bookStore';
import { _resetToasts, getToast } from '../src/ui/toastStore';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const civ = generateCiv(world);
const src = lifeSource(civ, world, null);
const END = Math.floor(civ.endYear);
const Y = Math.floor;

/** 发给 AI 的用户消息(写作要求 + 材料) */
const userOf = (o: LifeOptions, s = src) => historyMessages(buildLifePrompts(civ, o, s), 0)[1].content;
const materialOf = (o: LifeOptions, s = src) => buildLifePrompts(civ, o, s).calls[0].body;

/** 领兵打仗最多、在位时事情最多的君主(列传的主角) */
const rulers = (civ.people ?? []).filter((x) => x.role === 'ruler' && x.name && civ.polities[x.polity]);
const hero = rulers
  .filter((x) => (x.commands?.length ?? 0) > 0 && x.died !== undefined)
  .sort((a, b) => battleLines(civ, b).length - battleLines(civ, a).length || a.id - b.id)[0];
const HERO: LifeOptions = { scope: { kind: 'person', person: hero.id }, style: 'classic', length: LIFE_LENGTH };

/** 世系里事最多的一朝(争储、掌权、联姻、放逐) */
function busiestHouse(): { polity: number; dynasty: number } {
  let best = { polity: -1, dynasty: -1, n: -1 };
  for (const p of civ.polities) {
    if (!p.eastern) continue;
    for (const row of dynastyRows(civ, p.id)) {
      const n = dynastyMembers(civ, row).reduce((t, x) => t + (x.claim ? 1 : 0) + (x.regencies?.length ?? 0) + (x.spouses?.length ?? 0) + (x.exile ? 1 : 0), 0);
      if (n > best.n) best = { polity: p.id, dynasty: row.index, n };
    }
  }
  return best;
}
const house = busiestHouse();
const HOUSE: LifeOptions = { scope: { kind: 'house', polity: house.polity, dynasty: house.dynasty }, style: 'classic', length: HOUSE_LENGTH };

describe('列传:推演里的人', () => {
  if (process.env.PRINT_LIFE) {
    it('打印材料', () => {
      console.log(userOf(HERO));
      console.log(userOf(HOUSE));
    });
  }

  it('书名、选项上的字、篇幅的说法', () => {
    const n = personName(civ, hero);
    expect(lifeTitle(civ, HERO.scope, src)).toBe(`${n}传`);
    expect(lifeOptionLabel(civ, HERO.scope, src)).toBe(`${n}列传`);
    expect(bookHowText(HERO.scope, 'classic', LIFE_LENGTH)).toBe('列传，史书体，约 2000 字');
    expect(bookHowText(HOUSE.scope, 'plain', HOUSE_LENGTH, ' · ')).toBe('家传 · 白话讲述 · 约 3000 字');
    const p = buildLifePrompts(civ, HERO, src);
    expect(p.empty).toBe(false);
    expect(p.calls).toHaveLength(1);
    expect(p.title).toBe(`${n}传`);
    expect(p.range).toBe(`第 ${Y(hero.born)}—${Y(hero.died!)} 年`);
    expect(p.chars).toBeLessThanOrEqual(2000);
  });

  it('材料 = 人物卡上的每一行 + 领兵的每一仗(谁攻谁守、结果)+ 在位时本国的事 + 写到的人的生卒', () => {
    const body = materialOf(HERO);
    const card = personCard(civ, hero);
    // 卡片上的每一行原样在
    expect(card.lines.length).toBeGreaterThan(4);
    for (const l of card.lines) expect(body).toContain(`- ${l.k}:${l.text}`);
    expect(body).toContain(`- 生卒:${Y(hero.born)}–${Y(hero.died!)} 年`);
    // 每一仗写清攻方、守方、结果(和写史书的列传材料同一个算法)
    const bs = battleLines(civ, hero);
    expect(bs.length).toBeGreaterThan(0);
    for (const b of bs.slice(0, 16)) {
      expect(body).toContain(`- ${b}`);
      expect(b).toMatch(/攻.*守.*→/);
    }
    // 本国的事:只挑卡片「在位时」「掌权时」「联姻」里有的那几条,年份在他在位那几年里(即位前掌权的那几条在他生前)
    const lines = body.split('\n');
    const at = lines.findIndex((l) => l.startsWith('〔在位时本国的事〕'));
    expect(at).toBeGreaterThan(0);
    const texts = new Set(card.events.map((e) => e.text));
    const held = (hero.regencies ?? []).map((g) => Y(g.from));
    let k = at + 1;
    for (; k < lines.length && lines[k].startsWith('- '); k++) {
      const m = /^- ★?第 (\d+)(?:—(\d+))? 年 (.*)$/.exec(lines[k]);
      expect(m, lines[k]).not.toBeNull();
      expect(texts.has(m![3])).toBe(true);
      expect(Number(m![1])).toBeGreaterThanOrEqual(Math.min(Y(hero.from!), ...held));
      expect(Number(m![1])).toBeLessThanOrEqual(Y(hero.until ?? END));
    }
    expect(k - at - 1).toBeGreaterThan(0);
    // 〔人物〕:每个人的生卒年和推演里一致
    const ppl = lines.slice(lines.indexOf('〔人物〕(材料里写到的人:生卒年、在位年份照这里写)') + 1).filter((l) => l.startsWith('- '));
    expect(ppl.length).toBeGreaterThan(0);
    // (西幻的名字会重名:按名字 + 生年找)
    for (const l of ppl) {
      const m = /^- (.+?)\((.+?)\):生于第 (\d+) 年,(?:卒于第 (\d+) 年|到第 (\d+) 年还在世)/.exec(l)!;
      expect(m, l).not.toBeNull();
      const x = (civ.people ?? []).find((p: Person) => personName(civ, p) === m[1] && Y(p.born) === Number(m[3]))!;
      expect(x, l).toBeTruthy();
      if (m[4]) expect(Number(m[4])).toBe(Y(x.died!));
      else expect(x.died).toBeUndefined();
      expect(x.id).not.toBe(hero.id);
    }
    // 治绩:人物卡上那一段,一行一项照搬(在位不满 3 年的是一句话)
    const rec = reignRecord(civ, hero)!;
    expect(rec).toBeTruthy();
    expect(body).toContain('〔治绩〕');
    if (rec.short !== null) expect(body).toContain(rec.short);
    else for (const r of rec.rows) expect(body).toContain(`- ${r.k}:${r.lines.join(';')}`);
    // 父亲、前任、继任这几位一定在
    const prev = peopleIndex(civ).rulers[hero.polity][peopleIndex(civ).rulers[hero.polity].indexOf(hero) - 1];
    if (prev?.name) expect(ppl.some((l) => l.startsWith(`- ${personName(civ, prev)}(`))).toBe(true);
    expect(body).not.toMatch(/undefined|NaN|\[object/);
  });

  it('写作要求:照卡片写、不改攻守胜负、只写在生卒年之间;系统提示改成写人物传记、不写传名、不分章', () => {
    const p = buildLifePrompts(civ, HERO, src);
    const user = userOf(HERO);
    expect(user.startsWith(`请给${personName(civ, hero)}写一篇列传`)).toBe(true);
    expect(user).toContain(`一生的事只写在第 ${Y(hero.born)}—${Y(hero.died!)} 年之间`);
    expect(user).toContain('谁攻谁守、胜负');
    expect(user).toContain('- 文体:史书体。');
    expect(user).toContain('- 体例:一篇到底,不分章、不加小标题');
    expect(p.system).toContain('撰写人物传记');
    expect(p.system).toContain('不写传名(标题另有)');
    expect(p.system).not.toContain('不写全书的书名');
    // 白话、传说换文体那一条,材料不变
    const plain = userOf({ ...HERO, style: 'plain' });
    expect(plain).toContain('- 文体:白话讲述。用现代汉语');
    expect(materialOf({ ...HERO, style: 'legend' })).toBe(materialOf(HERO));
  });

  it('被内容审核拦下重写时,"克制"那一条说"这一篇"', () => {
    const p = buildLifePrompts(civ, HERO, src);
    const again = historyMessages(p, 0, '', true)[1].content;
    expect(again).toContain(restrainedLine('篇'));
    expect(again.indexOf(restrainedLine('篇'))).toBeLessThan(again.indexOf('〔材料〕'));
  });

  it('事少的人(没领过兵、没什么事的宗室)篇幅封顶,不让 AI 硬凑两千字', () => {
    const thin = (civ.people ?? []).find((x) => x.role === 'prince' && !x.commands?.length && !x.regencies?.length && !x.exile && x.name && civ.polities[x.polity])!;
    expect(thin).toBeTruthy();
    const p = buildLifePrompts(civ, { scope: { kind: 'person', person: thin.id }, style: 'classic', length: LIFE_LENGTH }, src);
    expect(p.empty).toBe(false);
    expect(p.chars).toBeGreaterThanOrEqual(800);
    expect(p.chars).toBeLessThan(2000);
    expect(p.calls[0].head).toContain(`约 ${p.chars} 字`);
  });

  it('没有人物卡来源 / 找不到人 = empty(不调 AI)', () => {
    expect(buildLifePrompts(civ, HERO, null).empty).toBe(true);
    expect(buildLifePrompts(civ, { ...HERO, scope: { kind: 'person', person: 99999999 } }, src).empty).toBe(true);
  });

  it('存档里按稳定键记;改名以后找得回、指纹变了(写于历史改变之前)', () => {
    const s = bookStoreScope(civ, HERO.scope, src);
    expect(s).toMatchObject({ kind: 'person', key: personKey(civ, hero.id) });
    expect(bookLoadScope(civ, s, src)).toEqual(HERO.scope);
    expect(bookNoteKey(s, 'classic', LIFE_LENGTH)).toBe(`史书:person:${personKey(civ, hero.id)}:classic:medium`);
    const renamed = applyNames(civ, { [personKey(civ, hero.id)]: '某某' });
    expect(bookLoadScope(renamed, s, lifeSource(renamed, world, null))).toEqual(HERO.scope);
    const fp = bookPrompts(civ, HERO, src).fingerprint;
    expect(bookPrompts(renamed, HERO, lifeSource(renamed, world, null)).fingerprint).not.toBe(fp);
    expect(bookPrompts(civ, HERO, lifeSource(civ, world, null)).fingerprint).toBe(fp);
  });
});

describe('家传:王室的一朝', () => {
  it('书名:东方中式"某朝某氏家传"', () => {
    expect(house.polity).toBeGreaterThanOrEqual(0);
    const t = lifeTitle(civ, HOUSE.scope, src);
    expect(t).toBe(`${houseName(civ, house.polity, house.dynasty)}家传`);
    expect(t).toMatch(/^.+朝(.{1,2}氏|王室)家传$/);
    expect(lifeOptionLabel(civ, HOUSE.scope, src)).toBe(t);
  });

  it('材料 = 世系 + 每位君主怎么即位、争储、掌权、联姻、放逐、结局 + 这一朝一家人的事', () => {
    const body = materialOf(HOUSE);
    const rows = dynastyRows(civ, house.polity);
    const i = rows.findIndex((r) => r.index === house.dynasty);
    const row = rows[i];
    // 世系图那一段原样(标题行除外)
    for (const l of dynastyLines(civ, house.polity, rows, i).slice(1)) expect(body).toContain(l);
    // 每位君主一行:第几位、卡片上的生卒、在位、结局
    row.rulers.forEach((x, k) => {
      const line = body.split('\n').find((l) => l.startsWith(`- 第 ${k + 1} 位 ${personName(civ, x)}`));
      expect(line, personName(civ, x)).toBeTruthy();
      const card = personCard(civ, x);
      for (const l of card.lines.filter((l) => ['生卒', '在位', '争储', '掌权', '配偶', '结局'].includes(l.k))) expect(line).toContain(`${l.k}:${l.text}`);
    });
    // 家事:继位、掌权、联姻、放逐,年份都在这一朝里
    const lines = body.split('\n');
    const at = lines.findIndex((l) => l.startsWith('〔这一朝一家人的事〕'));
    expect(at).toBeGreaterThan(0);
    const ev = lines.slice(at + 1).filter((l) => l.startsWith('- '));
    expect(ev.length).toBeGreaterThan(5);
    const to = Y(row.to ?? civ.endYear);
    for (const l of ev) {
      const y = Number(/第 (\d+)/.exec(l)![1]);
      expect(y).toBeGreaterThanOrEqual(Y(row.from));
      expect(y).toBeLessThanOrEqual(to);
    }
    expect(body).not.toMatch(/undefined|NaN|\[object/);
  });

  it('写作要求:写一家人、和国史本纪错开,世系不能改;约 3000 字', () => {
    const user = userOf(HOUSE);
    expect(user).toContain('写一家人,不写一国的兴衰(那是国史的本纪)');
    expect(user).toContain('争储');
    expect(user).toContain('联姻');
    expect(user).toContain('摄政');
    expect(user).toContain('出奔');
    expect(user).toContain('世系照〔世系〕〔君主〕写');
    const p = buildLifePrompts(civ, HOUSE, src);
    expect(p.chars).toBeLessThanOrEqual(3000);
    expect(p.chars).toBeGreaterThanOrEqual(1000);
  });

  it('存档按国家的稳定键 + 第几朝记,找得回;没有的一朝 = null', () => {
    const s = bookStoreScope(civ, HOUSE.scope, src);
    expect(s.kind).toBe('house');
    expect(bookLoadScope(civ, s, src)).toEqual(HOUSE.scope);
    expect(bookLoadScope(civ, { ...s, dynasty: 999 } as typeof s, src)).toBeNull();
  });
});

describe('列传:作者的人物', () => {
  // 借主角在位时的一件事、主角本人
  const evs = personCard(civ, hero).events.filter((e) => e.kind !== 'reign' && eventKey(civ, e));
  const picked = evs[0];
  const c: AuthorCharacter = {
    id: 7,
    name: '沈青禾',
    color: 'red',
    born: Y(hero.from!) - 10,
    died: Y(hero.from!) + 40,
    role: '女史',
    note: '出身书香，通晓典故。\n入宫掌记事。',
    life: [
      { year: Y(picked.year), text: '随驾记事', events: [eventKey(civ, picked)], people: [personKey(civ, hero.id)] },
      { year: Y(hero.from!) + 30, text: '告老还乡' },
    ],
    kin: [{ rel: '主君', person: personKey(civ, hero.id) }],
  };
  const card = characterCard(civ, world, null, c, [c]);
  const csrc = { person: src.person, character: (id: number) => (id === 7 ? card : null) };
  const O: LifeOptions = { scope: { kind: 'character', char: 7 }, style: 'classic', length: LIFE_LENGTH };

  it('作者写的原样进材料(简介、身份、亲友、每段经历),勾上的事和人照推演写', () => {
    expect(card.kin).toEqual([{ rel: '主君', name: personName(civ, hero), person: hero.id }]);
    expect(card.life[0].events).toEqual([picked]);
    expect(card.life[0].people).toEqual([hero.id]);
    const body = materialOf(O, csrc);
    expect(body).toContain('- 名字:沈青禾');
    expect(body).toContain(`- 生卒:生于第 ${c.born} 年,卒于第 ${c.died} 年`);
    expect(body).toContain('- 身份:女史');
    expect(body).toContain('出身书香，通晓典故。\n入宫掌记事。');
    expect(body).toContain(`- ${personName(civ, hero)}(主君)`);
    expect(body).toContain(`:随驾记事`);
    expect(body).toContain(`:告老还乡`);
    expect(body).toContain(`  - 推演里的事:第 ${Y(picked.year)}`);
    expect(body).toContain(picked.text);
    expect(body).toContain(`- ${personName(civ, hero)}(`);
    expect(body).toContain(`生于第 ${Y(hero.born)} 年,卒于第 ${Y(hero.died!)} 年`);
    const user = userOf(O, csrc);
    expect(user).toContain('作者写的不许改');
    expect(user).toContain('不要替他添');
    expect(lifeTitle(civ, O.scope, csrc)).toBe('沈青禾传');
    expect(lifeOptionLabel(civ, O.scope, csrc)).toBe('沈青禾列传');
  });

  it('作者删了这个人物:找不到(重写不了);编号分给了新人物(生年不同)也不算同一个人', () => {
    const s = bookStoreScope(civ, O.scope, csrc);
    expect(s).toEqual({ kind: 'character', id: 7, born: c.born, name: '沈青禾' });
    expect(bookLoadScope(civ, s, csrc)).toEqual(O.scope);
    expect(bookLoadScope(civ, s, src)).toBeNull();
    const other = { ...c, name: '林晚', born: c.born + 5 };
    const osrc = { person: src.person, character: (id: number) => (id === 7 ? characterCard(civ, world, null, other, [other]) : null) };
    expect(bookLoadScope(civ, s, osrc)).toBeNull();
  });
});

describe('列传、家传:和写史书同一套的后台写作', () => {
  afterEach(() => {
    _resetBook();
    _resetToasts();
    setMockResponder(null);
    setActiveProvider(null);
  });

  async function settle(ms = 5000) {
    const t0 = Date.now();
    while (getBook().job?.status === 'writing') {
      if (Date.now() - t0 > ms) throw new Error('写太久了');
      await new Promise((r) => setTimeout(r, 5));
    }
    return getBook().job!;
  }

  it('写列传:窗口默认这一篇,写完存进已写的(和史书在一起),人物卡上"已写",再点直接打开', async () => {
    setActiveProvider('mock');
    const w = 'w-life-1';
    setBookContext(civ, w, src);
    writeLife(HERO.scope as LifeScope);
    expect(getBook().dialog).toMatchObject({ open: true, life: HERO.scope });
    expect(startBook(HERO)).toBe(true);
    const j = await settle();
    expect(j.status).toBe('done');
    expect(j.title).toBe(`${personName(civ, hero)}传`);
    const notes = listHistoryNotes(w);
    expect(notes).toHaveLength(1);
    expect(notes[0].book.scope).toMatchObject({ kind: 'person', key: personKey(civ, hero.id) });
    expect(historyNoteStatus(civ, notes[0], src)).toEqual({ scope: HERO.scope, stale: false });
    // 写史书的上次选的不动;列传记自己的文体
    expect(getBook().prefs).toEqual({ style: 'biography', length: 'k10' });
    expect(getBook().lifeStyle).toBe('classic');
    expect(lifeNoteKey(civ, w, HERO.scope as LifeScope)).toBe(notes[0].key);
    writeLife(HERO.scope as LifeScope, notes[0].key);
    expect(getBook().reader).toMatchObject({ open: true, key: notes[0].key });
  });

  it('没设置 AI:提示条"还没有设置 AI · 去设置",不开窗口;设置好再打开「成书」,还是这一篇', () => {
    setBookContext(civ, 'w-life-2', src);
    writeLife(HOUSE.scope as LifeScope);
    expect(getBook().dialog.open).toBe(false);
    const t = getToast();
    expect(t?.text).toBe('还没有设置 AI');
    expect(t?.action?.label).toBe('去设置');
    expect(getBook().pending).toEqual({ scope: HOUSE.scope, style: 'classic', length: HOUSE_LENGTH });
    openHistoryBook();
    expect(getBook().dialog.open).toBe(true);
  });

  it('被内容审核拦下:自动带"克制"重写一次;还被拦,提示条写《某某传》没写完 + 已自动换写法重写过 + 重试', async () => {
    setActiveProvider('mock');
    setBookContext(civ, 'w-life-3', src);
    const sent: boolean[] = [];
    setMockResponder((req) => {
      sent.push(req.messages[1].content.includes(restrainedLine('篇')));
      throw new AiError('content-filter', '阿里云的内容安全审核拦下了 AI 写出来的内容');
    });
    startBook(HOUSE);
    const j = await settle();
    expect(j.status).toBe('error');
    expect(sent).toEqual([false, true]);
    const t = getToast();
    expect(t?.text).toBe(`《${houseName(civ, house.polity, house.dynasty)}家传》没写完`);
    expect(t?.more?.[0]).toBe('内容被 AI 服务商的审核拦下了（已自动换成更克制的写法重写过一次），可以重试或换个文体');
    expect(t?.action?.label).toBe('重试');
    expect(listHistoryNotes('w-life-3')).toHaveLength(0);
  });
});
