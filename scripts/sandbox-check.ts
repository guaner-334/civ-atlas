/**
 * 插件沙箱的浏览器检查:pnpm test:sandbox [chromium] [webkit] [firefox] [--update](不写浏览器 = 三个都跑)
 * 都过了接着跑隔离自检页的检查(sandbox-self-check.ts,同样的参数)。
 *
 * 起一个假网站(页面带 index.html 里那条 Content-Security-Policy)和一个「收信站」(HTTP、WebSocket、两个 TCP 口、一个 UDP 口,
 * 谁连进来都记下),让插件在沙箱里把能想到的坏事都试一遍(lib/sandbox/battery.js)。
 * 插件那几段收信站收到任何东西、假网站收到不认识的请求,都算没过;两段对照必须收到,证明收信站听得见。
 * 另查:来回传话和转交、出错 / 乱发话 / 死循环时停得下来、停了以后 CPU 降下来、框自己跳不走;
 * 插件接口:假插件(lib/sandbox/apiPlugin.js)把每样能力拿一遍、每种越界试一遍,什么能力都没要的插件样样被拒,
 * 发话太多、太大、乱写调用、冒充网站的回话都停得下来。
 * 示例插件(examples/plugins/):对种子 7、2024 各跑一遍,交出来的面板、图层、要改的东西和 tests/fixtures/plugin-examples.json 对上;
 * 有意改了示例或接口,加 --update 重写那份快照(第一个浏览器写,后面的跟它比),和代码一起提交。
 * 没过的打印「没过」,退出码非 0。
 */
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { build, type Rollup } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fails: string[] = [];
let current = '';
const check = (ok: boolean, what: string, extra = '') => {
  console.log(`${ok ? '  过了' : '  没过'}  ${what}${extra ? `  ${extra}` : ''}`);
  if (!ok) fails.push(`${current}: ${what}`);
};

// ---- 收信站和假网站 ----

interface Hit {
  kind: string;
  what: string;
}
const hits: Hit[] = [];
const note = (kind: string, what = '') => hits.push({ kind, what: what.slice(0, 120) });

const listen = (s: net.Server | http.Server, host?: string) =>
  new Promise<number>((res) => s.listen(0, host, () => res((s.address() as net.AddressInfo).port)));

const collectHttp = http.createServer((req, res) => {
  note('http', `${req.method} ${req.url}`);
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': req.url?.endsWith('.js') ? 'text/javascript' : 'text/plain' });
  res.end(req.url?.endsWith('.js') ? 'self.__leaked = 1;' : 'ok');
});
collectHttp.on('upgrade', (req, sock) => {
  note('ws', req.url ?? '');
  sock.destroy();
});
collectHttp.on('connection', () => note('tcp'));
const tcpCatcher = (kind: string) =>
  net.createServer((s) => {
    note(kind);
    s.on('data', (d: Buffer) => note(`${kind}-data`, d.subarray(0, 40).toString('latin1').replace(/[^\x20-\x7e]/g, '.')));
    s.on('error', () => {});
    setTimeout(() => s.destroy(), 200);
  });
const preconnect = tcpCatcher('tcp-preconnect');
const turn = tcpCatcher('tcp-turn');
const udp = dgram.createSocket('udp4');
udp.on('message', (m) => note('udp', `${m.length} bytes`));

const [collectPort, preconnectPort, turnPort] = await Promise.all([listen(collectHttp, '127.0.0.1'), listen(preconnect, '127.0.0.1'), listen(turn, '127.0.0.1')]);
const udpPort = await new Promise<number>((res) => udp.bind(0, '127.0.0.1', () => res(udp.address().port)));
const COLLECT = `http://127.0.0.1:${collectPort}`;

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cspMeta = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i.exec(indexHtml)?.[0];
if (!cspMeta) {
  console.error('index.html 里没有 Content-Security-Policy 那一行');
  process.exit(1);
}

