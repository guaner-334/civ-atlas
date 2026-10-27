/**
 * AI 写史书(阶段 5):材料整理(src/ai/prompts/history.ts)+ 用假 AI 跑完整流程(src/ai/history.ts)。不联网。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { buildChronicle, entryInvolves, entryYearLabel, filterChronicle } from '../src/gen/civ/chronicle';
import { polityAlive, polityName } from '../src/gen/civ/growth';
import { applyNames, polityKey, settlementKey } from '../src/gen/edits';
import { NAME_STYLES } from '../src/gen/names';
import { styleGuide } from '../src/ai/prompts/names';
import type { Civ } from '../src/gen/civ/types';
import { recentCallsInMemory, setActiveProvider, setMockResponder } from '../src/ai/client';
import {
  HISTORY_LENGTHS,
  NAME_FLAVOR,
  SERVE_AGE,
  SYSTEM_PROMPT,
  battleLines,
  buildHistoryPrompts,
  charCap,
  usedPhrases,
  estimateTokens,
  PREV_CONTEXT,
  historyFingerprint,
  historyMessages,
  historyNoteKey,
  restrainedLine,
  loadScope,
  storeScope,
  type HistoryLength,
  type HistoryOptions,
  type HistoryScope,
} from '../src/ai/prompts/history';
import { HISTORY_KIND, historyFileName, historyMarkdown, historyNoteStatus, listHistoryNotes, writeHistory, type WrittenCall } from '../src/ai/history';
import { AiError } from '../src/ai/types';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const civ = generateCiv(world);
/** 改朝换代最多的东方国家(国史用它测分章、历朝) */
// 中原、江南一类的国号(边塞风的国名常和民族同名,改了国名,写民族的地方照旧)
const east = civ.polities.filter((p) => p.eastern && civ.cultures[p.culture].style !== 'frontier').sort((a, b) => (b.dynasties?.length ?? 0) - (a.dynasties?.length ?? 0))[0];
const LENGTHS: HistoryLength[] = ['short', 'medium', 'long'];
const userOf = (civ: Civ, o: HistoryOptions, i = 0) => historyMessages(buildHistoryPrompts(civ, o), i)[1].content;

/** 发给 AI 的文字里不该出现的现实语言 / 民族名(系统提示里的"阿拉伯数字"不算,所以只查材料) */
const REAL_LANG = /拉丁风|拉丁语|英法|英语|法语|古诺尔斯|北欧|斯拉夫风|斯拉夫语|古斯拉夫|希腊|阿拉伯|波斯|突厥|蒙古|罗马|维京|东欧|爱琴/;

