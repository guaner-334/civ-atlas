/**
 * 宗教卡片里的"讲讲教义"(src/ai/prompts/doctrine.ts、src/ai/writeup.ts):发给 AI 的材料只用世界里的真事实
 * (教名、类型、创教者、圣城、传播的大事、分出的教派、信众和国教都和历史对得上,年份都是真有的,时间轴那一年以后的不提),
 * 提示词说清只用材料、教派写和本教哪里不同;民间信仰没有这一项;改名不算历史改写、存的键跟着稳定键走;
 * 用测试用的假 AI 走一遍写、收拾、扫现实里的词、存进本地。不调真 AI。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Faith } from '../src/gen/civ/types';
import { polityAlive, polityName } from '../src/gen/civ/growth';
import { faithCounts } from '../src/gen/civ/religion';
import { FORM_NOTE, faithEventText } from '../src/gen/civ/story/religionText';
import { applyNames, faithKey } from '../src/gen/edits';
import {
  DOCTRINE_CHARS,
  cleanDoctrine,
  doctrineJob,
  doctrineNoteKey,
  doctrineRequest,
  doctrineScan,
  doctrineStamp,
  faithMaterial,
} from '../src/ai/prompts/doctrine';
import { runWriteup } from '../src/ai/writeup';
import { setActiveProvider, setMockResponder } from '../src/ai/client';
import { getNote } from '../src/ai/library';
import { AiError, type AiRequest } from '../src/ai/types';
import { scanRealWords } from '../src/ai/realWords';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed }))));
  return c;
}

/** 材料里出现的"第 N 年"都是这一教(连同本教、教派)真有的年份 */
function realYears(civ: Civ, f: Faith, y: number): Set<number> {
  const rel = civ.religion!;
  const ys = new Set<number>([y]);
  const fam = (x: Faith) => x.id === f.id || x.id === f.parent || x.parent === f.id || (f.parent !== undefined && x.parent === f.parent);
  for (const x of rel.faiths) {
    if (!fam(x)) continue;
    if (x.founded !== undefined) ys.add(Math.floor(x.founded));
    if (x.founder) {
      ys.add(Math.floor(x.founder.born));
      ys.add(Math.floor(x.founder.died));
    }
  }
  for (const e of rel.events) if (fam(rel.faiths[e.faith])) ys.add(Math.floor(e.year));
  for (const s of rel.states) if (fam(rel.faiths[s.faith])) ys.add(Math.floor(s.from));
  return ys;
}

