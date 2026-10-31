/**
 * 作者的人物的性别(gen/characters.ts 的 female):
 * - 数据:以前建的人物没有这一项 = 男的;只认 true;填写卡片选「男 / 女」存进去、编辑时读回来;存档、分享链接来回不丢
 * - 即了位的:推演里那位君主跟着人物卡是男是女(applyCharacters),历史本身不变;没即位成的原因写"她"
 * - 填写页、即位页、改人物 / 删人物时问的那一句、世系图里写到这个人物的"他 / 她"
 * - 女的头像先用她的颜色的方块写名字(没有「换一张」);填写页最上面一节「性别」
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { rasterize, type Raster } from '../src/gen/raster';
import { EMPTY_EDITS, polityKey, type Intervention, type WorldEdits } from '../src/gen/edits';
import { applyCharacters, cleanCharacter, cleanCharacters, type AuthorCharacter } from '../src/gen/characters';
import { heOrShe, isFemale } from '../src/gen/civ/story/gender';
import { peopleIndex } from '../src/gen/civ/story/peopleInfo';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { polityName } from '../src/gen/civ/growth';
import { dynastyRows, layoutDynasty, treeLabel } from '../src/gen/civ/story/lineageInfo';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { decodeShare, encodeShare, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { addCharacter, clearEdits, getEdits, updateCharacter } from '../src/ui/editsStore';
import { clearSelection } from '../src/ui/civView';
import { editCharacterDraft, finishDraft, getCharUi, newCharacterDraft, patchDraft, resetCharacterUi } from '../src/ui/characterStore';
import { characterCrowns, crownDeleteAsk, crownDoneText, crownEditAsk } from '../src/ui/crownInfo';
import { crownKeepHint } from '../src/ui/keepInfo';
import { PersonFace, nameFaceText } from '../src/ui/Portrait';
import { CharacterPanel } from '../src/ui/CharacterPanel';
import { CrownPage } from '../src/ui/CrownPage';

// 在 Node 里把卡片画成字(renderToStaticMarkup):界面上的几个状态(逐年推演……)没给"服务器上的初值",照当前的值用
vi.mock('react', async (orig) => {
  const R = await orig<typeof import('react')>();
  const useSyncExternalStore: typeof R.useSyncExternalStore = (sub, get, server) => R.useSyncExternalStore(sub, get, server ?? get);
  return { ...R, default: { ...R, useSyncExternalStore }, useSyncExternalStore };
});

const seed = 7;
let w: World | null = null;
let b: Civ | null = null;
let r: Raster | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed }));
const base = () => (b ??= generateCiv(world()));
const raster = () => (r ??= rasterize(world()));
type CrownIv = Extract<Intervention, { kind: 'crown' }>;
const LEAN = { expand: 70, war: 80, develop: 40, trade: 30 };

afterEach(() => {
  resetCharacterUi();
  clearSelection();
  clearEdits();
});

describe('作者的人物的性别 · 数据', () => {
  it('以前建的人物没有这一项:当男的;只认 true;本来合格的原样返回', () => {
    const old = cleanCharacter({ id: 1, name: '林小满', color: 'red', born: 2490 })!;
    expect(old.female).toBeUndefined();
    expect(isFemale(old)).toBe(false);
    expect(heOrShe(old)).toBe('他');
    const she = { id: 2, name: '沈蘅', color: 'red', born: 2976, female: true };
    expect(cleanCharacter(she)).toBe(she);
    expect(heOrShe(cleanCharacter(she))).toBe('她');
    for (const bad of [false, 'true', 1, null, {}]) expect(cleanCharacter({ ...she, female: bad })!.female).toBeUndefined();
    expect(cleanCharacters([she, { id: 3, name: '甲', born: 2400 }]).map((c) => !!c.female)).toEqual([true, false]);
  });

  it('填写卡片:新建默认男;选了女存进去;编辑时读回来;改回男去掉这一项', () => {
    newCharacterDraft({ birthplace: [10, 20], year: 2999 });
    expect(getCharUi().draft!.female).toBe(false);
    patchDraft({ name: '沈蘅', bornText: '2976', female: true });
    const id = finishDraft();
    const c = getEdits().characters!.find((x) => x.id === id)!;
    expect(c.female).toBe(true);
    editCharacterDraft(c);
    expect(getCharUi().draft!.female).toBe(true);
    patchDraft({ female: false });
    finishDraft();
    expect('female' in getEdits().characters!.find((x) => x.id === id)!).toBe(false);
    // 以前建的(没有这一项)打开编辑:选着「男」
    const old = addCharacter({ name: '林小满', color: 'blue', born: 2490 });
    editCharacterDraft(getEdits().characters!.find((x) => x.id === old)!);
    expect(getCharUi().draft!.female).toBe(false);
  });

  it('存档、分享链接:女的多一项 female,来回一样;以前的存档读出来是男的', async () => {
    const characters: AuthorCharacter[] = [
      { id: 1, name: '沈蘅', color: 'red', born: 2976, female: true },
      { id: 2, name: '林小满', color: 'blue', born: 2490 },
    ];
    const edits: WorldEdits = { ...EMPTY_EDITS, characters };
    const params = { ...DEFAULT_PARAMS, seed };
    const save = makeSave(params, edits, 'abc', '九州', '2026-10-29T00:00:00.000Z');
    const text = saveText(save);
    expect(text).toContain('"female": true');
    const back = parseSave(text);
    expect(back.ok && back.save.edits.characters).toEqual(characters);
    expect(back.ok && back.warnings).toEqual([]);
    const shared = await decodeShare(await encodeShare(save));
    expect(shared.ok && shared.save.edits.characters).toEqual(characters);
    // 以前的存档:人物没有这一项
    const old = parseSave(text.replace(/,?\s*"female": true/, ''));
    expect(old.ok && old.save.edits.characters!.every((c) => !isFemale(c))).toBe(true);
  });
});

/** 即位的那一国:第 1500 年国土最大、到 1600 年还在的国家(同 crown-ui.test.ts) */
let pidMemo: number | null = null;
const pid = (): number => {
  if (pidMemo !== null) return pidMemo;
  const civ = base();
  const n = new Map<number, number>();
  for (const p of ownersAt(civ, 1500).polity) if (p >= 0) n.set(p, (n.get(p) ?? 0) + 1);
  let best = -1;
  for (const [p, k] of n) if ((civ.polities[p].ended ?? Infinity) > 1600 && (best < 0 || k > n.get(best)!)) best = p;
  return (pidMemo = best);
};