describe('AI 写史书:材料', () => {
  it('材料里写民族 / 国家的语感,用不带现实语言 / 民族名的说法', () => {
    const p = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'classic', length: 'long' });
    const all = p.calls.map((_, i) => userOf(civ, { scope: { kind: 'world' }, style: 'classic', length: 'long' }, i)).join('\n');
    expect(all).toMatch(/西幻语感\([^)]+风\)|西幻式·[^·\n]+\([^)]+风\)/);
    // 只查语感的说法(民族那一节的"西幻语感(…)"、国家那一节括号里的风格提示):材料里推演出来的人名、地名是音译的,
    // "兰波斯""波利波斯"这样的名字会碰上"波斯"
    const hints = [...all.matchAll(/(?:东方|西幻)语感\([^)]*\)|\((?:东方式|西幻式)·[^)\n]*\)/g)].map((m) => m[0]);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.join('\n')).not.toMatch(REAL_LANG);
  });

  it('世界通史(中篇):系统提示要求不改动事实;材料里有九成以上的大事、大国、民族、山河、年份范围', () => {
    const p = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'classic', length: 'medium' });
    expect(p.title).toBe('世界通史');
    expect(p.calls).toHaveLength(1);
    expect(p.empty).toBe(false);
    const msgs = historyMessages(p, 0);
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(SYSTEM_PROMPT).toMatch(/不得改动/);
    expect(SYSTEM_PROMPT).toMatch(/年份、国名/);
    expect(SYSTEM_PROMPT).toMatch(/胜负/);
    const user = msgs[1].content;
    expect(user).toMatch(/第 0—3000 年/);
    expect(user).toMatch(/史书体/);
    expect(user).toMatch(/约 2000 字/);
    // 大事放进去的都 ★ 标出;九成以上都在(GENERATOR_VERSION 43 战争节奏以后仗多了,seed 7 的大事从一百条涨到一百二十多条,
    // 中篇的材料放不下的有九条;以前一条不落)
    const majors = filterChronicle(buildChronicle(civ), { major: true });
    const inMed = majors.filter((e) => user.includes(`★${entryYearLabel(e)} ${e.text}`)).length;
    expect(inMed).toBeGreaterThanOrEqual(majors.length * 0.9);
    // 大国(极盛二十五州以上)写全:国号先后、国都、历朝 / 王室
    expect(user).toContain(`国号先后:`);
    expect(user).toContain(polityName(east, civ.endYear));
    expect(user).toMatch(/历朝:/);
    // 民族、地理
    for (const cu of civ.cultures.slice(0, 5)) expect(user).toContain(`${cu.name}族`);
    const bigSea = civ.places.filter((x) => x.kind === 'sea').sort((a, b) => a.rank - b.rank || (b.size ?? 0) - (a.size ?? 0))[0];
    expect(user).toContain(bigSea.name);
    // 分章:按时代分四章,材料里有四段
    expect(p.sections.length).toBe(4);
    expect(user.match(/^### 第.章 第 \d+—\d+ 年/gm)).toHaveLength(4);
  });

  it('按篇幅裁剪:每次调用的材料不超过这一档的上限;篇幅越短放进去的纪事越少,略去的条数写进材料', () => {
    for (const scope of [{ kind: 'world' }, { kind: 'polity', polity: east.id }, { kind: 'era', from: 1500, to: 2200 }] as HistoryScope[]) {
      const used: number[] = [];
      for (const length of LENGTHS) {
        const p = buildHistoryPrompts(civ, { scope, style: 'plain', length });
        const budget = HISTORY_LENGTHS[length].budget;
        for (const c of p.calls) {
          expect(c.body.length, `${scope.kind} ${length}`).toBeLessThanOrEqual(budget * 1.1);
          expect(c.maxTokens).toBeGreaterThan(0);
          if (c.used < c.total) expect(c.body).toMatch(/略去了/);
        }
        // 输入(含系统提示)按字数估算:一次调用不超过一万二千字(约七千 token),远在模型上下文之内
        for (let i = 0; i < p.calls.length; i++) expect(historyMessages(p, i, '字'.repeat(2000)).reduce((s, m) => s + m.content.length, 0)).toBeLessThan(12000);
        expect(p.inputTokens).toBeGreaterThan(0);
        used.push(p.calls.reduce((s, c) => s + c.used, 0));
      }
      expect(used[0]).toBeLessThanOrEqual(used[1]);
    }
    // 短篇的通史:先放大事;大事多到放不全时(seed 7 有七十多条)按时间均匀地挑,小事一条不放
    // (GENERATOR_VERSION 22 崩解、亡国多了,大事从五十多条涨到七十多条,短篇放不下的从两成以内涨到两成多;
    // 36 多了宗室据地自立,大事八十条上下,放不下的三成多;39 多了帝国的引兵入朝、权臣专权和篡位,大事九十多条,放不下的四成上下;
    // 43 战争节奏以后仗多了,大事一百二十多条,放不下的近六成)
    const short = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'plain', length: 'short' });
    const user = historyMessages(short, 0)[1].content;
    const all = buildChronicle(civ);
    const major = filterChronicle(all, { major: true });
    const missing = major.filter((e) => !user.includes(e.text)).length;
    expect(missing).toBeLessThanOrEqual(major.length * 0.62);
    if (missing) for (const e of all) if (e.importance === 2) expect(user).not.toContain(e.text);
    expect(short.calls[0].used).toBeLessThan(short.calls[0].total);
  });

  it('长篇分章多次调用:带全书目录;第二章起带上前文(整篇给,太长取末尾)', () => {
    const p = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'legend', length: 'long' });
    expect(p.calls.length).toBeGreaterThanOrEqual(3);
    expect(p.calls.map((c) => c.chapter)).toEqual(p.calls.map((_, i) => i));
    expect(p.calls.reduce((s, c) => s + c.chars, 0)).toBeGreaterThanOrEqual(4500);
    const first = historyMessages(p, 0, '')[1].content;
    expect(first).toMatch(/【全书目录】/);
    expect(first).toMatch(/这次写这一章/);
    expect(first).not.toMatch(/〔前文〕/);
    // 前文不长:整篇都带上(模型才看得见前面用过的人名、字号)
    const prev = '乙'.repeat(1000) + '上一章最后一句。';
    const second = historyMessages(p, 1, prev)[1].content;
    expect(second).toMatch(/〔前文〕/);
    expect(second).toContain('乙'.repeat(1000) + '上一章最后一句。');
    // 太长:只取最后 PREV_CONTEXT 字
    const long = historyMessages(p, 1, '甲'.repeat(PREV_CONTEXT + 500) + '末句。')[1].content;
    expect(long).toContain('末句。');
    expect(long).not.toContain('甲'.repeat(PREV_CONTEXT + 1));
    // 每章只放这一章的纪事
    expect(second).toContain(`〔编年史〕(本章:第二章 第 ${p.sections[1].from}—${p.sections[1].to} 年)`);
    const years = [...second.matchAll(/^- ★?第 (\d+)/gm)].map((m) => Number(m[1]));
    expect(years.length).toBeGreaterThan(0);
    for (const y of years) expect(y >= p.sections[1].from && y <= p.sections[1].to).toBe(true);
  });

  it('纪传体通史:本纪、世家的篇名用这段结束时的国号(和卡片上一样;亡了的用亡国前的)', () => {
    const p = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'biography', length: 'medium' });
    const parts = p.sections.filter((s) => s.part === 'annal' || s.part === 'house');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const s of parts) {
      const q = civ.polities[s.polity!];
      const last = q.ended !== undefined ? Math.max(q.founded, q.ended - 1 / 512) : civ.endYear;
      expect(s.name).toBe(polityName(q, Math.min(s.to, last)) || q.name);
    }
    // 种子 7 有国家后来改了国号:篇名是后来的
    expect(parts.some((s) => s.name !== (polityName(civ.polities[s.polity!], civ.polities[s.polity!].founded) || civ.polities[s.polity!].name))).toBe(true);
    expect(userOf(civ, { scope: { kind: 'world' }, style: 'biography', length: 'medium' })).toContain(`本纪·${parts.find((s) => s.part === 'annal')!.name}`);
  });

  it('国史:主角写全(国号先后、历任国都、历朝、疆域、四邻),东方国家按朝代分章;书名用国号', () => {
    const p = buildHistoryPrompts(civ, { scope: { kind: 'polity', polity: east.id }, style: 'classic', length: 'medium' });
    const user = historyMessages(p, 0)[1].content;
    expect(p.title).toMatch(/史$/);
    expect(user).toMatch(/一国的国史/);
    expect(user).toMatch(/国号先后:/);
    expect(user).toMatch(/国都:/);
    expect(user).toMatch(/历朝:/);
    expect(user).toMatch(/疆域:极盛约/);
    expect(user).toMatch(/四邻/);
    expect(east.dynasties!.length).toBeGreaterThanOrEqual(2);
    expect(p.sections.length).toBeGreaterThanOrEqual(2);
    expect(p.sections.length).toBeLessThanOrEqual(5);
    expect(p.sections.every((s) => !!s.reign)).toBe(true);
    expect(p.sections[0].from).toBe(Math.floor(east.founded));
    // 只放和它有关的纪事
    const others = buildChronicle(civ).filter((e) => !e.polities.includes(east.id) && !e.children?.some((c) => c.polities.includes(east.id)));
    expect(others.some((e) => user.includes(e.text))).toBe(false);
    // 史事少的小国:篇幅封顶,不硬凑五千字
    const tiny = civ.polities.find((q) => buildChronicle(civ).filter((e) => e.polities.includes(q.id)).length <= 2);
    expect(tiny).toBeDefined();
    if (!tiny) return;
    const t = buildHistoryPrompts(civ, { scope: { kind: 'polity', polity: tiny.id }, style: 'classic', length: 'long' });
    expect(t.chars).toBeLessThan(HISTORY_LENGTHS.long.chars);
    expect(t.calls).toHaveLength(1);
  });

  it('国史:主角的历代君主照推演写(名字、在位年份);分章时只列这一章在位的', () => {
    const rulers = civ.people!.filter((x) => x.role === 'ruler' && x.polity === east.id).sort((a, b) => a.from! - b.from!);
    expect(rulers.length).toBeGreaterThan(2);
    const user = userOf(civ, { scope: { kind: 'polity', polity: east.id }, style: 'classic', length: 'medium' });
    const line = user.split('\n').find((l) => l.includes('历代君主('))!;
    expect(line).toBeDefined();
    expect(line).toContain(`${rulers[0].name}(第 ${Math.floor(rulers[0].from!)}`);
    expect(line).toContain(rulers[rulers.length - 1].name);
    // 系统提示:材料里的人物照写
    expect(SYSTEM_PROMPT).toMatch(/材料里写到的人物.+照材料写/);
    // 长篇分章:第二章只列第二朝起在位的君主
    const p = buildHistoryPrompts(civ, { scope: { kind: 'polity', polity: east.id }, style: 'classic', length: 'long' });
    expect(p.sections.length).toBeGreaterThanOrEqual(2);
    const s = p.sections[1];
    const second = historyMessages(p, 1)[1].content.split('\n').find((l) => l.includes('历代君主('));
    const inside = rulers.filter((x) => x.from! <= s.to && (x.until ?? Infinity) > s.from);
    if (inside.length < 2) expect(second).toBeUndefined();
    else {
      expect(second).toContain(inside[0].name);
      expect(second).not.toContain(`${rulers[0].name}(`);
    }
  });

  it('一段时代:只放这段年份的纪事,写开始和结束时的格局;没有史事的年代 = empty', () => {
    const p = buildHistoryPrompts(civ, { scope: { kind: 'era', from: 1500, to: 2000 }, style: 'plain', length: 'short' });
    const user = historyMessages(p, 0)[1].content;
    expect(p.title).toBe('第 1500—2000 年史');
    expect(user).toMatch(/- 第 1500 年:/);
    expect(user).toMatch(/- 第 2000 年:/);
    const years = [...user.matchAll(/^- ★?第 (\d+)(?:—(\d+))? 年 /gm)].map((m) => [Number(m[1]), Number(m[2] ?? m[1])]);
    expect(years.length).toBeGreaterThan(3);
    for (const [a, b] of years) expect(b >= 1500 && a <= 2000).toBe(true);
    expect(buildHistoryPrompts(civ, { scope: { kind: 'era', from: 0, to: 200 }, style: 'plain', length: 'short' }).empty).toBe(true);
    // 起止写反了也认
    expect(buildHistoryPrompts(civ, { scope: { kind: 'era', from: 2000, to: 1500 }, style: 'plain', length: 'short' }).title).toBe('第 1500—2000 年史');
  });

  it('用户改过的名字照用(civ 已套上改名),历史指纹跟着变', () => {
    const cap = civ.settlements[east.capital];
    const renamed = applyNames(civ, { [polityKey(civ, east.id)]: '饕', [settlementKey(civ, cap.id)]: '饕餮城' });
    const o: HistoryOptions = { scope: { kind: 'polity', polity: east.id }, style: 'classic', length: 'medium' };
    const before = userOf(civ, o);
    const after = userOf(renamed, o);
    expect(before).not.toContain('饕餮城');
    expect(after).toContain('饕餮城');
    expect(after).toMatch(/饕部|饕国|大饕/);
    // 别的国家的国号里带着这个字的(分出去的"东漓部"一类)不算
    expect(after).not.toMatch(new RegExp(`(^|[^\\u4e00-\\u9fff])${east.name}部`));
    expect(historyFingerprint(renamed, o.scope)).not.toBe(historyFingerprint(civ, o.scope));
    expect(historyFingerprint(renamed, { kind: 'world' })).not.toBe(historyFingerprint(civ, { kind: 'world' }));
    // 同一份历史:指纹不变
    expect(historyFingerprint(generateCiv(world), o.scope)).toBe(historyFingerprint(civ, o.scope));
  });

  it('干预重推之后指纹变;只看这个范围:别国改名不影响这一国的国史', () => {
    const year = 2000;
    const big = civ.polities.filter((p) => polityAlive(p, year)).sort((a, b) => (b.titles?.at(-1)?.tier ?? 0) - (a.titles?.at(-1)?.tier ?? 0))[0];
    const resim = generateCiv(world, { interventions: [{ kind: 'halt', a: polityKey(civ, big.id), from: year }] });
    expect(historyFingerprint(resim, { kind: 'world' })).not.toBe(historyFingerprint(civ, { kind: 'world' }));
    // 和主角从没打过交道的国家改名:主角的国史指纹不变
    const mine = buildChronicle(civ).filter((e) => entryInvolves(e, east.id));
    const stranger = civ.polities.find((q) => q.id !== east.id && !mine.some((e) => entryInvolves(e, q.id)))!;
    expect(stranger).toBeDefined();
    const renamed = applyNames(civ, { [polityKey(civ, stranger.id)]: '饕' });
    expect(historyFingerprint(renamed, { kind: 'polity', polity: east.id })).toBe(historyFingerprint(civ, { kind: 'polity', polity: east.id }));
    expect(historyFingerprint(renamed, { kind: 'polity', polity: stranger.id })).not.toBe(historyFingerprint(civ, { kind: 'polity', polity: stranger.id }));
  });

  it('存档里记的"写什么":国家按稳定键记,换一份 civ 也找得到;笔记的键按范围 + 文体 + 篇幅', () => {
    const s = storeScope(civ, { kind: 'polity', polity: east.id });
    expect(s).toMatchObject({ kind: 'polity', key: polityKey(civ, east.id) });
    expect(loadScope(generateCiv(world), s)).toEqual({ kind: 'polity', polity: east.id });
    expect(loadScope(civ, { kind: 'polity', key: 'polity:c999999#0', name: 'x' })).toBeNull();
    expect(historyNoteKey(storeScope(civ, { kind: 'era', from: 900, to: 300 }), 'plain', 'short')).toBe('史书:era:300-900:plain:short');
    expect(historyNoteKey({ kind: 'world' }, 'classic', 'long')).toBe('史书:world:classic:long');
  });

  it('同一个 civ + 选项永远得到同样的提示词', () => {
    const o: HistoryOptions = { scope: { kind: 'world' }, style: 'classic', length: 'long' };
    const a = buildHistoryPrompts(civ, o);
    const b = buildHistoryPrompts(generateCiv(world), o);
    expect(b.calls.map((c) => c.head + c.body)).toEqual(a.calls.map((c) => c.head + c.body));
  });

  it('地名语感的说明和 gen/names 一致;字数估算', () => {
    // 材料里的语感名用 aiLabel(不带现实中的语言 / 民族名),界面上的 label 不变
    for (const s of NAME_STYLES) expect(NAME_FLAVOR[s.id]).toEqual({ family: s.family, label: styleGuide(s.id)!.aiLabel });
    expect(Object.keys(NAME_FLAVOR)).toHaveLength(NAME_STYLES.length);
    expect(estimateTokens('大昌享国三百年')).toBe(Math.ceil(7 * 0.85));
    expect(estimateTokens('abc')).toBe(1);
  });
});

