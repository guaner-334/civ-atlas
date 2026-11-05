/**
 * AI 正文存进世界仓库的浏览器检查(量构建好的网站,走真的 localStorage 上限、真的 IndexedDB、真的后台线程)。真实 AI 接口不调,正文是这里写的。
 *
 *   pnpm build && npx tsx scripts/notes-vault-check.ts [--browsers=chromium,webkit]
 *
 * 塞满 localStorage 再存 6 MB、刷新还在、别的东西不动;真删了不回来;复制世界、删了再撤销、存成文件换一个干净的浏览器打开;
 * 老数据转进去;刚写完就关页面;浏览器不给 IndexedDB;超长正文的文件。
 * 没过的打印「没过」,退出码非 0。
 */
import net from 'node:net';
import path from 'node:path';
import { chromium, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { preview } from 'vite';
import { mergeUpheavals } from '../src/gen/civ/upheaval';
import { parseSave } from '../src/gen/savefile';
import { openWorldFile, packWorldFile, type PackInput, type WorldEras } from '../src/gen/worldFile';
import { keyOf } from '../src/worldRun';
import { bytesOf, makeSample, READERS } from '../tests/lib/worldFileSample';

const opt = (k: string) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BROWSERS = (opt('browsers') ?? 'chromium,webkit').split(',');
const WAIT = 120_000;

const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '过' : '没过'}  ${what}`);
  if (!ok) fails.push(what);
};

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

const port = await freePort();
const srv = await preview({ build: { outDir: path.resolve('dist') }, preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const BASE = `http://127.0.0.1:${port}/`;

/** 过得了校验的小世界文件 */
function fileSample(): PackInput {
  const s = makeSample();
  const r = parseSave(JSON.stringify(s.recipe));
  if (!r.ok) throw new Error(r.error);
  const e = r.save.edits;
  let all = [...e.terrain];
  const keys = mergeUpheavals(e.upheavals ?? []).map((u) => {
    all = [...all, ...u.ops];
    return keyOf(r.save.params, all, e.sketch);
  });
  const eras: WorldEras = { baseKey: keyOf(r.save.params, e.terrain, e.sketch), eras: s.eras.eras.map((x, i) => ({ ...x, key: keys[i] })) };
  return { ...s, eras };
}

const sample = fileSample();
const toB64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const plainFile = toB64(await bytesOf(await packWorldFile(sample)));
const longNote = { key: '史书:长', kind: '史书', title: '超长', text: 'x'.repeat(4e6 + 1), createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 't' };
const longBytes = await bytesOf(await packWorldFile({ ...sample, author: { notes: [longNote] } }));
const longAuthorSum = (await openWorldFile(longBytes, { readers: READERS })).manifest.parts.find((p) => p.name === 'author')!.sum;

async function home(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  await page.goto(BASE);
  await page.waitForFunction(() => typeof (window as any).__wfNotes === 'function' && typeof (window as any).__wfWorldFiles === 'function', null, { timeout: WAIT });
  return page;
}

async function again(page: Page) {
  await page.reload();
  await page.waitForFunction(() => typeof (window as any).__wfNotes === 'function', null, { timeout: WAIT });
}

/** 放进一个世界文件;返回世界编号和提示 */
function keepFile(page: Page, b64: string): Promise<{ id: string; warnings: string[] }> {
  return page.evaluate(async (data) => {
    const wf = await (window as any).__wfWorldFiles();
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const looked = await wf.lookWorldFile(new Blob([bytes]));
    if (!looked.ok) throw new Error(looked.message);
    const kept = await wf.keepWorldFile(looked);
    if (!kept.ok) throw new Error(kept.message);
    return { id: kept.id as string, warnings: looked.warnings as string[] };
  }, b64);
}

/** 把 localStorage 塞满(一个字符都放不下),返回塞的量 */
function fillStorage(page: Page): Promise<number> {
  return page.evaluate(() => {
    let total = 0;
    let n = 0;
    for (let size = 1 << 20; size >= 1; size >>= 1) {
      const text = 'x'.repeat(size);
      for (;;) {
        try {
          localStorage.setItem(`filler-${n}`, text);
          n++;
          total += size;
        } catch {
          break;
        }
      }
    }
    return total;
  });
}

function fillerSum(page: Page): Promise<string> {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('filler-') || k.startsWith('wenming-ditu:world:')).sort();
    return keys.map((k) => `${k}:${localStorage.getItem(k)!.length}`).join('|');
  });
}

