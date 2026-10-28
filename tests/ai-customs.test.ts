/**
 * 民族卡片里的"讲讲风俗"(src/ai/prompts/customs.ts):发给 AI 的材料只用世界里的真事实(族名、生计、来历、住在哪、信什么、
 * 特质和来由、迁徙、大事都和历史对得上,年份都是真有的),提示词说清只用材料;改名不算历史改写、存的键跟着稳定键走。不调真 AI。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { KIND_INFO, cultureLabel, regionLabel } from '../src/gen/civ/display';
import { polityName, populationLabel } from '../src/gen/civ/growth';
import { cultureTraits } from '../src/gen/civ/cultureTraits';
import { applyNames, cultureKey } from '../src/gen/edits';
import { CUSTOMS_CHARS, cleanCustoms, cultureMaterial, customsNoteKey, customsRequest, customsScan, customsStamp } from '../src/ai/prompts/customs';
import { cultureEntries, cultureNow, cultureShownYear, cultureWaves, waveText } from '../src/ui/cultureInfo';
import { scanRealWords } from '../src/ai/realWords';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed }))));
  return c;
}

/** 材料里出现的"第 N 年"都是这一族真有的年份:出现、消亡、特质那一段的两头、迁徙、大事、支族分出、材料那一年 */
function realYears(civ: Civ, id: number, y: number): Set<number> {
  const cu = civ.cultures[id];
  const ys = new Set<number>([Math.floor(cu.born), y]);
  if (cu.ended !== undefined) ys.add(Math.floor(cu.ended));
  const tr = cultureTraits(civ, id, y);
  if (tr) {
    ys.add(tr.window.from);
    ys.add(tr.window.to);
    for (const t of tr.traits) for (const m of t.why.matchAll(/(\d+) 年/g)) ys.add(Number(m[1]));
  }
  for (const w of cultureWaves(civ, id, y)) ys.add(Math.floor(w.year));
  for (const e of cultureEntries(civ, id)) ys.add(Math.floor(e.year));
  for (const k of civ.cultures) if (k.parent === id) ys.add(Math.floor(k.born));
  return ys;
}