describe('作者的人物的性别 · 即了位的', () => {
  // 种子 7:1500 年即位,填了 1530 年退位
  const T = 1500;
  const SHE: AuthorCharacter = { id: 1, name: '沈蘅', born: 1468, died: 1541, color: 'red', leanings: LEAN, female: true };
  const HE: AuthorCharacter = { ...SHE, name: '林小满', female: undefined };
  delete HE.female;
  const crown = (a: string, from: number, o: Partial<CrownIv> = {}): CrownIv => ({ kind: 'crown', a, char: 1, from, born: 1468, leanings: LEAN, ...o });
  let made: { civ: Civ; ivs: Intervention[]; A: string } | null = null;
  const setup = () => {
    if (made) return made;
    const ivs: Intervention[] = [crown(polityKey(base(), pid()), T, { until: 1530, abdicate: true })];
    const civ = generateCiv(world(), { interventions: ivs });
    return (made = { civ, ivs, A: polityName(civ.polities[pid()], T) });
  };

  it('推演里那位君主跟着人物卡:女的 female = true,男的、删掉了的不写;历史不变', () => {
    const { civ } = setup();
    const raw = peopleIndex(civ).rulers[pid()].find((x) => x.author === 1)!;
    expect(raw.female).toBeUndefined();
    const she = applyCharacters(civ, [SHE]);
    const x = she.people!.find((p) => p.author === 1)!;
    expect(x).toMatchObject({ name: '沈蘅', female: true });
    expect(she.authorFemale).toEqual([1]);
    expect(she.annals).toBe(civ.annals);
    expect(she.people!.filter((p) => p.author === undefined).every((p, i) => p === civ.people!.filter((q) => q.author === undefined)[i])).toBe(true);
    const he = applyCharacters(civ, [HE]);
    expect(isFemale(he.people!.find((p) => p.author === 1))).toBe(false);
    expect(he.authorFemale).toBeUndefined();
    expect(isFemale(applyCharacters(civ, []).people!.find((p) => p.author === 1))).toBe(false);
    // 人物卡改回男、删掉:套过一次的再套,推演人物上的 female、记下的女的编号都去掉
    const back = applyCharacters(she, [HE]);
    expect('female' in back.people!.find((p) => p.author === 1)!).toBe(false);
    expect('authorFemale' in back).toBe(false);
    expect('authorFemale' in applyCharacters(she, [])).toBe(false);
    // 推演人物的小头像(人物页、世系图、关注名牌):女的先写名字的最后一个字
    const face = renderToStaticMarkup(createElement(PersonFace, { civ: she, x, year: 1510, size: 'row' }));
    expect(face).toContain('pt-name');
    expect(face).toContain('>蘅</span>');
    expect(renderToStaticMarkup(createElement(PersonFace, { civ: he, x: he.people!.find((p) => p.author === 1)!, year: 1510, size: 'row' }))).not.toContain('pt-name');
    // 编年史:写到她即位那一条照旧(只换名字)
    const line = (c: Civ) => buildChronicle(c).find((e) => e.kind === 'intervene' && e.text.includes('即'))?.text ?? '';
    expect(line(she)).toBe(line(applyCharacters(civ, [{ ...HE, name: '沈蘅' }])));
  }, 120_000);

  it('世系图:接她位的那一棵写"继她之位"', () => {
    const { civ } = setup();
    const she = applyCharacters(civ, [SHE]);
    const me = peopleIndex(she).rulers[pid()].find((x) => x.author === 1)!;
    const row = dynastyRows(she, pid()).find((x) => x.rulers.includes(me))!;
    const trees = layoutDynasty(she, row);
    const i = trees.findIndex((t) => t.nodes.some((n) => n.p === me));
    const next = row.rulers[row.rulers.indexOf(me) + 1];
    const j = trees.findIndex((t) => t.nodes.some((n) => n.p === next));
    if (j === i + 1) expect(treeLabel(row, trees, j)).toBe('继她之位');
  }, 120_000);

  it('没即位成的原因、改人物 / 删人物时问的那一句写"她"', () => {
    const { civ, ivs, A } = setup();
    // 即位那年还没出生
    const early: Intervention[] = [crown(polityKey(base(), pid()), T, { born: T + 10 })];
    const civ2 = applyCharacters(generateCiv(world(), { interventions: early }), [{ ...SHE, born: T + 10 }]);
    const [v] = characterCrowns(civ2, 1, [], early, false, undefined);
    expect(v).toMatchObject({ kind: 'void', why: `她第 ${T + 10} 年才出生` });
    expect(crownDoneText(civ2, early[0] as CrownIv, 0, [{ ...SHE, born: T + 10 }], undefined).text).toBe(`沈蘅没能即位：她第 ${T + 10} 年才出生`);
    const civHe = applyCharacters(generateCiv(world(), { interventions: early }), [{ ...HE, born: T + 10 }]);
    expect(characterCrowns(civHe, 1, [], early, false, undefined)[0]).toMatchObject({ why: `他第 ${T + 10} 年才出生` });

    const ask = crownEditAsk(civ, ivs, SHE, { ...SHE, died: 1525 }, undefined)!;
    expect(ask.title).toBe('要一起改她的即位吗？');
    expect(ask.no).toEqual(['只改人物卡', '推演里她照旧当到 1530 年，和卒年对不上']);
    expect(crownEditAsk(civ, ivs, SHE, { ...SHE, born: 1470 }, undefined)!.yes[1]).toBe('从第 1500 年起重新推演；推演里她的年纪跟着改');
    // 只改了性别:历史不变,不用问
    expect(crownEditAsk(civ, ivs, HE, SHE, undefined)).toBeNull();
    const del = crownDeleteAsk(applyCharacters(civ, [SHE]), ivs, SHE, undefined)!;
    expect(del.lead).toBe(`她当过${A}的君主（1500–1530 年）。`);
    expect(del.yes[0]).toBe('连她的即位一起去掉');
    expect(del.done).toBe('已删除人物「沈蘅」和她的即位');
    // 即位页勾下面那一句
    expect(crownKeepHint(civ, pid(), T, 1530, undefined, SHE)).toMatch(/她(下台后|在位时)/);
    expect(crownKeepHint(civ, pid(), T, 1530, undefined)).toMatch(/他(下台后|在位时)/);
  }, 120_000);
});

