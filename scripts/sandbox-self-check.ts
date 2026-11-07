/**
 * 插件隔离自检页(sandbox-check.html)的浏览器检查:npx tsx scripts/sandbox-self-check.ts [chromium] [webkit] [firefox](不写 = 三个都跑;pnpm test:sandbox 在沙箱检查之后跑它)
 *
 * 把自检页打包好,由一个假网站发出去,每个浏览器打开一遍,九行都要过。页面里往外连的地方都指着这个网站自己,
 * 所以这里的假网站顺带当收信站:收到 /sandbox-probe 的请求也算没过。
 * 对照:页面不带 frame-src 时,框真跳得走,「小屋自己跳走」那一行必须查出没过(证明这一行没有收信站也判得出来)。
 * 另查带着「整页被带走过」的记号打开时照样查得完。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { buildCheckPage, CHECK_PAGE } from './lib/sandboxCheckPage';
import { ESCAPED_PARAM, type Row } from '../src/plugin/selfCheck/verdict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NAV_ROW = '小屋自己跳走、弹新窗口';

const fails: string[] = [];
let current = '';
const check = (ok: boolean, what: string, extra = '') => {
  console.log(`${ok ? '  过了' : '  没过'}  ${what}${extra ? `  ${extra}` : ''}`);
  if (!ok) fails.push(`${current}: ${what}`);
};

const files = new Map((await buildCheckPage(ROOT)).map((f) => [f.fileName, f.source]));
const page = files.get(CHECK_PAGE);
if (typeof page !== 'string') throw new Error(`打包结果里没有 ${CHECK_PAGE}`);
const bare = page.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
if (bare === page) throw new Error(`${CHECK_PAGE} 里没有 Content-Security-Policy 那一行`);

const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css' };
const probes: string[] = [];
const server = http.createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '').split('?')[0]);
  const rel = path.replace(/^\/(bare\/)?/, '');
  const body = rel === CHECK_PAGE ? (path.startsWith('/bare/') ? bare : page) : files.get(rel);
  if (body !== undefined) {
    res.writeHead(200, { 'content-type': TYPES[rel.split('.').pop() ?? ''] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    return res.end(body);
  }
  if (path !== '/favicon.ico') probes.push(`${req.method} ${req.url}`);
  res.writeHead(404).end();
});
const port = await new Promise<number>((r) => server.listen(0, () => r((server.address() as AddressInfo).port)));
// localhost 才算安全来源,页面里要用 crypto.subtle
const HOST = `http://localhost:${port}`;

async function open(pg: Page, path: string): Promise<{ rows: Row[] }> {
  await pg.goto(HOST + path);
  await pg.waitForFunction(() => (window as unknown as { __selfCheck?: { done: boolean } }).__selfCheck?.done === true, null, { timeout: 120_000 });
  return pg.evaluate(() => (window as unknown as { __selfCheck: { rows: Row[] } }).__selfCheck);
}

async function runBrowser(name: string, type: BrowserType) {
  current = name;
  console.log(`\n== ${name} ==`);
  const browser = await type.launch({ headless: true });
  console.log(`  版本 ${browser.version()}`);
  try {
    const pg = await browser.newPage();
    probes.length = 0;
    const t0 = Date.now();
    const r = await open(pg, `/${CHECK_PAGE}`);
    console.log(`  (查完用了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒)`);
    for (const row of r.rows) check(row.state === 'ok', `${row.label}:${row.result}`, row.state === 'ok' ? '' : row.detail);
    check(probes.length === 0, '假网站没收到小屋里连出来的请求', probes.join(' | '));

    const e = await open(pg, `/${CHECK_PAGE}?${ESCAPED_PARAM}=top`);
    const en = e.rows.find((x) => x.label === NAV_ROW);
    check(en?.state === 'bad' && !pg.url().includes(ESCAPED_PARAM), `带着「整页被带走过」的记号打开:查得完、「${NAV_ROW}」算没过、记号从网址上去掉`, `${en?.result} ${pg.url()}`);

    const b = await open(pg, `/bare/${CHECK_PAGE}`);
    const nav = b.rows.find((x) => x.label === NAV_ROW);
    check(nav?.state === 'bad', `对照:页面不带 frame-src 时「${NAV_ROW}」查得出没过`, `${nav?.result} ${nav?.detail}`);
    check(
      b.rows.every((x) => x.label === NAV_ROW || x.state === 'ok'),
      '对照:别的几行照样过',
      b.rows
        .filter((x) => x.state !== 'ok')
        .map((x) => x.label)
        .join(','),
    );
  } catch (err) {
    check(false, '跑完', (err as Error).message.slice(0, 300));
  } finally {
    await browser.close().catch(() => {});
  }
}

const ALL: Record<string, BrowserType> = { chromium, webkit, firefox };
const pick = process.argv.slice(2).filter((a) => a in ALL);
for (const n of pick.length ? pick : Object.keys(ALL)) await runBrowser(n, ALL[n]);

server.close();
console.log(fails.length ? `\n没过 ${fails.length} 项:\n${fails.map((f) => `  ${f}`).join('\n')}` : '\n全部过了');
process.exit(fails.length ? 1 : 0);