const out = await build({
  configFile: false,
  root: ROOT,
  logLevel: 'silent',
  publicDir: false,
  build: {
    write: false,
    target: 'es2020',
    minify: true,
    lib: { entry: 'scripts/lib/sandbox/harness.ts', formats: ['es'], fileName: () => 'harness.js' },
  },
});
const harnessJs = ((Array.isArray(out) ? out[0] : out) as Rollup.RollupOutput).output[0].code;

const page = (csp: boolean) =>
  `<!doctype html><html><head><meta charset="utf-8">${csp ? cspMeta : ''}<title>sandbox check</title></head><body><script type="module" src="/harness.js"></script></body></html>`;
const host = http.createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/' || path === '/bare') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(page(path === '/'));
  }
  if (path === '/harness.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end(harnessJs);
  }
  if (path !== '/favicon.ico') note('host', `${req.method} ${req.url}`);
  res.writeHead(404).end();
});
const hostPort = await listen(host);
const HOST = `http://localhost:${hostPort}`;

const apiPluginJs = readFileSync(new URL('./lib/sandbox/apiPlugin.js', import.meta.url), 'utf8');
const ALL_CAPS = [
  'world.read@1',
  'history.read@1',
  'author.read@1',
  'author.write@1',
  'view.read@1',
  'input.pick@1',
  'ui.panel@1',
  'layer.cells@1',
  'layer.marks@1',
  'store.local@1',
  'store.world@1',
];

const batteryJs = readFileSync(new URL('./lib/sandbox/battery.js', import.meta.url), 'utf8')
  .replace('__COLLECT__', COLLECT)
  .replace('__WS__', `ws://127.0.0.1:${collectPort}`)
  .replace('__HOST__', HOST)
  .replace('__PRECONNECT__', String(preconnectPort))
  .replace('__TURN__', String(turnPort))
  .replace('__UDP__', String(udpPort))
  .replace('__SECRET_KEY__', 'civ-atlas:ai-secrets');

// ---- 浏览器进程占了多少 CPU ----

type Sample = Map<number, number>;
function browserPids(root: number, dirHint: string): number[] {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }));
  const kids = new Map<number, number[]>();
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r.pid]);
  const mine = new Set([root]);
  const stack = [root];
  while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) if (!mine.has(k)) mine.add(k), stack.push(k);
  // macOS 上 WebKit 的页面进程由系统拉起,不在浏览器进程底下,按可执行文件所在目录认
  if (process.platform === 'darwin') for (const r of rows) if (r.cmd.includes(dirHint)) mine.add(r.pid);
  return [...mine];
}
function cpuSample(pids: number[]): Sample {
  const s: Sample = new Map();
  if (process.platform === 'linux') {
    for (const pid of pids) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        s.set(pid, (Number(f[11]) + Number(f[12])) / 100);
      } catch {
        // 进程刚退出
      }
    }
    return s;
  }
  let text = '';
  try {
    text = execFileSync('ps', ['-o', 'pid=,time=', '-p', pids.join(',')], { encoding: 'utf8' });
  } catch (e) {
    text = String((e as { stdout?: string }).stdout ?? '');
  }
  for (const l of text.split('\n')) {
    const m = /^\s*(\d+)\s+(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/.exec(l);
    if (m) s.set(Number(m[1]), Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]));
  }
  return s;
}
/** 只算前后两次都在的进程:中途退出的进程(拿掉框时)不算成负的 */
async function cpuRate(root: number, dirHint: string, ms = 1000): Promise<number> {
  const pids = browserPids(root, dirHint);
  const a = cpuSample(pids);
  const t0 = Date.now();
  await sleep(ms);
  const b = cpuSample(pids);
  let d = 0;
  for (const [pid, v] of b) if (a.has(pid)) d += v - a.get(pid)!;
  return +(d / ((Date.now() - t0) / 1000)).toFixed(2);
}

// ---- 一个浏览器跑一遍 ----