describe('作者的人物的性别 · 卡片、即位页', () => {
  const SHE = { name: '沈蘅', color: 'red' as const, born: 2976, female: true as const };

  it('头像上写的字:卡片写名字后两个字,小圆头像写最后一个字;不是汉字的写首字母', () => {
    expect(nameFaceText('沈蘅', false)).toBe('沈蘅');
    expect(nameFaceText('维斯佩丽娜', false)).toBe('丽娜');
    expect(nameFaceText('维斯佩丽娜', true)).toBe('娜');
    expect(nameFaceText('苏', false)).toBe('苏');
    expect(nameFaceText('伊丽莎白·都铎', false)).toBe('都铎');
    expect(nameFaceText('anna smith', false)).toBe('A');
  });

  it('女的人物卡:头像是她的颜色的方块写名字、没有「换一张」', () => {
    // 「更多」菜单的 useLayoutEffect 在 Node 里画会报一句警告,不相干
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const civ = base();
    const id = addCharacter(SHE);
    const html = renderToStaticMarkup(createElement(CharacterPanel, { civ, raster: raster(), world: world(), year: 2999, id }));
    expect(html).toContain('pt-name');
    expect(html).toContain('>沈蘅</span>');
    expect(html).not.toContain('character-portrait');
    // 男的:照旧是画像、能「换一张」
    updateCharacter({ ...getEdits().characters![0], female: undefined });
    const he = renderToStaticMarkup(createElement(CharacterPanel, { civ, raster: raster(), world: world(), year: 2999, id }));
    expect(he).not.toContain('pt-name');
    expect(he).toContain('character-portrait');
    quiet.mockRestore();
  }, 120_000);

  it('填写页最上面一节「性别」:默认男、说明写"他 / 她"跟着它;选了女说明换成头像那句', () => {
    const civ = base();
    const props = { civ, raster: raster(), world: world(), year: 2999, id: 0 };
    newCharacterDraft({ birthplace: [10, 20], year: 2999 });
    const html = renderToStaticMarkup(createElement(CharacterPanel, props));
    const body = html.slice(html.indexOf('cp-body'));
    expect(body.indexOf('性别')).toBeLessThan(body.indexOf('生卒'));
    expect(html).toMatch(/aria-checked="true"[^>]*class="on"[^>]*>男</);
    expect(html).toContain('卡片、按钮上写「他」还是「她」跟着这个。');
    expect(html).toContain('让他即位时带进推演');
    patchDraft({ female: true });
    const she = renderToStaticMarkup(createElement(CharacterPanel, props));
    expect(she).toMatch(/aria-checked="true"[^>]*class="on"[^>]*>女</);
    expect(she).toContain('头像先用颜色方块，女性头像以后补上。');
    expect(she).toContain('让她即位时带进推演');
  }, 120_000);

  it('即位页:写"她那年几岁"、"她的国家"', () => {
    const civ = base();
    const c: AuthorCharacter = { id: 1, ...SHE, born: 1468 };
    const page = (x: AuthorCharacter) => renderToStaticMarkup(createElement(CrownPage, { civ, raster: raster(), world: world(), year: 1500, c: x, onBack: () => {} }));
    const she = page(c);
    expect(she).toContain('她那年 32 岁');
    expect(she).not.toMatch(/他那年|他的国家|让他/);
    const { female: _, ...male } = c;
    expect(page(male)).toContain('他那年 32 岁');
  }, 120_000);
});
