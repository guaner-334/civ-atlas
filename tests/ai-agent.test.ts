/**
 * 助手:工具调用的循环、试推演的对照、查资料 / 试推演 / 列确认单这几个工具,和一次完整的对话。
 * 全程用测试用假 AI(按剧本一轮一轮回),不联网;试推演在 Node 里真的重推历史(种子 7)。
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ } from '../src/gen/civ/types';
import { ownersAt } from '../src/gen/civ/timeline';
import { applyNames, polityKey, type WorldEdits } from '../src/gen/edits';
import { setActiveProvider, setMockResponder } from '../src/ai/client';
import { AiError, type AiRequest } from '../src/ai/types';
import { AGENT_MAX_ROUNDS, TOOL_RESULT_MAX, parseToolArgs, runAgent, type AgentEvent, type AgentTool, type AgentToolResult } from '../src/ai/agent/loop';
import { compareTrial, fateText, trialText } from '../src/ai/agent/trial';
import {
  ASSISTANT_FEATURE,
  ASSISTANT_SYSTEM,
  TRIAL_MAX,
  assistantMessages,
  assistantTools,
  polityOf,
  runAssistant,
  type AssistantContext,
  type AssistantProposal,
  type AssistantTrial,
} from '../src/ai/agent/assistant';
import { REWRITE_OPS, REWRITE_SYSTEM, bordersAt, nameAt } from '../src/ai/prompts/rewrite';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const civ = generateCiv(world);
const EMPTY: WorldEdits = { names: {}, interventions: [], terrain: [] };
/** 真的重推一遍(和界面里交给 worker 的一样:干预重推,再套上改名) */
const simulate = async (e: WorldEdits): Promise<Civ> => applyNames(generateCiv(world, e.interventions.length ? { interventions: e.interventions } : undefined), e.names);
const ctx = (over: Partial<AssistantContext> = {}): AssistantContext => ({ world, civ, year: 2000, edits: EMPTY, simulate, ...over });

// ---- 这份历史里的角色:最晚一个被灭的国家(亡国前 30 年起保护它),和它那时的一个邻国(拉来结盟) ----
const fall = [...civ.annals].reverse().find((e) => e.kind === 'fall' && e.b >= 0 && e.a >= 0 && civ.polities[e.a].founded < Math.floor(e.year) - 40)!;
const victim = fall.a;
const conqueror = fall.b;
const from = Math.floor(fall.year) - 30;
const vName = nameAt(civ.polities[victim], from);
const ownFrom = ownersAt(civ, from).polity;
const friend =
  [...bordersAt(civ, ownFrom, victim)].find((q) => q !== conqueror) ??
  civ.polities.find((p) => p.id !== victim && p.id !== conqueror && p.founded <= from && (p.ended === undefined || p.ended > from))!.id;
const PROTECT = { op: 'protect', country: `P${victim}`, from, why: '国都攻不下' };
const ALLY = { op: 'ally', country: `P${victim}`, other: `P${friend}`, from, why: '找个帮手' };

/** 工具交回模型的那段文字 */
const said = async (r: Promise<string | AgentToolResult> | string | AgentToolResult): Promise<string> => {
  const v = await r;
  return typeof v === 'string' ? v : v.result;
};

/** 假 AI 按剧本一轮一轮回(字符串 = 只回话;calls = 要调用的工具 [名字, 参数]);记下每一轮收到的请求 */
type Round = string | { text?: string; calls: [string, unknown][] };
function script(...rounds: Round[]): AiRequest[] {
  const seen: AiRequest[] = [];
  let i = 0;
  setMockResponder((req) => {
    seen.push(structuredClone(req));
    const n = i++;
    const r = rounds[Math.min(n, rounds.length - 1)];
    if (typeof r === 'string') return r;
    return { text: r.text, toolCalls: r.calls.map(([name, args], k) => ({ id: `call_${n}_${k}`, name, args: typeof args === 'string' ? args : JSON.stringify(args) })) };
  });
  return seen;
}

beforeAll(() => {
  setActiveProvider('mock');
});

afterEach(() => {
  setMockResponder(null);
});

