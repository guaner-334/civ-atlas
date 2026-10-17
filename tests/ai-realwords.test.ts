/**
 * 现实词检查(src/ai/realWords.ts):扫得到实测里漏进来的词、材料里有的不算、中式名字由来可以引古诗文、
 * 命中的句子交给 AI 改一次换回原处、改不成就原样留着;写史书每章写完都扫
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { recentCallsInMemory, setActiveProvider, setMockResponder } from '../src/ai/client';
import { fixRealWords, parseFixed, scanRealWords } from '../src/ai/realWords';
import { buildHistoryPrompts, type HistoryOptions } from '../src/ai/prompts/history';
import { explainScan, nameMaterial } from '../src/ai/prompts/names';
import { HISTORY_KIND, writeHistory } from '../src/ai/history';

const words = (text: string, o: Parameters<typeof scanRealWords>[1] = { material: '' }) => scanRealWords(text, o).map((h) => h.word);

describe('现实词检查:扫', () => {
  it('扫得到实测里漏进来的词(拉丁、穆罕默德、古英语句子、《楚辞》)', () => {
    expect(words('右刻拉丁"信约如潮"。阿布德之孙穆罕默德继位。')).toEqual(['拉丁', '穆罕默德']);
    expect(words("'揽'取《楚辞》'揽茹蕙以掩涕'之收摄")).toEqual(['楚辞']);
    // 音译名字的名字由来:拟造的拼写可以有,一句外语不行
    const west = { material: '', allowSpelling: true };
    expect(words('拟作 Hālmeria,由 hāl- + -mer + -ia 构成。', west)).toEqual([]);
    expect(words('古谚云"Hālmeria fæst on se brōc"。', west)).toEqual(['Hālmeria fæst on se brōc']);
    expect(words('当地人叫它 Hǣl fæst。', west)).toEqual(['fæst']);
    // 史书里不该有拉丁字母写的词;"AI"这类缩写不算
    expect(words('城门上刻着 Concordia 一词。')).toEqual(['Concordia']);
    expect(words('测试用假 AI 的回复。')).toEqual([]);
  });

  it('长词里的短词不重复算;同一个词只报一次;按出现先后', () => {
    expect(words('此语近于古英语。又有人说是古英语。罗马人……')).toEqual(['古英语', '罗马']);
    expect(words('古英语之外,英语也有。')).toEqual(['古英语', '英语']);
  });

  it('材料里有的不算(推演出来的音译名常碰上"波斯""罗马")', () => {
    expect(words('兰波斯国攻罗马尼亚城。', { material: '兰波斯国 罗马尼亚城' })).toEqual([]);
    expect(words('兰波斯国攻罗马尼亚城。', { material: '兰波斯国' })).toEqual(['罗马']);
  });

  it('中式名字由来可以引一处古诗文,别的现实词照样扫;平常的话不算(尚书、据史记载、仿佛教导)', () => {
    const east = { material: '', allowClassics: true };
    expect(words('"揽"取《楚辞》之意,李白有诗。', east)).toEqual([]);
    expect(words('"揽"取《楚辞》之意,近于梵文。', east)).toEqual(['梵文']);
    expect(words('吏部尚书据史记载,仿佛教导后人。如来犯之敌。')).toEqual([]);
  });
});

describe('现实词检查:名字由来的规矩', () => {
  it('不算的词只取世界自己的材料:写法要求、语感说明里的"公元""拉丁""中世纪"照样扫', () => {
    const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed: 7 }));
    const seen = new Set<string>();
    civ.settlements.forEach((_, id) => {
      const m = nameMaterial(civ, { kind: 'settlement', id });
      const style = m?.info.style;
      if (!m || !style || seen.has(style.id)) return;
      seen.add(style.id);
      const o = explainScan(m);
      expect(o.allowSpelling).toBe(style.family === 'western' || style.id === 'frontier');
      expect(o.allowClassics).toBe(style.family === 'eastern');
      expect(words('此城建于公元 800 年,兴于中世纪。', o)).toEqual(['公元', '世纪']);
      expect(words('近于拉丁。', o)).toEqual(['拉丁']);
    });
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('现实词检查:改', () => {
  it('parseFixed:条数对得上才算;空的那句保留原句', () => {
    expect(parseFixed('{"lines":["甲。","乙。"]}', 2)).toEqual(['甲。', '乙。']);
    expect(parseFixed('好的:\n```json\n{"lines":["甲。",""]}\n```', 2)).toEqual(['甲。', null]);
    expect(parseFixed('{"lines":["甲。"]}', 2)).toBeNull();
    expect(parseFixed('不是 JSON', 1)).toBeNull();
  });

  it('只把命中的句子交给 AI,改好的换回原处,别的字和 Markdown 记号不动', async () => {
    setActiveProvider('mock');
    let sent = '';
    setMockResponder((req) => {
      sent = req.messages[1].content;
      return JSON.stringify({ lines: ['右刻古字"信约如潮"。', '阿布德之孙阿米尔继位。'] });
    });
    const n0 = recentCallsInMemory().length;
    const text = '## 本纪\n\n帝国立于第 12 年。右刻拉丁"信约如潮"。\n\n- 阿布德之孙穆罕默德继位。国势日盛。';
    const out = await fixRealWords(text, { material: '', feature: HISTORY_KIND, title: '世界通史' });
    expect(out).toBe('## 本纪\n\n帝国立于第 12 年。右刻古字"信约如潮"。\n\n- 阿布德之孙阿米尔继位。国势日盛。');
    expect(sent).toContain('「拉丁」');
    expect(sent).toContain('「穆罕默德」');
    expect(sent).not.toContain('国势日盛');
    expect(recentCallsInMemory().length - n0).toBe(1);
    expect(recentCallsInMemory()[0]).toMatchObject({ feature: HISTORY_KIND, title: '世界通史 · 改掉现实里的词' });
  });

  it('没命中不调 AI;回复对不上、出错都原样返回;取消照样抛出', async () => {
    setActiveProvider('mock');
    const n0 = recentCallsInMemory().length;
    expect(await fixRealWords('帝国立于第 12 年。', { material: '', feature: '释名' })).toBe('帝国立于第 12 年。');
    expect(recentCallsInMemory().length).toBe(n0);
    setMockResponder(() => '{"lines":[]}');
    expect(await fixRealWords('近于拉丁。', { material: '', feature: '释名' })).toBe('近于拉丁。');
    setMockResponder(() => {
      throw new Error('坏了');
    });
    expect(await fixRealWords('近于拉丁。', { material: '', feature: '释名' })).toBe('近于拉丁。');
    setMockResponder(null);
    const ctl = new AbortController();
    ctl.abort();
    await expect(fixRealWords('近于拉丁。', { material: '', feature: '释名', signal: ctl.signal })).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('现实词检查:写史书', () => {
  it('每章写完扫一遍:命中的那章多一次调用,存下来的是改过的', async () => {
    const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed: 7 }));
    setActiveProvider('mock');
    setMockResponder((req) => (req.json ? JSON.stringify({ lines: ['其后有贤王阿米尔。'] }) : `## ${req.title}\n\n诸国并立。其后有贤王穆罕默德。`));
    const o: HistoryOptions = { scope: { kind: 'world' }, style: 'classic', length: 'short' };
    const p = buildHistoryPrompts(civ, o);
    const n0 = recentCallsInMemory().length;
    const note = await writeHistory(civ, o, { world: 'w-realwords' });
    expect(recentCallsInMemory().length - n0).toBe(p.calls.length * 2);
    expect(note.text).not.toContain('穆罕默德');
    expect(note.text).toContain('其后有贤王阿米尔。');
    setMockResponder(null);
  });
});