describe.each([7, 2024])('教义的材料 · seed=%i', (seed) => {
  const civ = civOf(seed);
  const rel = civ.religion!;
  const y = Math.floor(civ.endYear * 0.85);
  const shown = rel.faiths.filter((f) => f.kind !== 'folk' && (f.founded ?? 0) < y);

  it('只用世界里的真事实:教名、类型、创教者、圣城、传播、教派、信众、国教;那一年以后的不提', () => {
    expect(shown.filter((f) => f.kind === 'great').length).toBeGreaterThan(1);
    for (const f of shown) {
      const m = faithMaterial(civ, f.id, y)!;
      const text = m.lines.join('\n');
      expect(m.year).toBe(y);
      expect(m.kind).toBe(f.kind);
      expect(m.shown).toBe(f.name);
      expect(m.lines[0]).toBe(`${f.kind === 'great' ? '宗教' : '教派'}:${f.name}`);
      if (f.form) expect(text).toContain(`类型:${f.form}(${FORM_NOTE[f.form]})`);
      const parent = f.parent !== undefined ? rel.faiths[f.parent] : undefined;
      const holy = civ.settlements[(parent ?? f).holy!];
      if (f.kind === 'great') {
        expect(text).toContain(`创立:第 ${Math.floor(f.founded!)} 年,${f.founder!.name}`);
        expect(text).toContain(`创于${holy.name}`);
        expect(text).toContain(`圣城:${holy.name}`);
      } else {
        expect(text).toContain(`本教:${parent!.name}(`);
        expect(text).toContain(`分出:第 ${Math.floor(f.founded!)} 年,`);
        const schism = rel.events.find((e) => e.kind === 'schism' && e.faith === f.id)!;
        expect(text).toContain(faithEventText(civ, schism));
      }
      // 大事:宗教大事的原句,都在这一年以前,都是这一教(大教连同分出的教派)的
      const evs = m.lines.filter((l) => /^- 第 \d+ 年 /.test(l));
      const mine = rel.events.filter((e) => e.year <= y && (e.faith === f.id || rel.faiths[e.faith].parent === (parent ?? f).id));
      for (const l of evs) expect(mine.some((e) => l === `- 第 ${Math.floor(e.year)} 年 ${faithEventText(civ, e)}`)).toBe(true);
      // 那一年还没分出的教派不提
      for (const x of rel.faiths) if (x.kind === 'sect' && (x.founded ?? 0) > y) expect(text).not.toContain(x.name);
      // 信众几州、奉为国教的国家:和卡片同一份数
      expect(text).toContain(`- 信众 ${faithCounts(civ, y).n[f.id]} 州`);
      const states = rel.states.filter((s) => s.faith === f.id && s.from <= y && (s.until === undefined || s.until > y) && polityAlive(civ.polities[s.polity], y));
      if (states.length) expect(text).toContain(`- 奉为国教的国家:${states.sort((a, b) => a.from - b.from || a.polity - b.polity).map((s) => polityName(civ.polities[s.polity], y)).join('、')}`);
      else expect(text).toContain('- 这一年没有国家奉它为国教');
      // 信众多在的国家都是这一年真有的国
      const where = m.lines.find((l) => l.startsWith('- 信众多在:'));
      if (where) {
        const names = new Set(civ.polities.filter((p) => polityAlive(p, y)).map((p) => polityName(p, y)));
        for (const part of where.slice('- 信众多在:'.length).split('、')) {
          const n = part.replace(/ \d+ 州$/, '');
          if (n !== '无主之地') expect(names.has(n)).toBe(true);
        }
      }
      // 写到的年份都是真有的
      const ys = realYears(civ, f, y);
      for (const mm of text.matchAll(/第 (\d+)(?:–(\d+))? 年/g)) {
        expect(ys.has(Number(mm[1]))).toBe(true);
        if (mm[2]) expect(ys.has(Number(mm[2]))).toBe(true);
      }
    }
  });

  it('民间信仰没有这一项;还没创立(分出)的按创立那年写', () => {
    const folk = rel.faiths.find((f) => f.kind === 'folk')!;
    expect(faithMaterial(civ, folk.id, y)).toBeNull();
    expect(doctrineJob(civ, folk.id, y, 'w')).toBeNull();
    const late = rel.faiths.find((f) => f.kind === 'great')!;
    const m = faithMaterial(civ, late.id, late.founded! - 100)!;
    expect(m.year).toBe(Math.floor(late.founded!));
    expect(m.lines.join('\n')).not.toContain('【分出的教派');
  });

  it('提示词:只用材料里的事实、不提现实里的东西、写第 N 年;教派写和本教哪里不同;材料本身扫不出现实里的词', () => {
    for (const f of shown) {
      const m = faithMaterial(civ, f.id, y)!;
      const req = doctrineRequest(m);
      expect(req.feature).toBe('教义');
      expect(req.title).toBe(`${f.name} · 教义`);
      const sys = req.messages[0].content;
      expect(sys).toContain('只用材料里给出的事实');
      expect(sys).toContain('不要提现实中的');
      expect(sys).toContain('第 N 年');
      expect(sys).toContain(`${DOCTRINE_CHARS.min}–${DOCTRINE_CHARS.max} 字`);
      if (f.kind === 'sect') expect(sys).toContain('和本教哪里不同');
      else expect(sys).toContain('怎么传开');
      expect(req.messages[1].content).toContain(m.lines.join('\n'));
      const scan = doctrineScan(m);
      expect(scan.allowClassics).toBe(false);
      expect(scanRealWords(scan.material, scan)).toEqual([]);
    }
  });

  it('改名不算历史改写;存的键跟着信仰的稳定键;各教的指纹各不相同', () => {
    const f = shown[0];
    const renamed = applyNames(civ, { [faithKey(civ, f.id)]: '测试教' });
    expect(doctrineStamp(renamed, f.id)).toBe(doctrineStamp(civ, f.id));
    expect(doctrineNoteKey(renamed, f.id)).toBe(`教义:${faithKey(civ, f.id)}`);
    expect(faithMaterial(renamed, f.id, y)!.lines[0]).toBe(`${f.kind === 'great' ? '宗教' : '教派'}:测试教`);
    expect(new Set(shown.map((x) => doctrineStamp(civ, x.id))).size).toBe(shown.length);
  });
});