describe('助手的循环', () => {
  const echo: AgentTool = {
    def: { name: 'echo', description: '原样说回来', parameters: { type: 'object', properties: { x: { type: 'number' } } } },
    label: (a) => `回声 ${a.x}`,
    run: (a) => `收到 ${a.x}`,
  };
  const boom: AgentTool = {
    def: { name: 'boom', description: '一定出错', parameters: { type: 'object', properties: {} } },
    run: () => {
      throw new Error('坏了');
    },
  };
  const long: AgentTool = {
    def: { name: 'long', description: '回一大段', parameters: { type: 'object', properties: {} } },
    run: () => 'x'.repeat(TOOL_RESULT_MAX + 500),
  };

  it('模型调工具 → 网页执行 → 结果按调用编号交回 → 模型回话;参数不合法、没有这个工具、执行出错都把原因交回,不中断', async () => {
    const seen = script({ text: '我先查一下。', calls: [['echo', { x: 1 }], ['nope', {}], ['echo', '{bad'], ['boom', {}], ['long', {}]] }, '查好了。');
    const events: AgentEvent[] = [];
    const out = await runAgent({
      feature: '测试',
      messages: [{ role: 'user', content: '帮我查查' }],
      tools: [echo, boom, long],
      onEvent: (e) => events.push(e),
    });
    expect(out.text).toBe('查好了。');
    expect(out.end).toBe('done');
    expect(out.rounds).toBe(2);
    expect(out.steps.map((s) => [s.tool, s.state])).toEqual([
      ['echo', 'ok'],
      ['nope', 'error'],
      ['echo', 'error'],
      ['boom', 'error'],
      ['long', 'ok'],
    ]);
    expect(out.steps[0]).toMatchObject({ id: 's1', label: '回声 1', result: '收到 1', args: { x: 1 } });
    expect(out.steps[1].result).toContain('echo、boom、long');
    expect(out.steps[2].result).toContain('JSON');
    expect(out.steps[3].result).toBe('出错了:坏了');
    expect(out.steps[4].result!.length).toBeLessThan(TOOL_RESULT_MAX + 50);
    // 第一轮:带上工具,模型自己决定调不调
    expect(seen[0].tools!.map((t) => t.name)).toEqual(['echo', 'boom', 'long']);
    expect(seen[0].toolChoice).toBe('auto');
    expect(seen[0].feature).toBe('测试');
    // 第二轮:模型上一轮的话和调用原样放回,后面每个调用一条结果(对得上调用编号)
    const m = seen[1].messages;
    expect(m[1]).toMatchObject({ role: 'assistant', content: '我先查一下。' });
    expect(m[1].toolCalls!.map((c) => c.id)).toEqual(['call_0_0', 'call_0_1', 'call_0_2', 'call_0_3', 'call_0_4']);
    expect(m.slice(2).map((x) => [x.role, x.toolCallId])).toEqual([
      ['tool', 'call_0_0'],
      ['tool', 'call_0_1'],
      ['tool', 'call_0_2'],
      ['tool', 'call_0_3'],
      ['tool', 'call_0_4'],
    ]);
    expect(m[2].content).toBe('收到 1');
    // 整段对话最后是模型的回话
    expect(out.messages[out.messages.length - 1]).toEqual({ role: 'assistant', content: '查好了。' });
    // 事件:每一轮开头、每一步开始和做完、模型正在说的话
    expect(events.filter((e) => e.type === 'round').map((e) => (e as { round: number }).round)).toEqual([0, 1]);
    expect(events.filter((e) => e.type === 'step')).toHaveLength(5);
    const done = events.filter((e): e is Extract<AgentEvent, { type: 'step-done' }> => e.type === 'step-done');
    expect(done.map((e) => e.step.state)).toEqual(['ok', 'error', 'error', 'error', 'ok']);
    expect(events.filter((e) => e.type === 'text').pop()).toEqual({ type: 'text', text: '查好了。' });
    expect(out.usage.inputTokens).toBeGreaterThan(0);
  });

  it('到了轮数上限:最后一轮不许再调工具,拿它说的话收尾', async () => {
    const seen = script({ text: '再查查。', calls: [['echo', { x: 2 }]] });
    const out = await runAgent({ feature: '测试', messages: [{ role: 'user', content: '查个没完' }], tools: [echo], maxRounds: 3 });
    expect(seen.map((r) => r.toolChoice)).toEqual(['auto', 'auto', 'none']);
    expect(out.end).toBe('rounds');
    expect(out.rounds).toBe(3);
    expect(out.steps).toHaveLength(2);
    expect(out.text).toBe('再查查。');
    expect(AGENT_MAX_ROUNDS).toBeGreaterThanOrEqual(6);
  });

  it('停下:工具执行时停下 → aborted,不再问 AI', async () => {
    const ac = new AbortController();
    const seen = script({ calls: [['stop', {}], ['echo', { x: 3 }]] }, '不该到这里');
    const stop: AgentTool = {
      def: { name: 'stop', description: '', parameters: { type: 'object', properties: {} } },
      run: () => {
        ac.abort();
        return '停';
      },
    };
    const e = (await runAgent({ feature: '测试', messages: [{ role: 'user', content: '…' }], tools: [stop, echo], signal: ac.signal }).catch((x) => x)) as AiError;
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe('aborted');
    expect(seen).toHaveLength(1);
  });

  it('参数原文:空 = {};不是 JSON 对象 = null', () => {
    expect(parseToolArgs('')).toEqual({});
    expect(parseToolArgs(' {"a":1} ')).toEqual({ a: 1 });
    expect(parseToolArgs('[1]')).toBeNull();
    expect(parseToolArgs('{"a":')).toBeNull();
  });
});