describe('AI 写史书:列传的人物、开头和"史臣曰"、篇幅', () => {
  const civ2024 = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed: 2024 }));
  const BIO: HistoryOptions = { scope: { kind: 'world' }, style: 'biography', length: 'k10' };
  /** 列传那一次调用的写作要求和〔人物〕一节 */
  const livesOf = (c: Civ, o: HistoryOptions) => {
    const p = buildHistoryPrompts(c, o);
    const k = p.sections.findIndex((s) => s.part === 'lives');
    const body = p.calls[k].body;
    const at = body.indexOf('〔人物〕');
    return { head: p.calls[k].head, block: body.slice(at, body.indexOf('〔编年史〕', at)) };
  };
  const BATTLE = /:(.+?)(?:\((.+?)\))?攻,(.+?)(?:\((.+?)\))?守 → (.+?)(攻下|守住)/;

  it('列传的材料里列出统帅、名臣:每一仗都写明谁攻、谁守、结果,结果和攻守对得上', () => {
    for (const c of [civ, civ2024]) {
      const { head, block } = livesOf(c, BIO);
      expect(block).toMatch(/^〔人物〕/);
      expect(head).toContain('优先给〔人物〕里的人立传');
      expect(head).toContain('谁攻、谁守、谁胜都不能改');
      const battles = block.split('\n').filter((l) => l.startsWith('  - 第'));
      expect(battles.length).toBeGreaterThan(5);
      for (const l of battles) {
        const m = BATTLE.exec(l);
        expect(m, l).toBeTruthy();
        const [, atk, , def, , winner, how] = m!;
        expect(winner, l).toBe(how === '攻下' ? atk : def);
      }
    }
    // 一次写完的纪传体(短篇)也带上
    const short = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'biography', length: 'k3' });
    expect(short.calls[0].body).toContain('〔人物〕');
    // 别的文体不带
    expect(buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'annals', length: 'k10' }).calls.some((x) => x.body.includes('〔人物〕'))).toBe(false);
  });

  it('逐仗的攻守照推演:这位统帅守住的仗写在守方、守住,攻下的写在攻方、攻下', () => {
    let held = 0;
    let took = 0;
    for (const x of (civ.people ?? []).filter((p) => p.role === 'general' && p.commands?.length).slice(0, 60)) {
      const lines = battleLines(civ, x);
      for (const c of x.commands!) {
        for (let i = c.first; i <= c.last; i++) {
          const e = civ.annals[i];
          if (e.war !== c.war) continue;
          if (e.kind === 'battle' && e.b === x.polity) {
            expect(lines.some((l) => l.includes(`(${x.name})守`) && l.includes('守住')), x.name).toBe(true);
            held++;
          }
          if (e.kind === 'conquer' && e.a === x.polity) {
            expect(lines.some((l) => l.includes(`(${x.name})攻`) && l.includes('攻下')), x.name).toBe(true);
            took++;
          }
        }
      }
    }
    expect(held).toBeGreaterThan(0);
    expect(took).toBeGreaterThan(0);
  });

  it('生卒年:列的每个人生卒合理,写明哪年以后才能出仕;打的仗都在这之后、卒年之前', () => {
    for (const c of [civ, civ2024]) {
      const people = livesOf(c, BIO).block.split('\n- ').slice(1);
      expect(people.length).toBeGreaterThan(2);
      for (const p of people) {
        const [first, ...rest] = p.split('\n');
        const m = /生于第 (\d+) 年,(?:卒于第 (\d+) 年\((?:寿终|战死)\)|到第 (\d+) 年还在世);第 (\d+) 年以后才能出仕、领兵/.exec(first);
        expect(m, first).toBeTruthy();
        const born = +m![1];
        const died = +(m![2] ?? m![3]);
        expect(+m![4]).toBe(born + SERVE_AGE);
        expect(died - born, first).toBeGreaterThan(SERVE_AGE);
        expect(died - born, first).toBeLessThan(100);
        for (const l of rest) {
          const y = /第 (\d+)(?:—(\d+))? 年/.exec(l);
          if (!y) continue;
          expect(+y[1], l).toBeGreaterThanOrEqual(born + SERVE_AGE);
          expect(+(y[2] ?? y[1]), l).toBeLessThanOrEqual(died);
        }
      }
    }
  });

  it('分段的列传:人物只列这一段里打的仗,不把后面的事提前写', () => {
    const p = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'biography', length: 'k30' });
    const lives = p.sections.map((s, i) => ({ s, i })).filter(({ s }) => s.part === 'lives' && s.name);
    expect(lives.length).toBeGreaterThan(1);
    let n = 0;
    for (const { s, i } of lives) {
      const body = p.calls[i].body;
      const at = body.indexOf('〔人物〕');
      if (at < 0) continue;
      for (const l of body.slice(at, body.indexOf('〔编年史〕', at)).split('\n').filter((x) => x.startsWith('  - 第'))) {
        const y = /第 (\d+)(?:—(\d+))? 年/.exec(l)!;
        expect(+y[1], l).toBeGreaterThanOrEqual(Math.floor(s.from));
        expect(+(y[2] ?? y[1]), l).toBeLessThanOrEqual(s.to);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('第二篇起:写作要求后面列出前文用过的开头和"史臣曰",明说别再用;第一篇没有;列传的体例开头不算', () => {
    const p = buildHistoryPrompts(civ, BIO);
    const prev = [
      '## 本纪·甲国',
      '',
      '甲国之族,肇兴于北原,地多寒,民尚武。第 120 年,甲国立。',
      '',
      '史臣曰:甲国之兴,非恃甲兵之利,实赖民志之凝。',
      '',
      '## 世家·乙国',
      '乙族,肇兴于南泽。',
      '### 史臣曰',
      '',
      '乙国之存,非恃艨艟之坚,实赖契约之信。',
      '',
      '## 列传',
      '### 某甲传',
      '某甲,字子昭,凤州人也。',
      '**史臣曰**:某甲之死,国失其将。',
    ].join('\n');
    expect(historyMessages(p, 0)[1].content).not.toContain('〔前文用过的开头');
    const u = historyMessages(p, 1, prev)[1].content;
    expect(u).toContain('〔前文用过的开头和"史臣曰"〕');
    expect(u).toContain('不要再用这些句式');
    expect(u).toContain('- 开头:「甲国之族,肇兴于北原,地多寒,民尚武。」');
    expect(u).toContain('- 开头:「乙族,肇兴于南泽。」');
    expect(u).toContain('- 史臣曰:「甲国之兴,非恃甲兵之利,实赖民志之凝。」');
    expect(u).toContain('- 史臣曰:「乙国之存,非恃艨艟之坚,实赖契约之信。」');
    expect(u).toContain('- 史臣曰:「某甲之死,国失其将。」');
    expect(u).not.toContain('- 开头:「某甲');
    expect(usedPhrases(prev)).toEqual({
      openings: ['甲国之族,肇兴于北原,地多寒,民尚武。', '乙族,肇兴于南泽。'],
      verdicts: ['甲国之兴,非恃甲兵之利,实赖民志之凝。', '乙国之存,非恃艨艟之坚,实赖契约之信。', '某甲之死,国失其将。'],
    });
    // 全角的冒号、句号也认
    expect(usedPhrases('### 史臣曰：\n\n丙国之亡,亡于内争。其后不振。').verdicts).toEqual(['丙国之亡,亡于内争。']);
    expect(usedPhrases('**史臣曰**：丁国之盛,盛于通商！').verdicts).toEqual(['丁国之盛,盛于通商！']);
    // 前文太长、前几篇在〔前文〕里截掉了,开头和"史臣曰"照样摘出来
    const long = `${prev}\n\n${'正文。'.repeat(PREV_CONTEXT)}`;
    expect(historyMessages(p, 1, long)[1].content).toContain('「甲国之族,肇兴于北原,地多寒,民尚武。」');
  });

  it('每一篇(章)指定不同的开头写法和"史臣曰"的角度;"非恃……实赖……"点名禁掉;编年体卷首不罗列各国疆域', () => {
    const p = buildHistoryPrompts(civ, BIO);
    const angles = p.calls.map((c) => /- 开头和评语:(.*)/.exec(c.head)?.[1] ?? '');
    expect(angles.every(Boolean)).toBe(true);
    const opens = angles.map((a) => /这一篇开头(.+?)(?:;|$)/.exec(a)?.[1]).filter(Boolean);
    expect(opens.length).toBeGreaterThan(1);
    expect(new Set(opens).size).toBe(opens.length);
    const verdicts = angles.map((a) => /"史臣曰"(.+)$/.exec(a)?.[1]);
    expect(new Set(verdicts).size).toBe(verdicts.length);
    for (const c of p.calls) expect(c.head).toContain('非恃……实赖……');
    const a = buildHistoryPrompts(civ, { scope: { kind: 'era', from: 1600, to: 2400 }, style: 'annals', length: 'k10' });
    expect(a.calls.length).toBeGreaterThan(1);
    for (const c of a.calls.slice(1)) expect(c.head).toContain('不要先把天下各国的疆域、国都罗列一遍');
    // 一次写完、分几章的:各章开头换着写
    expect(buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'classic', length: 'medium' }).calls[0].head).toContain('各章的开头换着写法');
    // 白话没有"史臣曰"
    const plain = buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'plain', length: 'k10' });
    for (const c of plain.calls) expect(/- 开头和评语:.*/.exec(c.head)?.[0] ?? '').not.toContain('史臣曰');
  });

  it('篇幅:一千字以上给区间(不再说"宁可略短"),短篇只给上限;战事细节算进史事的分量', () => {
    for (const c of buildHistoryPrompts(civ, BIO).calls) {
      expect(c.head).toContain(`约 ${c.chars} 字(正文的中文字数,写到 ${Math.round((c.chars * 0.9) / 50) * 50}—${Math.round((c.chars * 1.1) / 50) * 50} 字之间`);
      expect(c.head).not.toContain('宁可略短');
    }
    expect(buildHistoryPrompts(civ, { scope: { kind: 'world' }, style: 'classic', length: 'short' }).calls[0].head).toContain('宁可略短');
    const wars = buildChronicle(civ).filter((e) => (e.children?.length ?? 0) >= 4);
    expect(wars.length).toBeGreaterThan(0);
    expect(charCap(wars)).toBeGreaterThan(charCap(wars.map((e) => ({ ...e, children: undefined }))));
  });
});

