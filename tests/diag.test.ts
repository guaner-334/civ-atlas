/**
 * 问题记录(src/diag):记、去重、裁剪、存不下退回内存、遮掉不该带出去的字、次数统计、导出;
 * AI 调用和助手用工具顺带记一条(不带内容);意外关闭怎么认。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DIAG_KEY,
  MAX_ENTRIES,
  cleanText,
  clearDiag,
  exportDiagJson,
  getDiag,
  isProblem,
  recordDiag,
  recordError,
  setDiagScrubber,
  setDiagStorage,
  stackFrames,
  summarize,
  type DiagEntry,
  type DiagStorage,
  type DiagToolEntry,
} from '../src/diag/log';
import { crashEntry, findCrashed, type LiveMark } from '../src/diag/watch';
import { aiChat, setActiveProvider, setMockResponder } from '../src/ai/client';
import { runAgent } from '../src/ai/agent/loop';

function memStorage(opts: { failSet?: boolean } = {}) {
  const m = new Map<string, string>();
  const s: DiagStorage & { m: Map<string, string>; opts: typeof opts } = {
    m,
    opts,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.failSet) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k) => void m.delete(k),
  };
  return s;
}

let store: ReturnType<typeof memStorage>;
beforeEach(() => {
  store = memStorage();
  setDiagStorage(store);
});
afterEach(() => {
  setDiagScrubber((s) => s);
  setMockResponder(null);
  setActiveProvider(null);
});

describe('记和读', () => {
  it('记一条马上写进存储,新的在前;换个存储读回来一样', () => {
    recordDiag({ kind: 'tool', tool: 'country', ok: true, ms: 3 });
    recordDiag({ kind: 'tool', tool: 'trial', ok: false, why: 'bad-args', ms: 1 });
    expect(getDiag().entries.map((e) => (e as { tool: string }).tool)).toEqual(['trial', 'country']);
    expect(getDiag().persistent).toBe(true);
    const again = memStorage();
    again.m.set(DIAG_KEY, store.m.get(DIAG_KEY)!);
    setDiagStorage(again);
    expect(getDiag().entries).toHaveLength(2);
  });

  it('最多留 MAX_ENTRIES 条,删最旧的', () => {
    for (let i = 0; i < MAX_ENTRIES + 20; i++) recordDiag({ kind: 'tool', tool: `t${i}`, ok: true, ms: i });
    const e = getDiag().entries;
    expect(e).toHaveLength(MAX_ENTRIES);
    expect((e[0] as { tool: string }).tool).toBe(`t${MAX_ENTRIES + 19}`);
    expect(JSON.parse(store.m.get(DIAG_KEY)!)).toHaveLength(MAX_ENTRIES);
  });

  it('存不下就只记在内存里,界面照样看得到,一条也不丢', () => {
    setDiagStorage(memStorage({ failSet: true }));
    for (let i = 0; i < 20; i++) recordDiag({ kind: 'tool', tool: `t${i}`, ok: true, ms: 1 });
    expect(getDiag().entries).toHaveLength(20);
    expect(getDiag().persistent).toBe(false);
  });

  it('两个标签页轮流记:谁也不盖掉谁', () => {
    recordDiag({ kind: 'tool', tool: 'a', ok: true, ms: 1 });
    // 另一个标签页往同一个存储里记了一条
    const other = JSON.parse(store.m.get(DIAG_KEY)!);
    store.m.set(DIAG_KEY, JSON.stringify([{ kind: 'tool', tool: 'b', ok: true, ms: 1, at: new Date().toISOString() }, ...other]));
    recordDiag({ kind: 'tool', tool: 'c', ok: true, ms: 1 });
    expect(JSON.parse(store.m.get(DIAG_KEY)!).map((e: { tool: string }) => e.tool)).toEqual(['c', 'b', 'a']);
  });

  it('存的东西坏了:从空的开始', () => {
    store.m.set(DIAG_KEY, '{坏了');
    setDiagStorage(store);
    expect(getDiag().entries).toEqual([]);
    recordDiag({ kind: 'tool', tool: 'x', ok: true, ms: 1 });
    expect(JSON.parse(store.m.get(DIAG_KEY)!)).toHaveLength(1);
  });

  it('清空', () => {
    recordDiag({ kind: 'tool', tool: 'x', ok: true, ms: 1 });
    clearDiag();
    expect(getDiag().entries).toEqual([]);
    expect(JSON.parse(store.m.get(DIAG_KEY)!)).toEqual([]);
  });

  it('同一个错(说明和出错的地方都一样)10 秒内又出只记一条,次数加上', () => {
    for (let i = 0; i < 5; i++) recordError('window', 'boom', 'at f (a.js:1:2)');
    recordError('window', 'boom', 'at g (b.js:3:4)');
    recordError('window', '别的错', undefined);
    const e = getDiag().entries;
    expect(e).toHaveLength(3);
    expect((e[2] as { n?: number }).n).toBe(5);
    expect(summarize(e).errors).toBe(7);
  });
});

describe('不该带出去的字', () => {
  it('密钥、令牌、网址、本地数据遮掉,太长截断', () => {
    setDiagScrubber((s) => s.split('my-secret-key').join('***'));
    const t = cleanText(
      'failed my-secret-key sk-abcdef123456 Bearer abcdefghijklmnop1234 at https://atlas.gerdor.top/beta/assets/x.js?v=1 blob:https://a/b ' +
        'a'.repeat(400),
    );
    expect(t).not.toContain('my-secret-key');
    expect(t).not.toContain('sk-abcdef123456');
    expect(t).not.toContain('abcdefghijklmnop1234');
    expect(t).not.toContain('atlas.gerdor.top');
    expect(t).toContain('/beta/assets/x.js');
    expect(t).not.toContain('blob:');
    expect(t.length).toBeLessThanOrEqual(301);
  });

  it('调用栈只留文件名和行号', () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'name')",
      '    at Overview (https://atlas.gerdor.top/assets/index-Ab12Cd.js:1:5821)',
      '    at render@http://localhost:5173/src/ui/App.tsx?t=123:3881:7',
      '    at <anonymous>',
    ].join('\n');
    expect(stackFrames(stack)).toEqual(['index-Ab12Cd.js:1:5821', 'App.tsx:3881:7']);
  });
});

describe('次数和列出来的问题', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const at = (h: number) => new Date(now - h * 3600_000).toISOString();
  const entries: DiagEntry[] = [
    { kind: 'ai', at: at(1), feature: '写史书', provider: 'deepseek', model: 'deepseek-chat', ok: true, ms: 900 },
    { kind: 'ai', at: at(2), feature: '写史书', provider: 'deepseek', model: 'deepseek-chat', ok: false, code: 'network', ms: 60000 },
    { kind: 'ai', at: at(3), feature: '助手', provider: 'none', model: '', ok: false, code: 'not-configured', ms: 0 },
    { kind: 'ai', at: at(4), feature: '助手', provider: 'deepseek', model: 'deepseek-chat', ok: false, code: 'aborted', ms: 300 },
    { kind: 'tool', at: at(5), tool: 'country', ok: true, ms: 2 },
    { kind: 'tool', at: at(6), tool: 'country', ok: false, why: 'bad-args', ms: 1 },
    { kind: 'crash', at: at(7), started: at(8), doing: '推演历史', year: 1240 },
    { kind: 'error', at: at(24 * 8), src: 'window', message: '太早了' },
  ];

  it('最近 7 天:没设置好、自己停下的 AI 调用不算', () => {
    expect(summarize(entries, 7, now)).toEqual({ errors: 0, crashes: 1, ai: { total: 2, ok: 1 }, tools: { total: 2, ok: 1 } });
  });

  it('列出来的只有出了问题的', () => {
    expect(entries.filter(isProblem).map((e) => e.kind)).toEqual(['ai', 'tool', 'crash', 'error']);
  });

  it('导出:带版本、设备、次数和全部记录', () => {
    const j = JSON.parse(exportDiagJson({ version: '1.4.0', generator: 16, site: '测试网站', device: { cores: 8 } }, entries, new Date(now)));
    expect(j).toMatchObject({ app: '文明与地图', kind: '问题记录', version: '1.4.0', generator: 16, site: '测试网站', count: entries.length });
    expect(j.summary7d).toEqual({ errors: 0, crashes: 1, ai: [2, 1], tools: [2, 1] });
    expect(j.entries).toHaveLength(entries.length);
  });
});

describe('AI 调用和助手用工具顺带记一条', () => {
  it('记成没成功、用量,不带发出去和收到的内容', async () => {
    setActiveProvider('mock');
    setMockResponder(() => '这是 AI 写的正文');
    await aiChat({ feature: '写史书', messages: [{ role: 'user', content: '作者写的私密内容' }] });
    const e = getDiag().entries[0];
    expect(e).toMatchObject({ kind: 'ai', feature: '写史书', provider: 'mock', ok: true });
    const text = JSON.stringify(getDiag().entries);
    expect(text).not.toContain('这是 AI 写的正文');
    expect(text).not.toContain('作者写的私密内容');
  });

  it('没设置好的也记一条(只是不算进成功率)', async () => {
    await expect(aiChat({ feature: '写史书', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow();
    expect(getDiag().entries[0]).toMatchObject({ kind: 'ai', ok: false, code: 'not-configured' });
    expect(summarize(getDiag().entries).ai.total).toBe(0);
  });

  it('助手每一步记工具名和成没成功,不记参数', async () => {
    setActiveProvider('mock');
    let round = 0;
    setMockResponder(() =>
      round++ === 0
        ? {
            toolCalls: [
              { id: 'a', name: 'look', args: '{"q":"作者的秘密"}' },
              { id: 'b', name: 'look', args: '{坏的' },
              { id: 'c', name: 'nope', args: '{}' },
              { id: 'd', name: 'boom', args: '{}' },
            ],
          }
        : '好了',
    );
    await runAgent({
      feature: '助手',
      messages: [{ role: 'user', content: '查一下' }],
      tools: [
        { def: { name: 'look', description: '', parameters: { type: 'object', properties: {} } }, run: () => '查到了' },
        {
          def: { name: 'boom', description: '', parameters: { type: 'object', properties: {} } },
          run: () => {
            throw new Error('坏了');
          },
        },
      ],
    });
    const tools = getDiag()
      .entries.filter((e): e is DiagToolEntry => e.kind === 'tool')
      .reverse();
    expect(tools.map((t) => [t.tool, t.ok, t.why])).toEqual([
      ['look', true, undefined],
      ['look', false, 'bad-args'],
      ['?', false, 'no-tool'],
      ['boom', false, 'failed'],
    ]);
    expect(JSON.stringify(getDiag().entries)).not.toContain('作者的秘密');
    expect(summarize(getDiag().entries).tools).toEqual({ total: 4, ok: 1 });
  });
});

describe('意外关闭怎么认', () => {
  const mark = (seen: number, visible: boolean, over: Partial<LiveMark> = {}): LiveMark => ({ started: '2026-10-17T12:00:00.000Z', seen, visible, ...over });

  it('过一会儿再看还没动、最后在前台的才算;正常关掉的、还开着的、在后台的不算', () => {
    const before = { crashed: mark(100, true), closed: mark(100, true), alive: mark(100, true), hidden: mark(100, false), self: mark(100, true) };
    const after = { crashed: mark(100, true), alive: mark(105, true), hidden: mark(100, false), self: mark(110, true) };
    expect(findCrashed(before, after, 'self')).toEqual(['crashed']);
  });

  it('记成一条:最后听到它的时间、当时在做什么', () => {
    const e = crashEntry(mark(Date.parse('2026-10-17T12:41:03Z'), true, { doing: '推演历史', year: 1240, world: 'seed=7', heapMB: 812 }));
    expect(e).toEqual({
      kind: 'crash',
      at: '2026-10-17T12:41:03.000Z',
      started: '2026-10-17T12:00:00.000Z',
      doing: '推演历史',
      year: 1240,
      world: 'seed=7',
      heapMB: 812,
    });
  });
});

describe('界面上的说法', () => {
  it('意外关闭、出错、AI 失败、工具没用成各一句', async () => {
    const { problemText } = await import('../src/ui/DiagDialog');
    expect(problemText({ kind: 'crash', at: '2026-10-17T12:41:00Z', started: '2026-10-17T12:23:00Z', doing: '推演历史', year: 1240 })).toEqual({
      title: '意外关闭',
      line: '当时在推演历史（第 1240 年），网页开在前台，开了 18 分钟',
    });
    expect(problemText({ kind: 'error', at: 'x', src: 'window', message: 'boom', doing: '生成世界', n: 3 }).line).toBe('生成世界时：boom（连着出了 3 次）');
    expect(problemText({ kind: 'ai', at: 'x', feature: '写史书', provider: 'deepseek', model: 'm', ok: false, code: 'network', ms: 60000 }).line).toBe('写史书，DeepSeek，等了 60 秒没回');
    expect(problemText({ kind: 'ai', at: 'x', feature: '助手', provider: 'bailian', model: 'm', ok: false, code: 'quota', ms: 800 }).line).toBe('助手，阿里云百炼，余额或积分不够（800 毫秒）');
    expect(problemText({ kind: 'tool', at: 'x', tool: 'country', ok: false, why: 'bad-args', ms: 1 })).toEqual({ title: '助手用工具失败', line: '查国家：参数不是合法的 JSON' });
  });
});
