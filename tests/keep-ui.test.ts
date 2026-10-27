/**
 * 「保住王室」在界面上的说法(keepInfo.ts、Interventions.tsx 的 interventionText、newIvInfo.ts 的提示条、crownInfo.ts 的即位提示条):
 * 单子 / 我的干预的一行、补的结果(挡下几回 / 期间没有要改朝的时候)、国家卡片「王室」一行(只在管着的那些年)、人物卡君位那一段、即位页那一句
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { polityKey, type Intervention } from '../src/gen/edits';
import { crownKeepHint, keepBlocks, keepReignNote, keepResult, keepRow } from '../src/ui/keepInfo';
import { interventionText } from '../src/ui/Interventions';
import { newIvDoneText } from '../src/ui/newIvInfo';
import { crownDoneText } from '../src/ui/crownInfo';
import type { Pending } from '../src/ui/pendingStore';

const seed = 2024;
let w: World | null = null;
let b: Civ | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed }));
const base = () => (b ??= generateCiv(world()));
const L = { expand: 50, war: 50, develop: 70, trade: 50 };

/** 不干预时第一次看王朝改朝换代的那一条(900 年以后) */
const firstChange = (civ: Civ) => civ.annals.find((e, i) => e.kind === 'dynasty' && e.year >= 900 && !(civ.annals[i - 1]?.kind === 'regent' && civ.annals[i - 1].year === e.year))!;

describe('保住王室 · 说法', () => {
  it('开关:单子 / 我的干预一行"某国保住王室，到 N 年 / 一直有效";推完补"挡下哪几年几回改朝换代";国家卡片只在管着的那些年写', () => {
    const c0 = base();
    const e = firstChange(c0);
    const P = e.a;
    const T = Math.floor(e.year);
    const v: Intervention = { kind: 'keep', a: polityKey(c0, P), from: T, until: T + 80 };
    expect(interventionText(c0, v, -1, '大澜王朝')).toBe(`大澜王朝保住王室，到 ${T + 80} 年`);
    expect(interventionText(c0, { kind: 'keep', a: v.a, from: T }, -1, '大澜王朝')).toBe('大澜王朝保住王室，一直有效');
    const civ = generateCiv(world(), { interventions: [v] });
    const blocks = keepBlocks(civ, 0);
    expect(blocks.length).toBeGreaterThan(0);
    const r = keepResult(civ, v, 0, undefined);
    expect(r.startsWith(`；挡下 ${Math.floor(blocks[0].year)}`)).toBe(true);
    expect(r).toMatch(/[一两三四五六七八九十]+回(改朝换代|王室更迭)$/);
    // 提示条
    expect(newIvDoneText(civ, v, 0, '大澜王朝', undefined)).toEqual({ ok: true, text: `大澜王朝保住王室，到 ${T + 80} 年` });
    // 国家卡片:管着的那些年才有;单子里的写待推演
    expect(keepRow(civ, P, T + 1, [], false, undefined)).toEqual({ note: `到 ${T + 80} 年` });
    expect(keepRow(civ, P, T - 1, [], false, undefined)).toBeNull();
    expect(keepRow(civ, P, T + 80, [], false, undefined)).toBeNull();
    const pend: Pending[] = [{ kind: 'iv', id: 1, v, text: '', from: T }];
    expect(keepRow(c0, P, T, pend, false, undefined)).toEqual({ tag: '待推演' });
    expect(keepRow(c0, P, T, pend, true, undefined)).toEqual({ tag: '下一步生效' });
  }, 120_000);

  it('即位带勾:一行后面接"；在位期间保住王室",提示条不写下台年份;我的干预补"，挡下……";国家卡片写"到某某下台";人物卡那一段;即位页那一句', () => {
    const c0 = base();
    const e = firstChange(c0);
    const P = e.a;
    const T = Math.floor(e.year) - 2;
    const v: Extract<Intervention, { kind: 'crown' }> = { kind: 'crown', a: polityKey(c0, P), char: 1, from: T, born: T - 30, until: T + 40, keep: true, leanings: L };
    expect(interventionText(c0, v, -1, '大澜王朝')).toBe(`作者的人物即大澜王朝君位，${T + 40} 年退位；在位期间保住王室`);
    const civ = generateCiv(world(), { interventions: [v] });
    expect(crownDoneText(civ, v, 0, [], undefined).text).toMatch(/君位，在位期间保住王室$/);
    const n = keepBlocks(civ, 0).length;
    expect(n).toBeGreaterThan(0);
    expect(keepResult(civ, v, 0, undefined)).toMatch(/^，挡下 \d+/);
    const him = civ.people!.find((x) => x.author === 1)!;
    expect(keepRow(civ, P, T + 5, [], false, undefined)).toEqual({ note: `到${him.name}下台` });
    expect(keepRow(civ, P, T + 45, [], false, undefined)).toBeNull();
    const note = keepReignNote(civ, him, 0, false, undefined);
    expect(note.startsWith('在位期间保住王室：')).toBe(true);
    expect(note).toContain('都没成');
    expect(note.endsWith('下台以后照常继位，也照常会改朝换代。') || note.endsWith('下台以后照常继位，也照常会王室更迭。')).toBe(true);
    // 没挡下的
    const none = generateCiv(world(), { interventions: [{ ...v, from: 1200, born: 1170, until: 1201 }] });
    if (!keepBlocks(none, 0).length) expect(keepResult(none, none.interventions![0], 0, undefined)).toBe('，期间没有要改朝的时候');
    // 即位页:这一朝已立几年,照常推演哪年会改朝换代(这份历史里下一次换朝在他在位期间)
    expect(crownKeepHint(c0, P, T, T + 40, undefined)).toMatch(new RegExp(`这一朝已立 \\d+ 年，照常推演 ${Math.floor(e.year)} 年就会(改朝换代|王室更迭)。保住以后，他下台后几十年里多半还是会换。$`));
    expect(crownKeepHint(c0, P, T, T + 1, undefined)).toMatch(/照常推演他在位时不会(改朝换代|王室更迭)。保住以后，有人篡位也会挡下。$/);
  }, 120_000);

  it('那一年这国已亡:提示条黄色写原因,我的干预不补结果', () => {
    const c0 = base();
    const p = c0.polities.find((q) => q.ended !== undefined && q.ended < 1400 && q.founded < q.ended - 50)!;
    const v: Intervention = { kind: 'keep', a: polityKey(c0, p.id), from: Math.ceil(p.ended!) + 10 };
    const civ = generateCiv(world(), { interventions: [v] });
    const d = newIvDoneText(civ, v, 0, '某国', undefined)!;
    expect(d.ok).toBe(false);
    expect(d.text).toMatch(/^某国保住王室没生效：第 \d+ 年.*已亡$/);
    expect(keepResult(civ, v, 0, undefined)).toBe('');
  }, 120_000);
});