describe('AI 写史书:用假 AI 跑完整流程', () => {
  it('没设置 AI:抛 not-configured,不存', async () => {
    setActiveProvider(null);
    await expect(writeHistory(civ, { scope: { kind: 'world' }, style: 'classic', length: 'short' }, { world: 'w-none' })).rejects.toMatchObject({ code: 'not-configured' });
    expect(listHistoryNotes('w-none')).toHaveLength(0);
  });

  it('长篇:一章调用一次、边写边回调、写完存进本地;改名后标"历史已变";重写覆盖同一部', async () => {
    setActiveProvider('mock');
    setMockResponder((req) => `## ${req.title}\n\n这一章写了${req.messages[1].content.length}字的材料。`);
    const w = 'w-flow';
    const o: HistoryOptions = { scope: { kind: 'polity', polity: east.id }, style: 'plain', length: 'long' };
    const p = buildHistoryPrompts(civ, o);
    const n0 = recentCallsInMemory().length;
    const seen: number[] = [];
    let last = '';
    const note = await writeHistory(civ, o, { world: w, onProgress: (x) => (seen.push(x.call), (last = x.text)) });
    // 调了几次、每次记一条调用记录(功能名"史书")
    expect(recentCallsInMemory().length - n0).toBe(p.calls.length);
    const calls = recentCallsInMemory().slice(0, p.calls.length).reverse();
    expect(calls.map((r) => r.feature)).toEqual(p.calls.map(() => HISTORY_KIND));
    expect(calls.map((r) => r.title)).toEqual(p.calls.map((c) => c.title));
    expect(calls.every((r) => r.ok)).toBe(true);
    expect(new Set(seen)).toEqual(new Set(p.calls.map((_, i) => i)));
    expect(last).toBe(note.text);
    for (const c of p.calls) expect(note.text).toContain(`## ${c.title}`);
    // 第二章起发出去的消息带上了前文
    const second = calls[1];
    expect(second.messages[1].content).toContain('〔前文〕');
    expect(second.messages[1].content).toContain(`## ${p.calls[0].title}`);
    // 存好了
    const list = listHistoryNotes(w);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: '史书', provider: 'mock', key: historyNoteKey(storeScope(civ, o.scope), 'plain', 'long') });
    expect(list[0].book).toMatchObject({ title: p.title, style: 'plain', length: 'long', fp: p.fingerprint, seed: 7, calls: p.calls.length });
    expect(historyNoteStatus(civ, list[0])).toMatchObject({ stale: false, scope: o.scope });
    // 改名 → 历史已变(还能按原来的选项重写)
    const renamed = applyNames(civ, { [polityKey(civ, east.id)]: '饕' });
    expect(historyNoteStatus(renamed, list[0])).toMatchObject({ stale: true, scope: o.scope });
    // 导出 Markdown
    const md = historyMarkdown(list[0]);
    expect(md.startsWith(`# ${p.title}\n`)).toBe(true);
    expect(md).toContain('种子 7');
    expect(md).toContain(note.text);
    expect(historyFileName(list[0])).toMatch(/^[^\\/:*?"<>|\s]+\.md$/);
    // 重写:同一个键覆盖,还是一部
    setMockResponder(() => '重写的正文');
    await writeHistory(renamed, o, { world: w });
    const again = listHistoryNotes(w);
    expect(again).toHaveLength(1);
    expect(again[0].text).toBe(p.calls.map(() => '重写的正文').join('\n\n'));
    expect(historyNoteStatus(renamed, again[0]).stale).toBe(false);
    setMockResponder(() => '');
    setActiveProvider(null);
  });

  it('取消:抛 aborted,不存,已写的那部不动', async () => {
    setActiveProvider('mock');
    setMockResponder(() => '一段很长的正文'.repeat(50));
    const w = 'w-abort';
    const o: HistoryOptions = { scope: { kind: 'world' }, style: 'classic', length: 'short' };
    await writeHistory(civ, o, { world: w });
    expect(listHistoryNotes(w)).toHaveLength(1);
    const old = listHistoryNotes(w)[0].text;
    const ac = new AbortController();
    setMockResponder(() => '新的'.repeat(200));
    const job = writeHistory(civ, o, { world: w, signal: ac.signal, onProgress: (x) => x.text && ac.abort() });
    await expect(job).rejects.toMatchObject({ code: 'aborted' });
    expect(listHistoryNotes(w)[0].text).toBe(old);
    setActiveProvider(null);
  });
});