interface Seg {
  out: unknown;
  hits: Hit[];
}
const segment = async (fn: () => Promise<unknown>, settleMs = 800): Promise<Seg> => {
  const i = hits.length;
  let out: unknown;
  try {
    out = await Promise.race([fn(), sleep(120_000).then(() => 'TIMEOUT 120s')]);
  } catch (e) {
    out = `THREW ${(e as Error).message.slice(0, 300)}`;
  }
  await sleep(settleMs);
  return { out, hits: hits.slice(i) };
};
const show = (h: Hit[]) => h.map((x) => `${x.kind} ${x.what}`.trim()).join(' | ');
const noLeak = (name: string, s: Seg) => check(s.hits.length === 0, `${name}:收信站 / 假网站什么都没收到`, s.hits.length ? show(s.hits) : '');

type R = { name: string; outcome: string };
const outcome = (rs: R[], name: string) => rs.find((r) => r.name === name)?.outcome ?? '(没记)';

async function runBrowser(name: string, type: BrowserType) {
  current = name;
  console.log(`\n== ${name} ==`);
  const server = await type.launchServer({ headless: true });
  const pid = server.process().pid!;
  const dirHint = type.executablePath().split('/ms-playwright/')[1]?.split('/')[0] ?? type.executablePath();
  const browser = await type.connect(server.wsEndpoint());
  console.log(`  版本 ${browser.version()}`);
  const ctx = await browser.newContext();
  const pg: Page = await ctx.newPage();
  const popups: string[] = [];
  ctx.on('page', (p) => popups.push(p.url()));
  const errors: string[] = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  const open = async (path: string) => {
    await pg.goto(HOST + path);
    await pg.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
  };
  const ev = <T>(fn: string, ...args: unknown[]) =>
    pg.evaluate(([f, a]) => {
      const c = (window as unknown as { check: Record<string, unknown> }).check;
      const target = (f as string).split('.').reduce((o: any, k) => o[k], c) as (...x: unknown[]) => Promise<unknown>;
      return target(...(a as unknown[]));
    }, [fn, args] as const) as Promise<T>;

  try {
    await open('/');
    await ev('seed');

    // 1. 坏事清单
    const bat = await segment(() => ev('battery', batteryJs));
    noLeak('坏事清单', bat);
    const b = bat.out as { readyMs: number; stoppedBefore: string | null; out: { type: string; results?: R[] }; heard: unknown[]; frames: number } | string;
    if (typeof b === 'string' || b.out.type !== 'results' || !b.out.results) {
      check(false, '坏事清单跑完并交回结果', JSON.stringify(b).slice(0, 300));
    } else {
      const rs = b.out.results;
      check(b.stoppedBefore === null, '跑坏事清单时插件没被停掉', String(b.stoppedBefore));
      check(outcome(rs, 'where') === 'worker', '插件跑在线程里,碰不到框的页面', outcome(rs, 'where'));
      check(outcome(rs, 'origin') === 'null', '插件是不认识的来源(origin 为 null)', outcome(rs, 'origin'));
      check(outcome(rs, 'indexedDB').startsWith('err'), '打不开 IndexedDB(世界仓库)', outcome(rs, 'indexedDB'));
      check(!outcome(rs, 'localStorage').startsWith('ok'), '读不到 localStorage(AI 密钥)', outcome(rs, 'localStorage'));
      check(outcome(rs, 'eval').startsWith('err') && outcome(rs, 'new Function').startsWith('err'), 'eval、new Function 被拦');
      check(outcome(rs, 'setTimeout(string)') === 'ok:no', 'setTimeout 传字符串不执行', outcome(rs, 'setTimeout(string)'));
      for (const k of ['RTCPeerConnection', 'document', 'Worker']) check(outcome(rs, `typeof ${k}`) === 'undefined', `插件拿不到 ${k}`, outcome(rs, `typeof ${k}`));
      check(b.heard.length === 0, '网站页面没听到插件的频道喊话', JSON.stringify(b.heard));
      check(b.frames === 0, '停了以后框拿掉了', `还剩 ${b.frames} 个`);
      const opened = rs.filter((r) => r.outcome.startsWith('ok') && !/^(where|origin|typeof|setTimeout|fetch data:|BroadcastChannel|caches)/.test(r.name));
      console.log(`  (插件自己看到的:开沙箱 ${b.readyMs} ms;${opened.length ? `这几项没报错 ${opened.map((r) => `${r.name}=${r.outcome}`).join('; ')}` : '其余全都报错'})`);
    }

    // 2. 来回传话
    const e = await segment(() => ev('echo'));
    noLeak('来回传话', e);
    const eo = e.out as { s: number; n: number; backIsArray: boolean; detached: boolean; ms: number; errorReply: string; uncloneable: string; early: boolean; stopped: string; afterStop: string; frames: number };
    check(eo.early, '插件顶层里发的话收得到,不当作乱发话');
    check(eo.s === 36_000 && eo.n === 36_000 && eo.backIsArray, '36k 个数递进去、算完、原样递回来', JSON.stringify(eo).slice(0, 200));
    check(eo.detached, '转交以后网站这边的那份交出去了(没拷贝)');
    check(eo.errorReply.length > 0, '插件回话出错时 call 拿到错误', eo.errorReply);
    check(eo.uncloneable === 'DataCloneError, still running', '网站这边递了传不过去的东西:call 报错,插件不停', eo.uncloneable);
    check(eo.stopped === 'stopped' && eo.afterStop === 'stopped' && eo.frames === 0, '停了以后再 call 直接报停了,框拿掉了', `${eo.stopped} / ${eo.afterStop} / ${eo.frames}`);
    console.log(`  (来回 ${eo.ms} ms)`);

    // 3. 插件之间
    const iso = await segment(() => ev('isolation'));
    noLeak('两个插件', iso);
    const io = iso.out as { aHeard: unknown[]; hostHeard: unknown[] };
    check(!JSON.stringify(io.aHeard).includes('from-b') && io.hostHeard.length === 0, '两个插件之间、插件和网站之间的频道不通', JSON.stringify(io));

    // 4. 出错、乱发话、占死
    const expect: Record<string, string> = {
      syntax: 'crashed',
      throwLater: 'crashed',
      garbage: 'protocol',
      forgedBoot: 'protocol',
      wrongVersion: 'protocol',
      strayReply: 'protocol',
      topLevelLoop: 'start-timeout',
      pingLoop: 'unresponsive',
    };
    const said: Record<string, string> = {
      syntax: '语法错的插件开不起来',
      throwLater: '插件抛错就停',
      garbage: '插件乱发话就停',
      forgedBoot: '插件冒充框里的引导代码,当作乱发话停掉',
      wrongVersion: '版本号不对就停',
      strayReply: '回了没问过的话就停',
      topLevelLoop: '顶层死循环,开不起来,超时停掉',
      pingLoop: '线程被占死,ping 超时停掉',
    };
    // 这几段插件故意出错,页面上的报错是插件的,不算
    const errorsBefore = errors.length;
    for (const [k, want] of Object.entries(expect)) {
      const s = await segment(() => ev(`stops.${k}`), 300);
      const o = s.out as { reason: string; detail: string; ms: number; frames: number };
      check(o.reason === want && o.frames === 0 && s.hits.length === 0, said[k], `${o.reason}${o.detail ? ` (${o.detail})` : ''},${o.ms} ms${s.hits.length ? `,收信站 ${show(s.hits)}` : ''}`);
    }

    errors.splice(errorsBefore);

    // 5. 死循环:界面照常,停了以后 CPU 降下来
    const idle = await cpuRate(pid, dirHint);
    const spin = await segment(async () => {
      await ev('spinStart');
      await sleep(300);
      const busy = await cpuRate(pid, dirHint);
      const r = (await ev('spinWait')) as { reason: string; stopped: string; maxGapMs: number; stopAfterMs: number };
      const after: number[] = [];
      for (let i = 0; i < 6; i++) {
        after.push(await cpuRate(pid, dirHint));
        if (after[after.length - 1] < 0.25) break;
      }
      return { ...r, busy, after };
    }, 300);
    noLeak('死循环', spin);
    const so = spin.out as { reason: string; stopped: string; maxGapMs: number; busy: number; after: number[] };
    check(so.reason === 'unresponsive' && so.stopped === 'unresponsive', 'call 超时以后停掉', JSON.stringify(so));
    check(so.maxGapMs < 250, '插件死循环时网站页面照常(每 10 ms 的计时器最长间隔)', `${so.maxGapMs} ms`);
    check(so.busy >= 0.6, '量得到死循环在吃 CPU(量不到下面那条就不算数)', `空闲 ${idle},死循环 ${so.busy} 核`);
    check(so.after.length > 0 && so.after[so.after.length - 1] < 0.25, '停掉以后 CPU 降下来', `停后每秒 ${so.after.join(' → ')} 核`);

    check(errors.length === 0, '页面没有报错', errors.slice(0, 3).join(' | '));

    // 6. 框自己跳走(下面几段框里的代码故意越界,浏览器报的错不算)
    const nav = await segment(() => ev('frameNav', COLLECT), 1000);
    noLeak('框自己跳走(网站页面带 frame-src)', nav);
    const no = nav.out as { ran: string[] };
    check(['link', 'open', 'refresh', 'self', 'top'].every((k) => no.ran.some((r) => r.startsWith(k))), '几种跳法的代码都跑到了', no.ran.join(', '));
    check(popups.length === 0, '没有弹出新窗口', popups.join(', '));

    // 7. 对照:必须收到
    const sw = await segment(() => ev('siteWorker', COLLECT));
    check(sw.hits.some((h) => h.what.includes('/site-worker')), '对照:网站自己的线程连得到收信站(收信站听得见)', `${String(sw.out)};${show(sw.hits)}`);
    await open('/bare');
    const bare = await segment(() => ev('frameNav', COLLECT), 1000);
    check(bare.hits.some((h) => h.what.includes('/nav-self')), '对照:网站页面不带 frame-src 时框跳得走(这条拦住全靠它)', show(bare.hits));

    // 8. 插件接口
    await open('/');
    await apiChecks(ev);

    // 9. 示例插件
    await open('/');
    await exampleChecks(ev);

    // 10. 对照(只打印):插件代码直接跑在框的页面里
    await open('/');
    const fb = await segment(() => ev('frameBattery', batteryJs), 2500);
    console.log(`  (对照,只看不判:少了线程那一层,收信站收到 ${fb.hits.length} 条${fb.hits.length ? `:${show(fb.hits)}` : ''})`);
  } catch (err) {
    check(false, '跑完', (err as Error).message.slice(0, 300));
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

type Ev = <T>(fn: string, ...args: unknown[]) => Promise<T>;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function apiChecks(ev: Ev) {
  interface ApiRun {
    out: Record<string, any> | null | 'timeout';
    stoppedBefore: string | null;
    ms: number;
    sink: { panels: (number | null)[]; layers: [string, string | null][]; logs: string[] };
    commits: { names: number; marks: string[]; interventions: number }[];
    worldIntact: boolean;
    expect: { cells: number; elev: number; ownedPolities: number; rivers: number };
    frames: number;
    refused?: string;
  }
  const full = await segment(() => ev('api', apiPluginJs, ALL_CAPS));
  noLeak('插件接口', full);
  const r = full.out as ApiRun;
  const o = r && typeof r.out === 'object' && r.out ? r.out : null;
  if (!o || o.threw) {
    check(false, '假插件把接口走完、交回结果', JSON.stringify(r).slice(0, 400));
    return;
  }
  check(r.stoppedBefore === null, '走接口时插件没被停掉', String(r.stoppedBefore));
  check(o.info?.api === 1 && eq(o.info.caps, ALL_CAPS), '握手:host.info 报的能力就是清单里要的', JSON.stringify(o.info));
  const w = o.world ?? {};
  check(w.cells === r.expect.cells && w.n === r.expect.cells && w.f32 && w.u8 && w.latOk, '读地图:地块数、类型、经纬度对', JSON.stringify(w));
  check(Math.abs(w.elev - r.expect.elev) <= Math.abs(r.expect.elev) * 1e-6 + 1, '读地图:海拔加起来和网站这边一样', `${w.elev} / ${r.expect.elev}`);
  check(r.worldIntact, '插件改了拿到的数组、网站转交了数组,世界本身没变、没被交出去');
  check(eq(o.neighbors?.[0], r.expect.cells + 1) && o.rivers === r.expect.rivers && o.legend > 0, '读地图:相邻表、河、图例', JSON.stringify([o.neighbors, o.rivers, o.legend]));
  const h = o.history ?? {};
  check(
    h.atLen === r.expect.cells && h.i16 && h.ownedPolities === r.expect.ownedPolities && h.polities >= h.ownedPolities && /^polity:/.test(h.polityKey ?? ''),
    '读历史:某年每个地块的归属、国家',
    JSON.stringify(h).slice(0, 300),
  );
  check(['settlements', 'routes', 'places', 'cultures', 'faiths', 'regions'].every((k) => h[k] > 0) && h.people === 5 && h.events === 7, '读历史:城、路、地名、民族、信仰、州、人物、编年史', JSON.stringify(h).slice(0, 300));
  check(eq(o.author, { marks: '故乡', names: { 'polity:c1#0': '甲' }, characters: 0, interventions: 0, notes: '第一卷' }), '读你写的东西:标记、改名、人物、干预、正文', JSON.stringify(o.author));
  check(o.view?.year === 600 && o.view?.layer === 'polities', '读你在干什么:年份、图层', JSON.stringify(o.view));
  check(eq(o.pick, { cell: 5, cells: [1, 2, 3], box: 2 }), '点选:一个地块、几个地块、框选', JSON.stringify(o.pick));
  check(
    eq(o.apply, { applied: 3, skipped: 0, marks: [2] }) && eq(r.commits, [{ names: 2, marks: ['故乡', '插件标的'], interventions: 1 }]),
    '改你写的东西:改名、加标记、下干预一次交给网站照办(一批一次)',
    JSON.stringify([o.apply, r.commits]),
  );
  check(o.applyAfter?.marks === 2 && Object.values(o.applyAfter?.names ?? {}).includes('插件起的'), '照办以后插件读到的是改过的', JSON.stringify(o.applyAfter));
  check(eq(o.store, [null, 'ok', { schema: 1, value: { speed: 3 } }, 'ok', [1, 2, 3], 'ok', null]), '插件自己的数据:设置、世界里的数据存取删', JSON.stringify(o.store));
  check(o.panel === 'ok' && r.sink.panels.includes(3), '面板交给画的那一边', `${o.panel} ${JSON.stringify(r.sink.panels)}`);
  check(eq(o.layers, ['ok', 'ok', 'ok', 'ok', 'limit', 'ok', 'ok']), '图层:四个以内交给画的那一边,第五个回 limit;标注、拿掉', JSON.stringify(o.layers));
  check(r.sink.layers.some(([k, v]) => k === 'b' && v === null) && r.sink.layers.some(([k, v]) => k === 'route' && v === 'marks'), '图层交给画的那一边、拿掉的也说', JSON.stringify(r.sink.layers).slice(0, 200));
  check(
    eq(o.bad, {
      field: 'bad-args',
      fields17: 'limit',
      year: 'bad-args',
      people: 'limit',
      panelNode: 'bad-args',
      panelBig: 'limit',
      layerLen: 'bad-args',
      markText: 'limit',
      unknown: 'unknown-call',
      proto: 'unknown-call',
      applyKey: 'bad-args',
      applyKind: 'bad-args',
      storeBig: 'limit',
      storeKind: 'bad-args',
      uncloneable: 'bad-args',
      stillUp: 1,
    }),
    '越界:参数不对、超上限、改不了的修改、存不了的数据、没有的调用各回各的错,插件照样在跑',
    JSON.stringify(o.bad),
  );
  check(eq(o.events, [['view.year', 700], ['view.select', 'polity:c1#0'], ['panel.action', 'go']]), '事件:看的年份、选中的东西、面板按钮;不认得的控件不转', JSON.stringify(o.events));
  check(r.frames === 0, '停了以后框拿掉了', `还剩 ${r.frames} 个`);
  console.log(`  (假插件从开到交回结果 ${r.ms} ms)`);

  const none = await segment(() => ev('apiNothing'));
  noLeak('什么能力都没要的插件', none);
  const n = (none.out as ApiRun).out as { codes: Record<string, string>; events: string[] } | null;
  const allowed = new Set(['host.info']);
  const wrong = n ? Object.entries(n.codes).filter(([k, c]) => (allowed.has(k) ? c !== 'ok' : c !== 'no-permission')) : [['没交回结果', '']];
  check(wrong.length === 0, '什么能力都没要:除了 host.info 一律 no-permission', JSON.stringify(wrong).slice(0, 300));
  check(!!n && n.events.length === 0, '什么能力都没要:事件一个都收不到', JSON.stringify(n?.events));

  const want: Record<string, string> = { flood: 'flood', oversize: 'oversize', badCall: 'protocol', forgedRes: 'protocol', forgedEvent: 'protocol' };
  const said: Record<string, string> = {
    flood: '一秒里发话超过上限就停',
    oversize: '一条话太大就停',
    badCall: '调用名乱写,当乱发话停掉',
    forgedRes: '插件冒充网站的回话,当乱发话停掉',
    forgedEvent: '插件冒充网站的事件,当乱发话停掉',
  };
  for (const [k, reason] of Object.entries(want)) {
    const s = await segment(() => ev(`apiStops.${k}`), 300);
    const x = s.out as ApiRun;
    check(String(x?.stoppedBefore).startsWith(reason) && x.frames === 0 && s.hits.length === 0, said[k], `${x?.stoppedBefore}${s.hits.length ? `,收信站 ${show(s.hits)}` : ''}`);
  }
  const ref = await segment(() => ev('apiStops.refused'));
  const rx = ref.out as ApiRun;
  check(rx?.refused === 'newer' && rx.frames === 0, '清单要了网站没有的能力:不开沙箱,说要新版网站', JSON.stringify(rx));
}

// ---- 示例插件 ----

const EXAMPLE_SNAPS = new URL('../tests/fixtures/plugin-examples.json', import.meta.url);
const EXAMPLE_SEEDS = [7, 2024];
interface ExampleSnap {
  asked: string[];
  frames: { panel: unknown[] | null; layers: Record<string, any> }[];
  commits: { marks: { regions?: string[] }[] }[];
  logs: string[];
}
/**
 * picks:插件请点选时依次答什么(harness 的 examplePicks);steps:每一步改看的年份或点面板上的控件,每一步之前记一帧。
 * sane:不看快照也该对的几条(重写快照时防止把坏结果钉进去)
 */
const EXAMPLES: { id: string; picks: string[]; steps: { year?: number; action?: { id: string; value?: unknown } }[]; sane: (s: ExampleSnap) => boolean }[] = [
  {
    id: 'coast-distance',
    picks: [],
    steps: [],
    sane: (s) => s.frames.length === 1 && s.frames[0].layers.coast?.drawn > 0 && s.logs.length === 1,
  },
  {
    id: 'route-days',
    // 第三次「换个起点」时没有答案了,当用的人退出点选:上一条路线要跟着清掉
    picks: ['city', 'far', 'far', 'city'],
    steps: [{ action: { id: 'mode', value: 'horse' } }, { action: { id: 'clear' } }, { action: { id: 'again' } }, { action: { id: 'again' } }],
    sane: (s) =>
      s.asked.length === 5 &&
      s.frames[0].layers.route?.items[0]?.kind === 'line' &&
      !eq(s.frames[0].panel, s.frames[1].panel) &&
      !s.frames[2].layers.route &&
      !!s.frames[3].layers.route &&
      !s.frames[4].layers.route,
  },
  {
    id: 'box-summary',
    picks: ['box'],
    steps: [{ year: 400 }, { action: { id: 'save' } }],
    sane: (s) =>
      s.asked.length === 1 && !eq(s.frames[0].panel, s.frames[1].panel) && s.commits.length === 1 && s.commits[0].marks.length === 1 && (s.commits[0].marks[0].regions?.length ?? 0) > 0,
  },
];
const UPDATE_EXAMPLES = process.argv.includes('--update');
/** 和谁比:--update 时等第一个浏览器跑完再定 */
let exampleSnaps: Record<string, unknown> | null = UPDATE_EXAMPLES ? null : existsSync(EXAMPLE_SNAPS) ? JSON.parse(readFileSync(EXAMPLE_SNAPS, 'utf8')) : {};

/** 第一处不一样的地方;数允许差一点(几个浏览器引擎的 Math.cos 这类可能差最后一位) */
function firstDiff(a: unknown, b: unknown, at: string): string | null {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) ? null : `${at}:${a} ≠ ${b}`;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
    return a === b ? null : `${at}:${String(JSON.stringify(a)).slice(0, 100)} ≠ ${String(JSON.stringify(b)).slice(0, 100)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

async function exampleChecks(ev: Ev) {
  const got: Record<string, unknown> = {};
  for (const ex of EXAMPLES) {
    const dir = new URL(`../examples/plugins/${ex.id}/`, import.meta.url);
    const m = JSON.parse(readFileSync(new URL('plugin.json', dir), 'utf8'));
    const code = readFileSync(new URL('main.js', dir), 'utf8');
    for (const seed of EXAMPLE_SEEDS) {
      const key = `${ex.id}@${seed}`;
      const s = await segment(() => ev('example', code, { id: m.id, requires: m.requires, optional: m.optional }, seed, ex.picks, ex.steps));
      noLeak(`示例 ${key}`, s);
      const r = s.out as { stoppedBefore: string | null; snapshot: ExampleSnap; frames: number; refused?: string };
      if (!r || typeof r !== 'object' || r.refused || !r.snapshot) {
        check(false, `示例 ${key}:跑完`, JSON.stringify(r).slice(0, 300));
        continue;
      }
      check(r.stoppedBefore === null && r.frames === 0, `示例 ${key}:跑的时候没被停掉,停了以后框拿掉了`, `${r.stoppedBefore} / 还剩 ${r.frames} 个框`);
      const snap = JSON.parse(JSON.stringify(r.snapshot)) as ExampleSnap;
      got[key] = snap;
      check(ex.sane(snap), `示例 ${key}:点选、面板、图层、改的东西都有`, JSON.stringify(snap).slice(0, 300));
      if (exampleSnaps) {
        const d = firstDiff(exampleSnaps[key], snap, key);
        check(!d, `示例 ${key}:和存下的快照一样`, d ?? '');
      }
    }
  }
  if (!exampleSnaps) {
    writeFileSync(EXAMPLE_SNAPS, `${JSON.stringify(got, null, 2)}\n`);
    console.log(`  (重写了示例插件的快照 tests/fixtures/plugin-examples.json,后面的浏览器跟它比)`);
    exampleSnaps = got;
  }
}

const ALL: Record<string, BrowserType> = { chromium, webkit, firefox };
const pick = process.argv.slice(2).filter((a) => a in ALL);
for (const n of pick.length ? pick : Object.keys(ALL)) await runBrowser(n, ALL[n]);

collectHttp.close();
preconnect.close();
turn.close();
udp.close();
host.close();
console.log(fails.length ? `\n没过 ${fails.length} 项:\n${fails.map((f) => `  ${f}`).join('\n')}` : '\n全部过了');
if (fails.length) process.exit(1);
// 不在 package.json 里用 && 接着跑:pnpm 把命令行参数只接在最后一条命令后面
await import('./sandbox-self-check');
