/**
 * 插件隔离自检页:原始结果判成九行、认浏览器、页面的内容安全策略。真在浏览器里查的在 scripts/sandbox-self-check.ts。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeDevice } from '../src/plugin/selfCheck/device';
import { batteryCode } from '../src/plugin/selfCheck/probes';
import { NET_WAYS, report, STOP_CASES, summary, verdict, type Outcome, type Raw } from '../src/plugin/selfCheck/verdict';

const ROOT = path.resolve(__dirname, '..');
const LABELS = [
  '联网（14 种办法）',
  '网站存的世界、密钥',
  '从一串字变出代码',
  '跟网站页面、别的插件传话',
  '视频通话的通道',
  '小屋自己跳走、弹新窗口',
  '出错、乱发话、死循环（8 种）',
  '插件死循环时界面卡不卡',
  '递进去 3.6 万地块',
];

function outcomes(over: Record<string, string> = {}): Outcome[] {
  const base: Record<string, string> = {
    where: 'worker',
    origin: 'null',
    'typeof document': 'undefined',
    'typeof Worker': 'undefined',
    'typeof RTCPeerConnection': 'undefined',
    indexedDB: 'err:SecurityError:denied',
    caches: 'ok:keys 0',
    opfs: 'err:SecurityError:denied',
    localStorage: 'err:ReferenceError:localStorage is not defined',
    eval: 'err:EvalError:csp',
    'new Function': 'err:EvalError:csp',
    'setTimeout(string)': 'ok:no',
    WebAssembly: 'err:CompileError:csp',
    BroadcastChannel: 'ok:posted',
    ...Object.fromEntries(NET_WAYS.map((n) => [n, 'err:TypeError:Failed to fetch'])),
    sendBeacon: 'ok:no sendBeacon',
    WebTransport: 'ok:no WebTransport',
  };
  return Object.entries({ ...base, ...over }).map(([name, outcome]) => ({ name, outcome }));
}

function passing(over: Partial<Raw> = {}): Raw {
  return {
    escapedTop: false,
    battery: { readyMs: 20, stoppedBefore: null, results: outcomes(), heard: [], framesLeft: 0 },
    isolation: { aHeard: ['from-a-itself'], hostHeard: [] },
    echo: { s: 36_000, n: 36_000, backIsArray: true, detached: true, ms: 2.3, errorReply: 'd.a is not iterable', uncloneable: 'DataCloneError, still running', early: true, stopped: 'stopped', afterStop: 'stopped', framesLeft: 0 },
    stops: Object.fromEntries(Object.entries(STOP_CASES).map(([k, reason]) => [k, { reason, detail: '', ms: 100, framesLeft: 0 }])),
    spin: { reason: 'unresponsive', stopped: 'unresponsive', maxGapMs: 18, framesLeft: 0 },
    nav: { ran: ['link', 'open', 'refresh', 'self', 'top'], blocked: ['link', 'refresh', 'self'], open: 'null', top: 'SecurityError', loads: {} },
    ...over,
  };
}

const row = (raw: Raw, i: number) => verdict(raw)[i];
const when = new Date(2026, 10, 7, 14, 20);

describe('判成九行', () => {
  it('九行的名字和先后', () => {
    expect(verdict({ escapedTop: false }).map((r) => r.label)).toEqual(LABELS);
    expect(NET_WAYS).toHaveLength(14);
    expect(Object.keys(STOP_CASES)).toHaveLength(8);
  });

  it('都过了:右边那几个字', () => {
    const rows = verdict(passing());
    expect(rows.map((r) => r.state)).toEqual(Array(9).fill('ok'));
    expect(rows.map((r) => r.result)).toEqual(['都挡住了', '碰不到', '拦住了', '都不通', '小屋里没有', '都没成', '都停下了', '最长隔 18 毫秒', '3 毫秒']);
    expect(summary(rows, when)).toEqual({ state: 'ok', title: '全部通过', note: '插件关在小屋里：碰不到网站存的东西，也连不了网。11 月 7 日 14:20 查的' });
  });

  it('还没查完的行在转圈,结论是正在查', () => {
    const rows = verdict({ escapedTop: false, battery: passing().battery });
    expect(rows.map((r) => r.state)).toEqual(['ok', 'ok', 'ok', 'run', 'ok', 'run', 'run', 'run', 'run']);
    expect(summary(rows, null).state).toBe('run');
  });

  it('视频通话的通道小屋里能用', () => {
    const rows = verdict(passing({ battery: { readyMs: 20, stoppedBefore: null, results: outcomes({ 'typeof RTCPeerConnection': 'function' }), heard: [], framesLeft: 0 } }));
    expect(rows[4]).toMatchObject({ state: 'bad', result: '小屋里能用', why: '插件可能借这个通道往外发数据。开发修好以前，这个浏览器里先别装没审核的插件。' });
    expect(summary(rows, when)).toEqual({ state: 'bad', title: '有 1 项没过', note: '在这个浏览器里，插件可能不够隔离。请把结果发给开发' });
  });

  it('联网:拿到回应、一直连着都算没挡住;浏览器没有这个办法的不算', () => {
    const b = (o: Record<string, string>) => passing({ battery: { readyMs: 20, stoppedBefore: null, results: outcomes(o), heard: [], framesLeft: 0 } });
    expect(row(b({ 'fetch no-cors': 'ok:opaque', websocket: 'ok:timeout' }), 0)).toMatchObject({ state: 'bad', result: '2 种没挡住' });
    expect(row(b({ sendBeacon: 'ok:false', WebTransport: 'err:WebTransportError:' }), 0).state).toBe('ok');
    expect(row(b({ sendBeacon: 'ok:true' }), 0).state).toBe('bad');
    expect(row(b({ 'typeof Worker': 'function' }), 0).state).toBe('bad');
  });

  it('存储:打得开世界仓库、读得到本机存储都算碰得到;空的缓存不算', () => {
    const b = (o: Record<string, string>) => passing({ battery: { readyMs: 20, stoppedBefore: null, results: outcomes(o), heard: [], framesLeft: 0 } });
    expect(row(b({ indexedDB: 'ok:opened, no data (NotFoundError)' }), 1)).toMatchObject({ state: 'bad', result: '碰得到' });
    expect(row(b({ localStorage: 'ok:null' }), 1).state).toBe('bad');
    expect(row(b({ caches: 'ok:keys 3' }), 1).state).toBe('bad');
    expect(row(b({ origin: 'https://example.com' }), 1).state).toBe('bad');
    expect(row(b({ eval: 'ok:2' }), 2)).toMatchObject({ state: 'bad', result: '没拦住' });
  });

  it('传话:网站听到、别的插件听到都算能传话', () => {
    expect(row(passing({ isolation: { aHeard: ['from-a-itself', 'from-b'], hostHeard: [] } }), 3)).toMatchObject({ state: 'bad', result: '能传话' });
    const heard = passing();
    (heard.battery as { heard: string[] }).heard = ['from-plugin'];
    expect(row(heard, 3).state).toBe('bad');
  });

  it('坏事清单没跑完:那几行是没查成,不是没过', () => {
    const rows = verdict(passing({ battery: { error: 'start-timeout' } }));
    expect([0, 1, 2, 3, 4].map((i) => rows[i].state)).toEqual(['err', 'err', 'err', 'err', 'err']);
    expect(rows[0]).toMatchObject({ result: '没查成', why: '这一项在这个浏览器里没查完。请把结果发给开发。' });
    expect(summary(rows, when).title).toBe('有 5 项没过');
  });

  it('框跳走:没收到拦下的报告、window.open 拿到窗口、整页被带走都算没拦住', () => {
    const nav = (o: object) => passing({ nav: { ran: ['link', 'open', 'refresh', 'self', 'top'], blocked: ['link', 'refresh', 'self'], open: 'null', top: 'SecurityError', loads: {}, ...o } });
    expect(row(nav({ blocked: ['link', 'self'] }), 5)).toMatchObject({ state: 'bad', result: '1 种没拦住' });
    expect(row(nav({ open: '[object Window]' }), 5).result).toBe('1 种没拦住');
    expect(row(nav({ open: 'threw:InvalidAccessError' }), 5).state).toBe('ok');
    expect(row({ ...nav({}), escapedTop: true }, 5).result).toBe('1 种没拦住');
    expect(row({ ...nav({ ran: ['link', 'open', 'refresh', 'self'], top: '' }), escapedTop: true }, 5)).toMatchObject({ state: 'bad', result: '1 种没拦住' });
    expect(row(nav({ ran: ['link', 'refresh', 'self'] }), 5).state).toBe('err');
  });

  it('停插件、卡不卡、递数据', () => {
    const p = passing();
    (p.stops as Record<string, { reason: string }>).pingLoop.reason = 'still running';
    expect(row(p, 6)).toMatchObject({ state: 'bad', result: '1 种没停对' });
    expect(row(passing({ spin: { reason: 'unresponsive', stopped: 'unresponsive', maxGapMs: 900, framesLeft: 0 } }), 7)).toMatchObject({ state: 'bad', result: '最长隔 900 毫秒' });
    expect(row(passing({ spin: { reason: 'replied', stopped: null, maxGapMs: 10, framesLeft: 1 } }), 7).result).toBe('没停下');
    const e = passing();
    (e.echo as { detached: boolean }).detached = false;
    expect(row(e, 8)).toMatchObject({ state: 'bad', result: '没递对' });
  });

  it('复制的结果:结论、这台、每行带原始数,写明只看小屋里面', () => {
    const raw = passing();
    const text = report(verdict(raw), raw, { when, url: 'https://example.com/beta/sandbox-check.html', device: 'iPhone，Safari 里打开（WebKit 605）', ua: 'UA', site: 'v1.5.0' });
    expect(text.split('\n').slice(0, 3)).toEqual(['插件隔离自检：全部通过', '时间 2026-11-07 14:20', '网址 https://example.com/beta/sandbox-check.html']);
    expect(text).toContain('只看小屋里面：没有收信站');
    expect(text).toContain('✓ 视频通话的通道：小屋里没有\n  typeof RTCPeerConnection=undefined');
  });
});

describe('认浏览器', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.61(0x18003d2c) NetType/WIFI Language/zh_CN', 'iPhone，微信里打开（WebKit 605）'],
    [
      'Mozilla/5.0 (Linux; Android 14; PJZ110; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 V1_AND_SQ_9.1.60_9010_YYB_D QQ/9.1.60.22460 NetType/WIFI',
      '安卓，QQ 里打开（Chrome 内核 118）',
    ],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', 'iPhone，Safari 里打开（WebKit 605）'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1', 'iPhone，Chrome 里打开（WebKit 605）'],
    ['Mozilla/5.0 (Linux; U; Android 13; zh-cn; 2201123C) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.86 MQQBrowser/14.6 Mobile Safari/537.36', '安卓，QQ 浏览器里打开（Chrome 内核 109）'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Windows，Firefox 里打开（Firefox 140）'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'Mac，Edge 里打开（Chrome 内核 141）'],
  ])('%s', (ua, line) => {
    expect(describeDevice(ua)).toBe(line);
  });

  it('写 Mac、有触屏的是 iPad', () => {
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', true)).toBe('iPad，Safari 里打开（WebKit 605）');
  });
});

describe('页面和坏事清单', () => {
  it('自检页和网站首页带同一条内容安全策略(框跳走靠它拦)', () => {
    const csp = (f: string) => /<meta http-equiv="Content-Security-Policy"[^>]*>/.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'))?.[0];
    expect(csp('sandbox-check.html')).toBeTruthy();
    expect(csp('sandbox-check.html')).toBe(csp('index.html'));
  });

  it('坏事清单里记了联网的 14 种办法', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/lib/sandbox/battery.js'), 'utf8');
    for (const n of NET_WAYS) expect(src, n).toContain(`tryit('${n}'`);
  });

  it('坏事清单换好地址:都指着网站自己,不留占位,也没有测试网站发布时会拦的存储名', () => {
    const code = batteryCode(new URL('https://example.com/beta/sandbox-check.html'));
    expect(code).not.toMatch(/__[A-Z][A-Z_]*__/);
    expect(code).toContain("'https://example.com/beta/sandbox-probe'");
    expect(code).toContain("'wss://example.com/beta/sandbox-probe'");
    expect(code).not.toMatch(/wenming-ditu:|civ-atlas:/);
  });
});