describe('试推演的对照', () => {
  it('同一份历史:什么都没变', () => {
    const d = compareTrial(civ, civ, [victim], from);
    expect(d.focus).toHaveLength(1);
    expect(d.focus[0].who).toEqual({ id: victim, name: vName });
    expect(d.focus[0].after).toEqual(d.focus[0].before);
    expect(d.focus[0].before).toMatchObject({ end: Math.floor(civ.polities[victim].ended!), way: 'fall', by: { id: conqueror } });
    expect(d.others).toEqual([]);
    expect(d.addedCount + d.removedCount).toBe(0);
    expect(d.alive[0]).toBe(d.alive[1]);
    expect(trialText(d)).toContain('大事没有变化');
  });

  it('保护一个原本被灭的国家:试推演里它活到最后,它被灭的那条大事不再发生', async () => {
    const after = generateCiv(world, { interventions: [{ kind: 'protect', a: polityKey(civ, victim), from }] });
    const d = compareTrial(civ, after, [victim], from);
    const f = d.focus[0];
    expect(f.before!.end).toBe(Math.floor(civ.polities[victim].ended!));
    expect(f.after).not.toBeNull();
    expect(f.after!.end).toBeUndefined();
    expect(f.after!.size).toBeGreaterThan(0);
    expect(d.removedCount).toBeGreaterThan(0);
    expect(d.removed.length).toBeLessThanOrEqual(10);
    // 从 from 年起才不一样:别的国家里变化大的都是 from 年时还在、或之后才立的
    for (const c of d.others) if (c.who.id >= 0) expect(civ.polities[c.who.id].ended === undefined || civ.polities[c.who.id].ended! > from).toBe(true);
    const t = trialText(d);
    expect(t).toContain(`P${victim} ${vName}`);
    expect(t).toContain(`到第 ${civ.endYear} 年仍在`);
    expect(fateText(f.before, civ.endYear)).toMatch(/^第 \d+ 年被 P\d+ .+ 所灭\(亡国前 \d+ 州\)$/);
  });
});