describe.each([7, 2024])('风俗的材料 · seed=%i', (seed) => {
  const civ = civOf(seed);
  const y = Math.floor(civ.endYear * 0.75);
  const alive = civ.cultures.filter((c) => !c.unborn && c.born < y && (c.ended === undefined || c.ended > y));

  it('只用世界里的真事实:族名、生计、来历、住在哪、信什么、特质、迁徙、大事', () => {
    expect(alive.length).toBeGreaterThan(2);
    for (const cu of alive) {
      const m = cultureMaterial(civ, cu.id, y)!;
      const text = m.lines.join('\n');
      expect(m.year).toBe(y);
      expect(m.shown).toBe(cultureLabel(cu));
      expect(m.lines[0]).toBe(`民族:${cultureLabel(cu)}`);
      expect(text).toContain(`生计:${KIND_INFO[cu.kind].name}(${KIND_INFO[cu.kind].hint})`);
      expect(text).toContain(`发源${regionLabel(civ, cu.hearth)}`);
      if (cu.parent !== undefined) expect(text).toContain(`从${cultureLabel(civ.cultures[cu.parent])}分出`);
      // 住几州、多少人、住在哪些国家、信什么:和卡片同一份数
      const now = cultureNow(civ, cu.id, y);
      expect(text).toContain(`- 住 ${now.regions.length} 州,${populationLabel(now.pop)}`);
      for (const p of now.polities.slice(0, 5)) expect(text).toContain(`${polityName(civ.polities[p.id], y)} ${p.n} 州`);
      if (now.wild) expect(text).toContain(`无主之地 ${now.wild} 州`);
      for (const f of now.faiths.slice(0, 4)) expect(text).toContain(`${civ.religion!.faiths[f.id].name} ${f.n} 州`);
      // 写到的国名都是这一年真有的国
      const where = m.lines.find((l) => l.startsWith('- 住在:'));
      if (where) {
        const names = new Set(civ.polities.map((p) => polityName(p, y)));
        for (const part of where.slice('- 住在:'.length).split('、')) {
          const n = part.replace(/ \d+ 州$/, '');
          if (n !== '无主之地') expect(names.has(n)).toBe(true);
        }
      }
      // 特质:和卡片读出来的一条不差
      const tr = cultureTraits(civ, cu.id, y)!;
      for (const t of tr.traits) expect(text).toContain(`- ${t.word}:${t.why}`);
      if (tr.traits.length) expect(text).toContain(`据第 ${tr.window.from}–${tr.window.to} 年的历史`);
      // 迁徙:次数和最近一次
      const waves = cultureWaves(civ, cu.id, y);
      if (waves.length) expect(text).toContain(`成规模的迁徙 ${waves.length} 次,最近一次第 ${Math.floor(waves[waves.length - 1].year)} 年${waveText(civ, waves[waves.length - 1])}`);
      // 大事:编年史里的原句,都在这一年以前
      const evs = m.lines.filter((l) => /^- 第 \d+ 年 /.test(l));
      const all = cultureEntries(civ, cu.id).filter((e) => e.year <= y);
      expect(evs.length).toBe(Math.min(8, all.length));
      for (const l of evs) expect(all.some((e) => l === `- 第 ${Math.floor(e.year)} 年 ${e.text}`)).toBe(true);
      // 写到的年份都是真有的
      const ys = realYears(civ, cu.id, y);
      for (const mm of text.replace(/^- 第 \d+ 年 .*$/gm, '').matchAll(/第 (\d+)(?:–(\d+))? 年/g)) {
        expect(ys.has(Number(mm[1]))).toBe(true);
        if (mm[2]) expect(ys.has(Number(mm[2]))).toBe(true);
      }
    }
  });

  it('提示词:只用材料里的事实、不提现实里的东西、写第 N 年;材料本身扫不出现实里的词', () => {
    const cu = alive[0];
    const m = cultureMaterial(civ, cu.id, y)!;
    const req = customsRequest(m);
    expect(req.feature).toBe('风俗');
    expect(req.title).toBe(`${cultureLabel(cu)} · 风俗`);
    const sys = req.messages[0].content;
    expect(sys).toContain('只用材料里给出的事实');
    expect(sys).toContain('不要提现实中的');
    expect(sys).toContain('第 N 年');
    expect(sys).toContain(`${CUSTOMS_CHARS.min}–${CUSTOMS_CHARS.max} 字`);
    expect(req.messages[1].content).toContain(m.lines.join('\n'));
    const scan = customsScan(m);
    expect(scan.allowClassics).toBe(false);
    expect(scanRealWords(scan.material, scan)).toEqual([]);
  });

  it('改名不算历史改写;存的键跟着民族的稳定键', () => {
    const cu = alive[0];
    const renamed = applyNames(civ, { [cultureKey(civ, cu.id)]: '测试' });
    expect(customsStamp(renamed, cu.id)).toBe(customsStamp(civ, cu.id));
    expect(customsNoteKey(renamed, cu.id)).toBe(`风俗:${cultureKey(civ, cu.id)}`);
    expect(cultureMaterial(renamed, cu.id, y)!.lines[0]).toBe('民族:测试族');
  });

  it('已消亡的按消亡前的样子写;没能兴起的不写', () => {
    const dead = civ.cultures.find((c) => !c.unborn && c.ended !== undefined && c.ended < civ.endYear);
    if (dead) {
      const m = cultureMaterial(civ, dead.id, civ.endYear)!;
      expect(m.year).toBe(Math.floor(cultureShownYear(dead, civ.endYear)));
      expect(m.lines.join('\n')).toContain(`消亡:第 ${Math.floor(dead.ended!)} 年`);
    }
    const unborn = civ.cultures.find((c) => c.unborn);
    if (unborn) expect(cultureMaterial(civ, unborn.id, y)).toBeNull();
  });
});

describe('收拾 AI 写的', () => {
  it('去掉标题、加粗、换行', () => {
    expect(cleanCustoms('## 风俗\n**奥利亚人**世居湖滨。\n\n春分放灯。')).toBe('奥利亚人世居湖滨。春分放灯。');
    expect(cleanCustoms('风俗:奥利亚人世居湖滨。')).toBe('奥利亚人世居湖滨。');
  });
});