describe('用测试用的假 AI 写一段、存进本地', () => {
  const civ = civOf(7);
  const rel = civ.religion!;
  const y = Math.floor(civ.endYear * 0.85);
  const great = rel.faiths.find((f) => f.kind === 'great' && f.founded! < y)!;
  let asked: AiRequest[] = [];
  beforeEach(() => {
    asked = [];
    setActiveProvider('mock');
  });
  afterEach(() => {
    setMockResponder(null);
    setActiveProvider(null);
  });

  it('发出去的是这一教的材料;写好的收拾干净(段落留着)、带指纹和年份存进本地', async () => {
    setMockResponder((req) => {
      asked.push(req);
      return `## 教义\n**${great.name}**拜众神。\n\n　　信徒一生要朝圣一回。\n后来往远处传开。`;
    });
    const world = 'w-doctrine-1';
    const job = doctrineJob(civ, great.id, y, world)!;
    const seen: string[] = [];
    const note = await runWriteup(job, { onDelta: (full) => seen.push(full) });
    expect(asked).toHaveLength(1);
    expect(asked[0].feature).toBe('教义');
    expect(asked[0].messages[1].content).toContain(faithMaterial(civ, great.id, y)!.lines.join('\n'));
    expect(seen.length).toBeGreaterThan(1);
    const text = `${great.name}拜众神。\n信徒一生要朝圣一回。\n后来往远处传开。`;
    expect(note.text).toBe(text);
    expect(getNote(world, doctrineNoteKey(civ, great.id))).toMatchObject({
      kind: '教义',
      title: `${great.name} · 教义`,
      text,
      provider: 'mock',
      stamp: doctrineStamp(civ, great.id),
      year: y,
    });
  });

  it('写出现实里的神名:那一句让 AI 改一次再存', async () => {
    setMockResponder((req) => {
      asked.push(req);
      return req.json ? JSON.stringify({ lines: ['信徒供奉众神。'] }) : `${great.name}讲各安其位。信徒供奉弥勒。`;
    });
    const world = 'w-doctrine-2';
    await runWriteup(doctrineJob(civ, great.id, y, world)!);
    expect(asked).toHaveLength(2);
    expect(asked[1].messages.map((x) => x.content).join('\n')).toContain('弥勒');
    expect(getNote(world, doctrineNoteKey(civ, great.id))!.text).toBe(`${great.name}讲各安其位。信徒供奉众神。`);
  });

  it('取消了不存', async () => {
    setMockResponder(() => '一段写不完的教义。'.repeat(20));
    const world = 'w-doctrine-3';
    const c = new AbortController();
    const run = runWriteup(doctrineJob(civ, great.id, y, world)!, { signal: c.signal, onDelta: () => c.abort() });
    await expect(run).rejects.toBeInstanceOf(AiError);
    expect(getNote(world, doctrineNoteKey(civ, great.id))).toBeUndefined();
  });
});

describe('收拾 AI 写的', () => {
  it('去掉标题、加粗、空行和段首空格,段与段之间留一个换行', () => {
    expect(cleanDoctrine('## 教义\n**某教**拜众神。\n\n　　春祭田神。\n')).toBe('某教拜众神。\n春祭田神。');
    expect(cleanDoctrine('教义:某教拜众神。')).toBe('某教拜众神。');
  });
});
