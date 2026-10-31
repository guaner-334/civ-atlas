/**
 * 给推演里的人物改名(君主、将领、名臣、宗室):改名表里记的是人物的稳定键 → 新本名;
 * applyNames 换 Person.name、生成时的名字留在 defaultName,稳定键不因改名变;称号照旧;存档里的键放得下。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { personName } from '../src/gen/civ/story/peopleText';
import { applyNames, cleanName, EMPTY_EDITS, resolveKey } from '../src/gen/edits';
import { personKey, resolvePersonKey } from '../src/gen/characters';
import { searchCiv } from '../src/ui/searchIndex';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';

let civ7: Civ | undefined;
const civOf7 = () => (civ7 ??= generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 })));

describe('人物改名', () => {
  it('换本名,生成时的名字留在 defaultName,原 Civ 不动', () => {
    const civ = civOf7();
    const x = civ.people!.find((p) => p.role === 'ruler')!;
    const key = personKey(civ, x.id);
    expect(key).toMatch(/^person:/);
    expect(resolveKey(civ, key)).toEqual({ kind: 'person', id: x.id });
    const out = applyNames(civ, { [key]: '改名后' });
    expect(out).not.toBe(civ);
    expect(out.people![x.id].name).toBe('改名后');
    expect(out.people![x.id].defaultName).toBe(x.name);
    expect(personName(out, out.people![x.id])).toContain('改名后');
    expect(x.name).not.toBe('改名后');
    expect(civ.people![x.id].defaultName).toBeUndefined();
    // 别的人、别的东西不动
    out.people!.forEach((p, i) => i !== x.id && expect(p).toBe(civ.people![i]));
    expect(out.polities).toBe(civ.polities);
  });

  it('稳定键不因改名变;再套一次不会丢掉生成时的名字', () => {
    const civ = civOf7();
    const x = civ.people!.find((p) => p.role === 'general') ?? civ.people![0];
    const key = personKey(civ, x.id);
    const out = applyNames(civ, { [key]: '某某' });
    expect(personKey(out, x.id)).toBe(key);
    expect(resolvePersonKey(out, key)).toBe(x.id);
    expect(resolveKey(out, key)).toEqual({ kind: 'person', id: x.id });
    expect(applyNames(out, { [key]: '某某' })).toBe(out);
    const again = applyNames(out, { [key]: '另一个' });
    expect(again.people![x.id].defaultName).toBe(x.name);
    expect(personKey(again, x.id)).toBe(key);
  });

  it('搜索、编年史里都用新名字', () => {
    const civ = civOf7();
    const x = civ.people!.find((p) => p.role === 'ruler' && p.from !== undefined && p.from > 0)!;
    const out = applyNames(civ, { [personKey(civ, x.id)]: '甲乙丙丁' });
    const hits = searchCiv(out, '甲乙丙丁', civ.endYear);
    expect(hits.length).toBeGreaterThan(0);
    expect(searchCiv(civ, '甲乙丙丁', civ.endYear)).toHaveLength(0);
    const text = (c: Civ) => buildChronicle(c).map((e) => e.text).join('\n');
    expect(text(out)).toContain('甲乙丙丁');
    expect(text(civ)).not.toContain('甲乙丙丁');
  });

  it('找不到的键、空名字忽略;没有人物生效时返回原 Civ', () => {
    const civ = civOf7();
    expect(applyNames(civ, { 'person:polity:c1#0|ruler|不存在|1': '无效' })).toBe(civ);
    const key = personKey(civ, civ.people![0].id);
    expect(applyNames(civ, { [key]: '' })).toBe(civ);
  });

  it('改名后 cleanName 按人物处理:去空白、最长 16 字,不去后缀', () => {
    expect(cleanName('person', '  柳 玄国  ')).toBe('柳 玄国');
    expect([...cleanName('person', '一'.repeat(40))]).toHaveLength(16);
  });

  it('存档读写:人物的键(含名字)放得下,不被当成格式不对丢掉', () => {
    const civ = civOf7();
    const names: Record<string, string> = {};
    for (const x of civ.people!.slice(0, 200)) {
      const k = personKey(civ, x.id);
      if (k) names[k] = '新名字';
    }
    const longest = Math.max(...Object.keys(names).map((k) => k.length));
    expect(longest).toBeLessThanOrEqual(96);
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, names }, 'c');
    const r = parseSave(saveText(save));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.edits.names).toEqual(names);
    expect(r.warnings.filter((w) => w.includes('改名'))).toEqual([]);
  });
});
