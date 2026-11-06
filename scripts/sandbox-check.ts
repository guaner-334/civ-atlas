/**
 * 插件沙箱的浏览器检查:npx tsx scripts/sandbox-check.ts [chromium] [webkit] [firefox](不写 = 三个都跑)
 *
 * 起一个假网站(页面带 index.html 里那条 Content-Security-Policy)和一个「收信站」(HTTP、WebSocket、两个 TCP 口、一个 UDP 口,
 * 谁连进来都记下),让插件在沙箱里把能想到的坏事都试一遍(lib/sandbox/battery.js)。
 * 插件那几段收信站收到任何东西、假网站收到不认识的请求,都算没过;两段对照必须收到,证明收信站听得见。
 * 另查:来回传话和转交、出错 / 乱发话 / 死循环时停得下来、停了以后 CPU 降下来、框自己跳不走。
 * 没过的打印「没过」,退出码非 0。
 */
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
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

const batteryJs = readFileSync(new URL('./lib/sandbox/battery.js', import.meta.url), 'utf8')
  .replace('__COLLECT__', COLLECT)
  .replace('__WS__', `ws://127.0.0.1:${collectPort}`)
  .replace('__HOST__', HOST)
  .replace('__PRECONNECT__', String(preconnectPort))
  .replace('__TURN__', String(turnPort))
  .replace('__UDP__', String(udpPort));

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

    // 8. 对照(只打印):插件代码直接跑在框的页面里
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

const ALL: Record<string, BrowserType> = { chromium, webkit, firefox };
const pick = process.argv.slice(2).filter((a) => a in ALL);
for (const n of pick.length ? pick : Object.keys(ALL)) await runBrowser(n, ALL[n]);

collectHttp.close();
preconnect.close();
turn.close();
udp.close();
host.close();
console.log(fails.length ? `\n没过 ${fails.length} 项:\n${fails.map((f) => `  ${f}`).join('\n')}` : '\n全部过了');
process.exit(fails.length ? 1 : 0);