const notesOf = (page: Page, id: string) =>
  page.evaluate(async (w) => {
    const { notes } = await (window as any).__wfNotes();
    await notes.notesReady([w]);
    return { known: notes.notesKnown(w), list: notes.exportNotes(w).map((n: { key: string; text: string }) => [n.key, n.text.length]) as [string, number][] };
  }, id);

async function run(browser: Browser) {
  // -------------------------------------------------------------------------
  console.log(' 塞满 localStorage 再存 6 MB');
  const ctx = await browser.newContext();
  let page = await home(ctx);
  const a = (await keepFile(page, plainFile)).id;
  const b = (await keepFile(page, plainFile)).id;
  const filled = await fillStorage(page);
  check(filled > 1_000_000, `localStorage 塞满了(又塞进 ${(filled / 1e6).toFixed(1)} M 字符)`);
  const before = await fillerSum(page);
  const wrote = await page.evaluate(
    async ([w, w2]) => {
      const { notes } = await (window as any).__wfNotes();
      await notes.notesReady([w, w2]);
      const oks: boolean[] = [];
      for (let i = 0; i < 6; i++) oks.push(notes.putNote(w, { key: `长${i}`, kind: '史书', title: '长', text: `${'正文'.repeat(5e5)}${i}`, createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 't' }));
      oks.push(notes.putNote(w2, { key: '一条就很长', kind: '史书', title: '长', text: '字'.repeat(3e6), createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 't' }));
      await notes._notesSettled();
      return { oks, behind: notes.notesBehind(w) };
    },
    [a, b],
  );
  check(wrote.oks.every(Boolean) && wrote.behind === null, '6 MB 都存下了(写的时候)');
  await again(page);
  const na = await notesOf(page, a);
  check(na.known && na.list.filter(([k, n]) => k.startsWith('长') && n === 1e6 + 1).length === 6, `刷新还在:6 条各 100 万字(共 ${na.list.length} 条)`);
  const nb = await notesOf(page, b);
  check(nb.list.some(([k, n]) => k === '一条就很长' && n === 3e6), '另一个世界的一条 300 万字也在');
  check((await fillerSum(page)) === before, 'localStorage 里别的东西、别的世界的存档一点没动');
  check(await page.evaluate(async () => (await (window as any).__wfNotes()).saves.persistent()), '塞满了也还认得 localStorage(世界列表读得出来)');

  // -------------------------------------------------------------------------
  console.log(' 真删了');
  await page.evaluate(async (w) => {
    const { notes } = await (window as any).__wfNotes();
    notes.deleteNote(w, '长0');
    await notes._notesSettled();
  }, a);
  await again(page);
  check(!(await notesOf(page, a)).list.some(([k]) => k === '长0'), '删了的刷新不回来');

  // -------------------------------------------------------------------------
  console.log(' 复制世界、删了再撤销');
  const copied = await page.evaluate(async (w) => {
    const { notes, saves } = await (window as any).__wfNotes();
    localStorage.removeItem('filler-0');
    const nid = saves.duplicateWorld(w);
    if (!nid) throw new Error('复制不了');
    const ok = notes.copyNotes(w, nid);
    await notes._notesSettled();
    return { nid: nid as string, ok };
  }, a);
  check(copied.ok, '复制世界:AI 正文一起带上(写的时候)');
  await again(page);
  check((await notesOf(page, copied.nid)).list.filter(([k]) => k.startsWith('长')).length === 5, '复制世界:刷新还在');
  await page.evaluate(async (w) => {
    const { saves } = await (window as any).__wfNotes();
    const d = saves.deleteWorld(w);
    if (!saves.restoreWorld(d)) throw new Error('放不回来');
  }, a);
  await again(page);
  check((await notesOf(page, a)).list.filter(([k]) => k.startsWith('长')).length === 5, '删了再撤销:刷新还在');

  // -------------------------------------------------------------------------
  console.log(' 存成文件,换一个干净的浏览器打开');
  const saved = await page.evaluate(async (w) => {
    const wf = await (window as any).__wfWorldFiles();
    const out = await wf.saveWorldFile(w);
    if (!out.ok) throw new Error(out.message);
    const bytes = new Uint8Array(await out.file.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(s), stale: out.stale as boolean };
  }, a);
  check(!saved.stale, '存文件时都写进去了');
  const ctx2 = await browser.newContext();
  const page2 = await home(ctx2);
  const back = await keepFile(page2, saved.b64);
  const nBack = await notesOf(page2, back.id);
  check(nBack.list.filter(([k, n]) => k.startsWith('长') && n === 1e6 + 1).length === 5, '干净的浏览器打开:AI 正文都在');
  await ctx2.close();
  await ctx.close();

  // -------------------------------------------------------------------------
  console.log(' 老数据转进去');
  const ctx3 = await browser.newContext();
  page = await home(ctx3);
  const c = (await keepFile(page, plainFile)).id;
  const oldNote = { key: '老:1', kind: '史书', title: '老', text: '以前写在 localStorage 里的', createdAt: '2026-10-01T08:00:00.000Z', provider: 'test', model: 't' };
  await page.evaluate(([w, n]) => localStorage.setItem(`civ-atlas:ai-notes:${w}`, JSON.stringify([n])), [c, oldNote] as const);
  await again(page);
  const moved = await page.evaluate(async (w) => {
    const { notes } = await (window as any).__wfNotes();
    await notes.moveNotes(w);
    return { keys: notes.exportNotes(w).map((n: { key: string }) => n.key), left: localStorage.getItem(`civ-atlas:ai-notes:${w}`), mark: JSON.parse(localStorage.getItem('civ-atlas:ai-notes:~~moved') ?? '{}')[w] };
  }, c);
  check(moved.keys.includes('老:1') && moved.keys.length === 2, '转进去了,和文件里带的合在一起');
  check(!!moved.left && !!moved.mark?.s, '核对过了才记下来;旧的那份先留着');

  console.log(' 刚写完就关页面');
  await page.evaluate(
    async ([w, n]) => {
      const { notes } = await (window as any).__wfNotes();
      await notes.notesReady([w]);
      notes.putNote(w, n);
    },
    [c, { ...oldNote, key: '刚写完', text: '来不及写进仓库' }] as const,
  );
  await page.close();
  page = await home(ctx3);
  const after = await notesOf(page, c);
  check(after.list.some(([k]) => k === '刚写完'), '关得再快,下次打开也在');
  await ctx3.close();

  // -------------------------------------------------------------------------
  console.log(' 超长正文的文件');
  const ctx4 = await browser.newContext();
  page = await home(ctx4);
  const big = await keepFile(page, toB64(longBytes));
  check(big.warnings.join('').includes('AI 写的东西'), '能打开,有提示');
  check((await notesOf(page, big.id)).list.length === 0, '只少这一块');
  const parts = await page.evaluate(async (w) => {
    const wf = await (window as any).__wfWorldFiles();
    const { notes } = await (window as any).__wfNotes();
    const seen: [string, string][][] = [];
    for (let i = 0; i < 2; i++) {
      const out = await wf.saveWorldFile(w);
      if (!out.ok) throw new Error(out.message);
      const looked = await wf.lookWorldFile(out.file);
      if (!looked.ok) throw new Error(looked.message);
      seen.push(looked.facts.manifest.parts.map((p: { name: string; sum: string }) => [p.name, p.sum]));
      notes.putNote(w, { key: '新写的', kind: '史书', title: '新', text: '接着写的', createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 't' });
      await notes._notesSettled();
    }
    return { first: seen[0], second: seen[1] };
  }, big.id);
  check(parts.first.some(([n, s]) => n === 'author' && s === longAuthorSum), '另存字节不丢');
  check(parts.second.some(([n, s]) => n.startsWith('author.kept.') && s === longAuthorSum) && parts.second.some(([n, s]) => n === 'author' && s !== longAuthorSum), '接着写了新的:新的带上,旧的另起名字留着');
  await ctx4.close();

  // -------------------------------------------------------------------------
  console.log(' 浏览器不给 IndexedDB');
  const ctx5 = await browser.newContext();
  await ctx5.addInitScript(() => Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true }));
  page = await home(ctx5);
  await page.evaluate(async () => {
    const { notes } = await (window as any).__wfNotes();
    notes.putNote('wnoidbworld1', { key: 'k', kind: '史书', title: '没有仓库', text: '只在 localStorage 里', createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 't' });
  });
  await again(page);
  const noDb = await notesOf(page, 'wnoidbworld1');
  check(noDb.known && noDb.list.length === 1, '退回 localStorage,和以前一样,刷新还在');
  await ctx5.close();
}

try {
  for (const name of BROWSERS) {
    console.log(`\n${name}`);
    const browser = await (name === 'webkit' ? webkit : chromium).launch();
    try {
      await run(browser);
    } finally {
      await browser.close();
    }
  }
} finally {
  await srv.close();
}
console.log(fails.length ? `\n没过 ${fails.length} 项:\n${fails.join('\n')}` : '\n都过了');
process.exit(fails.length ? 1 : 0);