describe('助手', () => {
  it('查 → 试推演两次 → 列确认单 → 回话:确认单附上同一批的试推演结果;每一步一句话', async () => {
    const seen = script(
      { calls: [['country', { country: `P${victim}` }]] },
      { text: '先试试只保护。', calls: [['try_edits', { edits: [PROTECT] }]] },
      { calls: [['try_edits', { edits: [PROTECT, ALLY] }]] },
      { calls: [['propose_edits', { edits: [PROTECT, ALLY], cannot: ['规定谁打赢做不到'] }]] },
      '试推演里它撑到了最后。',
    );
    const steps: string[] = [];
    const r = await runAssistant(ctx(), [], `让${vName}撑到最后`, { onEvent: (e) => e.type === 'step-done' && steps.push(e.step.label) });
    expect(r.text).toBe('试推演里它撑到了最后。');
    expect(r.end).toBe('done');
    expect(steps).toEqual([`查国家：${nameAt(civ.polities[victim], 2000)}`, `试推演：第 ${from} 年起保护${vName}`, expect.stringMatching(/^试推演：保护.+，再和.+结盟$/), '列出要改的 2 条']);
    expect(r.steps.every((s) => s.state === 'ok')).toBe(true);
    // 每一步下面一句给作者看的结果
    expect(r.steps[0].summary).toMatch(/^第 \d+ 年立国；/);
    expect(r.steps[1].summary).toBe(`${vName}撑到了第 ${civ.endYear} 年，最后 ${r.trials[0].diff.focus[0].after!.size} 州`);

    // 第一轮:提示词、材料、作者的话、五个工具
    expect(seen[0].feature).toBe(ASSISTANT_FEATURE);
    expect(seen[0].messages[0]).toEqual({ role: 'system', content: ASSISTANT_SYSTEM });
    expect(seen[0].messages[1].content).toContain('# 这个世界');
    expect(seen[0].messages[1].content).toMatch(new RegExp(`# 作者这次说\\n让${vName}撑到最后$`));
    expect(seen[0].tools!.map((t) => t.name)).toEqual(['country', 'chronicle', 'situation', 'try_edits', 'propose_edits']);
    // 查国家的结果交回去了
    expect(seen[1].messages[seen[1].messages.length - 1]).toMatchObject({ role: 'tool', toolCallId: 'call_0_0' });
    expect(seen[1].messages[seen[1].messages.length - 1].content).toContain(`P${victim} `);
    // 试推演的结果交回去了
    const t1 = seen[2].messages[seen[2].messages.length - 1].content;
    expect(t1).toContain('第 1 次试推演(没有执行)');
    expect(t1).toContain(`P${victim} ${vName}:现在 第 `);

    // 两次试推演都记下了:保护以后它活到最后
    expect(r.trials.map((t) => t.n)).toEqual([1, 2]);
    expect(r.trials[0].diff.focus[0].after!.end).toBeUndefined();
    expect(r.trials[1].diff.focus.map((f) => f.who.id).sort((a, b) => a - b)).toEqual([victim, friend].sort((a, b) => a - b));
    expect(r.trials[1].edits.interventions).toHaveLength(2);
    // 确认单:两条都能执行,附上第 2 次试推演(同一批修改),做不到的照抄
    const p = r.proposal!;
    expect(p.items.map((it) => it.change?.kind)).toEqual(['intervention', 'intervention']);
    expect(p.cannot).toEqual(['规定谁打赢做不到']);
    expect(p.trial).toBe(r.trials[1]);
    // 作者的世界没动
    expect(ctx().edits).toBe(EMPTY);
  });

  it('列确认单:没试过的顺带试推演一次;有地形修改的不附结果;再列一次换掉上一张;试推演次数有上限', async () => {
    let runs = 0;
    const fast = async () => {
      runs++;
      return civ;
    };
    const state: { trials: AssistantTrial[]; proposal: AssistantProposal | null } = { trials: [], proposal: null };
    const tools = Object.fromEntries(assistantTools(ctx({ simulate: fast }), state).map((t) => [t.def.name, t]));
    const r1 = await said(tools.propose_edits.run({ edits: [PROTECT] }));
    expect(runs).toBe(1);
    expect(state.proposal!.trial!.n).toBe(0);
    expect(r1).toContain('顺带试推演了一次');
    expect(state.trials).toHaveLength(0);

    const r2 = await said(tools.propose_edits.run({ edits: [{ op: 'volcano', at: [10, 10], size: '中', why: '…' }] }));
    expect(runs).toBe(1);
    expect(state.proposal!.trial).toBeUndefined();
    expect(r2).toContain('已换掉上一张');

    // 只有改名:不用试推演
    const rn = await said(tools.try_edits.run({ edits: [{ op: 'rename', target: `P${victim}`, name: '阿尔瑟', why: '…' }] }));
    expect(rn).toContain('不用试推演');
    // 不合格的修改:原因交回去
    const bad = await said(tools.try_edits.run({ edits: [{ op: 'protect', country: 'P99999', from, why: '…' }] }));
    expect(bad).toContain('不合格');
    expect(runs).toBe(1);

    for (let i = 0; i < TRIAL_MAX; i++) await tools.try_edits.run({ edits: [PROTECT] });
    expect(state.trials.map((t) => t.n)).toEqual(Array.from({ length: TRIAL_MAX }, (_, i) => i + 1));
    await expect(Promise.resolve().then(() => tools.try_edits.run({ edits: [PROTECT] }))).rejects.toThrow(`用了 ${TRIAL_MAX} 次`);
    // 不能试推演的地方(没给 simulate)
    const noSim = Object.fromEntries(assistantTools(ctx({ simulate: undefined }), { trials: [], proposal: null }).map((t) => [t.def.name, t]));
    await expect(Promise.resolve().then(() => noSim.try_edits.run({ edits: [PROTECT] }))).rejects.toThrow('不能试推演');
    const r3 = await said(noSim.propose_edits.run({ edits: [PROTECT] }));
    expect(r3).not.toContain('试推演');
  });

  it('查资料:国家用编号或国名都能查,找不到的说找不到;编年史按年份和国家筛;某一年的格局', async () => {
    const tools = Object.fromEntries(assistantTools(ctx(), { trials: [], proposal: null }).map((t) => [t.def.name, t]));
    const c = await said(tools.country.run({ country: `P${victim}` }));
    expect(c.split('\n')[0]).toMatch(new RegExp(`^P${victim} `));
    expect(c).toContain('国都:');
    expect(c).toMatch(/国土:.*最盛约第 \d+ 年 \d+ 州/);
    expect(c).toMatch(new RegExp(`结局:第 \\d+ 年被 P${conqueror} .+ 所灭`));
    expect(await said(tools.country.run({ country: vName }))).toBe(c);
    expect(await said(tools.country.run({ country: '不存在的国' }))).toContain('找不到');

    const ch = await said(tools.chronicle.run({ country: `P${victim}`, from, to: civ.endYear, all: true }));
    expect(ch.split('\n')[0]).toContain(`和 P${victim} `);
    expect(ch).toContain(`〔`);
    for (const line of ch.split('\n').slice(1)) {
      const y = Number(/第 (\d+)/.exec(line)![1]);
      const end = Number(/第 \d+(?:—(\d+))? 年/.exec(line)![1] ?? y);
      expect(end).toBeGreaterThanOrEqual(from);
    }
    expect(tools.chronicle.label!({ country: `P${victim}`, from: 100, to: 200 })).toBe(`查编年史：${nameAt(civ.polities[victim], 2000)}，第 100—200 年`);

    const s = await said(tools.situation.run({ year: from }));
    expect(s.split('\n')[0]).toMatch(new RegExp(`^第 ${from} 年在世的国家 \\d+ 个`));
    expect(s).toContain(`P${victim} ${vName}`);
  });

  it('提示词:改写的提示词带的修改写法和助手的是同一份;前几轮带上执行没执行', () => {
    expect(REWRITE_SYSTEM).toContain(REWRITE_OPS);
    expect(ASSISTANT_SYSTEM).toContain(REWRITE_OPS);
    const m = assistantMessages(ctx(), [{ ask: '让它多撑三百年', reply: '好的', items: ['某国:保护'], applied: true }, { ask: '大昌在哪' }], '再让它结个盟');
    expect(m).toHaveLength(2);
    const u = m[1].content;
    expect(u).toContain('# 之前的对话');
    expect(u).toContain('作者:让它多撑三百年\n你:好的(列的修改:某国:保护—— 作者执行了)');
    expect(u).toContain('作者:大昌在哪');
    expect(u.endsWith('# 作者这次说\n再让它结个盟')).toBe(true);
  });

  it('国家的叫法:编号、数字、国名都认', () => {
    expect(polityOf(civ, `P${victim}`)).toBe(victim);
    expect(polityOf(civ, `p${victim}`)).toBe(victim);
    expect(polityOf(civ, String(victim))).toBe(victim);
    expect(polityOf(civ, victim)).toBe(victim);
    expect(polityOf(civ, vName)).toBe(victim);
    expect(polityOf(civ, 'P99999')).toBe(-1);
    expect(polityOf(civ, '')).toBe(-1);
    expect(polityOf(civ, null)).toBe(-1);
  });
});