describe('AI 写史书:分篇写到一半被内容审核拦下', () => {
  // 纪传体通史(中篇)分五篇写;第 4 篇(下标 3)被拦
  const BIO: HistoryOptions = { scope: { kind: 'world' }, style: 'biography', length: 'k10' };
  const p = buildHistoryPrompts(civ, BIO);
  const FILTERED = () => new AiError('content-filter', '阿里云的内容安全审核拦下了 AI 写出来的内容');
  const body = (i: number) => `## 第${i + 1}篇\n\n第${i + 1}篇的正文。`;
  /** 假 AI:记下每次请求是第几篇、带没带"克制";fail(i, 第几次请求这一篇) 返回要抛的错 */
  function fake(fail: (i: number, nth: number) => AiError | null) {
    const sent: { i: number; restrained: boolean; user: string }[] = [];
    setMockResponder((req) => {
      const i = p.calls.findIndex((c) => c.title === req.title);
      const user = req.messages.find((m) => m.role === 'user')!.content;
      sent.push({ i, restrained: user.includes(restrainedLine('篇')), user });
      const e = fail(i, sent.filter((s) => s.i === i).length);
      if (e) throw e;
      return body(i);
    });
    return sent;
  }

  it('被拦的那一篇带上"战争、杀伐写得克制"自动再写一次,成了就接着写完', async () => {
    expect(p.calls.length).toBeGreaterThanOrEqual(5);
    setActiveProvider('mock');
    const sent = fake((i, nth) => (i === 3 && nth === 1 ? FILTERED() : null));
    const note = await writeHistory(civ, BIO, { world: 'w-filter-1' });
    expect(sent.map((s) => s.i)).toEqual([0, 1, 2, 3, 3, ...p.calls.slice(4).map((_, k) => 4 + k)]);
    expect(sent.map((s) => s.restrained)).toEqual(sent.map((_, k) => k === 4));
    // "克制"那条加在写作要求里(材料前面),前文照常带
    const again = sent[4].user;
    expect(again.indexOf(restrainedLine('篇'))).toBeGreaterThan(0);
    expect(again.indexOf(restrainedLine('篇'))).toBeLessThan(again.indexOf('〔前文〕(已经写好的'));
    expect(again).toContain('第3篇的正文');
    expect(note.text).toBe(p.calls.map((_, i) => body(i)).join('\n\n'));
    setActiveProvider(null);
  });

  it('还被拦:停下报错、不存,写好的前 3 篇交出来;交回去从第 4 篇接着写,前 3 篇不再请求,前文照用', async () => {
    setActiveProvider('mock');
    const w = 'w-filter-2';
    let sent = fake((i) => (i === 3 ? FILTERED() : null));
    let kept: WrittenCall[] = [];
    await expect(writeHistory(civ, BIO, { world: w, onWritten: (x) => (kept = x) })).rejects.toMatchObject({ code: 'content-filter' });
    expect(sent.map((s) => [s.i, s.restrained])).toEqual([
      [0, false],
      [1, false],
      [2, false],
      [3, false],
      [3, true],
    ]);
    expect(listHistoryNotes(w)).toHaveLength(0);
    expect(kept.map((x) => x.text)).toEqual([0, 1, 2].map(body));
    expect(kept.every((x) => x.provider === 'mock' && x.model === 'mock')).toBe(true);
    // 接着写:从第 4 篇开始,进度一开始就带着前 3 篇
    sent = fake(() => null);
    const first: { text: string; call: number }[] = [];
    const note = await writeHistory(civ, BIO, { world: w, written: kept, onProgress: (x) => first.push(x) });
    expect(sent.map((s) => s.i)).toEqual(p.calls.slice(3).map((_, k) => 3 + k));
    expect(first[0]).toMatchObject({ call: 3, text: [0, 1, 2].map(body).join('\n\n') });
    // 第 4 篇的请求和一口气写下来时一样:前文、用过的开头都从写好的 3 篇取
    expect(sent[0].user).toBe(historyMessages(p, 3, [0, 1, 2].map(body).join('\n\n'))[1].content);
    expect(sent[0].restrained).toBe(false);
    expect(note.text).toBe(p.calls.map((_, i) => body(i)).join('\n\n'));
    expect(note.provider).toBe('mock');
    expect(listHistoryNotes(w)).toHaveLength(1);
    setActiveProvider(null);
  });

  it('网络不通、额度不够之类的错:不带"克制"重试,直接报错', async () => {
    setActiveProvider('mock');
    for (const code of ['network', 'quota', 'rate-limit'] as const) {
      const sent = fake((i) => (i === 3 ? new AiError(code, '出错了') : null));
      await expect(writeHistory(civ, BIO, { world: 'w-filter-3' })).rejects.toMatchObject({ code });
      expect(sent.map((s) => s.i)).toEqual([0, 1, 2, 3]);
      expect(sent.some((s) => s.restrained)).toBe(false);
    }
    setActiveProvider(null);
  });

  describe('一次写完的(不分篇)', () => {
    const one: HistoryOptions = { scope: { kind: 'era', from: 1200, to: 1500 }, style: 'biography', length: 'k3' };
    const p1 = buildHistoryPrompts(civ, one);
    const LINE = restrainedLine('部');
    /** 假 AI:记下每次请求带没带"克制";fail(第几次请求) 返回要抛的错 */
    function fakeOne(fail: (nth: number) => AiError | null) {
      const sent: { restrained: boolean; user: string }[] = [];
      setMockResponder((req) => {
        const user = req.messages.find((m) => m.role === 'user')!.content;
        sent.push({ restrained: user.includes(LINE), user });
        const e = fail(sent.length);
        if (e) throw e;
        return '一次写完的正文。';
      });
      return sent;
    }

    it('被拦:带上"战争、杀伐写得克制"自动再写一次,成了照常出书', async () => {
      expect(p1.calls).toHaveLength(1);
      expect(p1.calls[0].chapter).toBe(null);
      setActiveProvider('mock');
      const w = 'w-filter-4';
      const sent = fakeOne((nth) => (nth === 1 ? FILTERED() : null));
      const note = await writeHistory(civ, one, { world: w });
      expect(sent.map((s) => s.restrained)).toEqual([false, true]);
      // "克制"那条加在写作要求末尾(材料前面),其余和第一次一字不差
      expect(sent[1].user).toBe(historyMessages(p1, 0, '', true)[1].content);
      expect(sent[1].user.replace(`\n${LINE}`, '')).toBe(sent[0].user);
      expect(sent[1].user.indexOf(LINE)).toBeLessThan(sent[1].user.indexOf(p1.calls[0].body));
      expect(note.text).toBe('一次写完的正文。');
      expect(listHistoryNotes(w)).toHaveLength(1);
      setMockResponder(null);
      setActiveProvider(null);
    });

    it('还被拦:停下报错、不存,只多请求一次', async () => {
      setActiveProvider('mock');
      const w = 'w-filter-5';
      const sent = fakeOne(() => FILTERED());
      await expect(writeHistory(civ, one, { world: w })).rejects.toMatchObject({ code: 'content-filter' });
      expect(sent.map((s) => s.restrained)).toEqual([false, true]);
      expect(listHistoryNotes(w)).toHaveLength(0);
      setMockResponder(null);
      setActiveProvider(null);
    });

    it('网络不通、额度不够、限流:不带"克制"重试,直接报错', async () => {
      setActiveProvider('mock');
      for (const code of ['network', 'quota', 'rate-limit'] as const) {
        const sent = fakeOne(() => new AiError(code, '出错了'));
        await expect(writeHistory(civ, one, { world: 'w-filter-6' })).rejects.toMatchObject({ code });
        expect(sent.map((s) => s.restrained)).toEqual([false]);
      }
      setMockResponder(null);
      setActiveProvider(null);
    });
  });
});
