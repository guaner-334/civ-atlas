/**
 * 帮手模式(?gallery-helper=1)的浏览器检查:假装作品墙的后台,在框里打开网站、把作品交过去,看交回来的。
 *
 *   npx tsx scripts/gallery-helper-check.ts [--out=<目录>]
 *
 * 用临时 dev server 和本地假服务器(aiServer=fake:服务器的来源就是网站自己)。页面先打开一个存档、存成世界文件,再在同一页里开帮手的框:
 *   第 2 版世界文件  交回封面;停在 at 那年;读的是存下的内容(线程收到的是 load);和照存档现推的封面一样;临时编号用完清掉,「我的世界」没多
 *   第 2 版规则      交回封面和摘要;和官方规则推出来的封面不一样
 *   用了规则的世界文件 交回封面和规则摘要,摘要和同一套规则的规则作品一样;官方规则的世界文件不带摘要
 *   第 1 版          世界存档、新建参数照旧交回封面和名字
 *   第 3 版试跑      examples/plugins 的三个示例插件在种子 7、2024 上各跑一遍,交回的五项、日志、两张截图合理;
 *                    改你写的被拦下、出错、清单要了网站没有的能力、文件坏了都照实交回;
 *                    推演插件(示例插件厌战)两个种子各推 3000 年:和官方比的几样数、编年史、分段推和一口气推的一样、带插件的地图截图
 * 封面、试跑的截图和结果存在 --out(默认 snaps/gallery-helper)。--only=trial 只跑第 3 版,--only=sim 只跑推演插件。没过的打印「没过」,退出码非 0。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { startDevServer } from './lib/devserver';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { rulesHash } from '../src/gen/civ/ruleShare';
import { presetHash } from '../src/ui/presetLink';
import { packPluginFile } from '../src/plugin/pluginFile';
import type { SimTrial } from '../src/plugin/simTrial';
import { parseZip, writeZip } from '../src/gen/zipStore';
import { MANIFEST_FILE } from '../src/gen/worldFormat';

const args = process.argv.slice(2);
const OUT = path.resolve(args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'snaps/gallery-helper');
mkdirSync(OUT, { recursive: true });
const WAIT = 180_000;
/** 推演插件的试跑网站自己限时 3 分钟,另加截图 */
const SIM_WAIT = 240_000;
const ONLY_TRIAL = args.includes('--only=trial');
const ONLY_SIM = args.includes('--only=sim');

const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '  过了' : '  没过'}  ${what}`);
  if (!ok) fails.push(what);
};

interface TrialRunReply {
  seed: number;
  ok: boolean;
  ms: number;
  error?: string;
  log: string[];
  /** 推演插件不带 */
  did: Record<string, string>;
  shots: { map?: string; panel?: string };
  sim?: SimTrial;
}

interface Reply {
  type: string;
  v: number;
  id: string;
  ok: boolean;
  runs?: TrialRunReply[];
  cover?: string;
  info?: { seed: number; year: number; states: number; peoples: number; generator: number };
  texts?: unknown[];
  rules?: { name: string; changed: number; brief: string };
  error?: string;
}

/** 开帮手的框,等它说准备好了;线程收到的请求记在框里的 __sent(只记类型和打开的编号) */
async function openHelper(page: Page, base: string): Promise<unknown> {
  return page.evaluate(
    async ([src, wait]) => {
      const w = window as any;
      w.__replies = [];
      const frame = Object.assign(document.createElement('iframe'), { src, title: 'helper' });
      frame.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px';
      const ready = new Promise<unknown>((ok, no) => {
        const t = setTimeout(() => no(new Error('帮手没说准备好了')), wait as number);
        addEventListener('message', (e) => {
          if (e.source !== frame.contentWindow) return;
          if (e.data?.type === 'civ-atlas:helper-ready') {
            clearTimeout(t);
            ok(e.data);
          } else w.__replies.push(e.data);
        });
      });
      document.body.append(frame);
      w.__frame = frame;
      const msg = await ready;
      const cw = frame.contentWindow as any;
      cw.__sent = [];
      const post = cw.Worker.prototype.postMessage;
      cw.Worker.prototype.postMessage = function (m: any, ...rest: unknown[]) {
        if (m && typeof m === 'object' && typeof m.type === 'string') cw.__sent.push({ type: m.type, vault: m.vault?.id });
        return post.call(this, m, ...rest);
      };
      return msg;
    },
    [`${base}/?gallery-helper=1&aiServer=fake`, WAIT] as const,
  );
}

/** 交一个作品给帮手(file = 页面里 window.__blobs 的哪一个),等它回话 */
async function ask(page: Page, msg: Record<string, unknown>, fileKey?: string, wait = WAIT): Promise<{ reply: Reply; sent: { type: string; vault?: string }[]; ms: number }> {
  return page.evaluate(
    async ([m, key, wait]) => {
      const w = window as any;
      const cw = w.__frame.contentWindow;
      cw.__sent.length = 0;
      const id = (m as { id: string }).id;
      const t0 = performance.now();
      cw.postMessage(key ? { ...(m as object), file: w.__blobs[key as string] } : m, location.origin);
      for (;;) {
        const r = w.__replies.find((x: { id: string }) => x.id === id);
        if (r) return { reply: r, sent: [...cw.__sent], ms: Math.round(performance.now() - t0) };
        if (performance.now() - t0 > (wait as number)) throw new Error(`等不到 ${id}`);
        await new Promise((ok) => setTimeout(ok, 100));
      }
    },
    [msg, fileKey ?? null, wait] as const,
  );
}

/** 两张封面差多少(像素差过 8 的占几成) */
async function coverDiff(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      // 不在页面里定义带名字的函数:tsx 会包一层 __name,页面里没有它
      const got: Uint8ClampedArray[] = [];
      for (const url of [x, y]) {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        got.push(g.getImageData(0, 0, c.width, c.height).data);
      }
      const [p, q] = got;
      if (p.length !== q.length) return 1;
      let n = 0;
      for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 8) n++;
      return n / (p.length / 4);
    },
    [a, b] as const,
  );
}

/** 在首页打开一个存档(json 文件),等历史推完、存下,再存成世界文件放进 window.__blobs[key];交回打开的编号和文件多大 */
async function openAndSave(page: Page, url: string, json: string, key: string): Promise<{ wid: string; bytes: number }> {
  await page.goto(url);
  await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
  await page.setInputFiles('[data-testid=save-file-input]', json);
  await page.waitForFunction(() => new URLSearchParams(location.search).has('w') && (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: WAIT });
  await page.waitForTimeout(2500);
  const wid = new URL(page.url()).searchParams.get('w')!;
  const saved = await page.evaluate(
    async ([id, k]) => {
      const m = await (window as any).__wfWorldFiles();
      const out = await m.saveWorldFile(id);
      if (!out.ok) return { error: `${out.kind} ${out.message}` };
      const w = window as any;
      w.__blobs = { ...w.__blobs, [k as string]: out.file };
      return { bytes: out.file.size as number };
    },
    [wid, key] as const,
  );
  if ('error' in saved) throw new Error(`存不了世界文件:${saved.error}`);
  return { wid, bytes: saved.bytes };
}

/** 页面里 window.__blobs[key] 的内容(base64);换页以后用 putBlob 放回去 */
const takeBlob = (page: Page, key: string): Promise<string> =>
  page.evaluate(async (k) => {
    const b: Blob = (window as any).__blobs[k];
    const u8 = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, key);

const putBlob = (page: Page, key: string, b64: string) =>
  page.evaluate(
    ([k, data]) => {
      const w = window as any;
      w.__blobs = { ...w.__blobs, [k as string]: new Blob([Uint8Array.from(atob(data as string), (c) => c.charCodeAt(0))]) };
    },
    [key, b64] as const,
  );

function saveJpeg(name: string, url: string | undefined) {
  if (!url?.startsWith('data:image/jpeg;base64,')) return 0;
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  writeFileSync(path.join(OUT, `${name}.jpg`), buf);
  return buf.length;
}
const saveCover = (name: string, r: Reply) => saveJpeg(name, r.cover);

/** JPEG 的宽高(读 SOF 段) */
function jpegSize(url: string | undefined): string {
  if (!url) return '';
  const b = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return '';
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return `${b.readUInt16BE(i + 7)}×${b.readUInt16BE(i + 5)}`;
    i += 2 + b.readUInt16BE(i + 2);
  }
  return '';
}

const DID = ['got', 'picked', 'drew', 'wrote', 'said'];

/** 交一个插件文件试跑,存下截图和结果(不带图),交回每个种子的结果 */
async function trial(page: Page, name: string, bytes: Uint8Array, wait = WAIT): Promise<TrialRunReply[]> {
  await putBlob(page, name, Buffer.from(bytes).toString('base64'));
  const t = await ask(page, { type: 'civ-atlas:trial', v: 3, id: `t-${name}`, seeds: [7, 2024] }, name, wait);
  const r = t.reply;
  check(r.type === 'civ-atlas:trial-done' && r.v === 3 && r.ok && r.runs?.length === 2, `${name}:交回了两个种子(${t.ms} 毫秒)${r.error ? `:${r.error}` : ''}`);
  const runs = r.runs ?? [];
  check(JSON.stringify(runs.map((x) => x.seed)) === '[7,2024]', `${name}:种子 7、2024`);
  for (const x of runs) {
    if (!x.sim) check(DID.every((k) => typeof x.did?.[k] === 'string' && x.did[k].length > 0 && [...x.did[k]].length <= 300), `${name}@${x.seed}:五项都有、300 字以内`);
    check(Array.isArray(x.log) && x.log.length <= 50 && x.log.every((l) => [...l].length <= 300), `${name}@${x.seed}:日志 50 条以内`);
    const mb = saveJpeg(`trial-${name}-${x.seed}-map`, x.shots.map);
    const pb = saveJpeg(`trial-${name}-${x.seed}-panel`, x.shots.panel);
    if (x.shots.map) check(mb <= 600 * 1024 && jpegSize(x.shots.map) === '1200×600', `${name}@${x.seed}:地图截图 1200×600、600 KB 以内(${(mb / 1024).toFixed(0)} KB)`);
    if (x.shots.panel) check(pb <= 300 * 1024, `${name}@${x.seed}:面板截图 300 KB 以内(${jpegSize(x.shots.panel)},${(pb / 1024).toFixed(0)} KB)`);
  }
  writeFileSync(path.join(OUT, `trial-${name}.json`), JSON.stringify(runs.map((x) => ({ ...x, shots: { map: !!x.shots.map, panel: !!x.shots.panel } })), null, 2));
  return runs;
}

const packTest = (id: string, requires: string[], code: string) =>
  packPluginFile({ manifest: { id, name: id, version: '1.0.0', role: 'tool', api: 1, runtime: 'worker', requires, license: 'MIT' }, files: { 'main.js': code, 'README.md': id, LICENSE: 'MIT' } });

/** 第 3 版:三个示例插件,和几个故意写坏的 */
async function trialChecks(page: Page) {
  console.log('第 3 版:试跑插件');
  const ex = (id: string) => new Uint8Array(readFileSync(new URL(`../examples/plugins/${id}/${id}.civplugin`, import.meta.url)));
  for (const x of await trial(page, 'coast-distance', ex('coast-distance'))) {
    check(x.ok && !!x.shots.map && !x.shots.panel && x.did.drew.startsWith('地块图层「') && x.did.picked === '没请点' && x.did.wrote === '没有', `离海多远@${x.seed}:画了地块图层、没面板:${JSON.stringify(x.did)}`);
  }
  for (const x of await trial(page, 'route-days', ex('route-days'))) {
    // 两座城隔着水时它只在面板上说走不过去,不画线
    check(x.ok && !!x.shots.map && !!x.shots.panel && /最大的两座城/.test(x.did.picked), `量路程@${x.seed}:替它点了两座城、有面板:${JSON.stringify(x.did)}`);
  }
  for (const x of await trial(page, 'box-summary', ex('box-summary'))) {
    check(x.ok && !!x.shots.panel && /最大的那一国/.test(x.did.picked) && x.did.wrote === '没有', `框选合计@${x.seed}:框了最大的那一国、有面板:${JSON.stringify(x.did)}`);
  }
  const naughtyCode = [
    '(async () => {',
    '  const ps = await civAtlas.history.polities({});',
    "  try { await civAtlas.author.apply({ changes: [{ kind: 'name', key: ps[0].key, name: '改掉' }] }); } catch (e) { civAtlas.log('没改成', e.code); }",
    "  await civAtlas.panel.set({ nodes: [{ type: 'heading', text: '请输入密码' }, { type: 'text', text: '这是假的' }, { type: 'select', id: 'pick', label: '选的是第二项', options: [{ value: 'a', label: '第一项' }, { value: 'b', label: '第二项' }], value: 'b' }, { type: 'slider', id: 'n', label: '滑块在 80', min: 0, max: 100, value: 80 }, { type: 'toggle', id: 't', label: '开着', value: true }] });",
    "  setTimeout(() => { throw new Error('故意出错'); }, 100);",
    '})();',
  ].join('\n');
  for (const x of await trial(page, 'naughty', await packTest('naughty', ['history.read@1', 'author.write@1', 'ui.panel@1'], naughtyCode))) {
    check(
      !x.ok && /故意出错/.test(x.error ?? '') && /^想改 1 次，都拦下了/.test(x.did.wrote) && !!x.shots.panel && x.log.some((l) => l.includes('没改成')),
      `改你写的被拦下、出错照实交回、出错前的面板截到了:${JSON.stringify({ error: x.error, did: x.did, log: x.log })}`,
    );
  }
  const busyCode = "civAtlas.log('开始算');\nsetTimeout(() => { const t = Date.now(); while (Date.now() - t < 1500) {} }, 10);";
  const busy = await trial(page, 'busy', await packTest('busy', ['world.read@1'], busyCode));
  check(busy.every((x) => x.ok && x.ms >= 1400 && x.ms < 5000), `最后一次调用以后还在算的,耗时算到算完:${busy.map((x) => x.ms).join('、')} 毫秒`);
  // 打包会拦下网站没有的能力:先照常打好,再把清单里的 requires 换掉
  const ok = parseZip(await packTest('newer', ['world.read@1'], 'civAtlas.log(1);'), 1 << 22);
  const newerZip = ok.map((e) => {
    if (e.name !== MANIFEST_FILE) return e;
    const m = JSON.parse(new TextDecoder().decode(e.data));
    return { name: e.name, data: new TextEncoder().encode(JSON.stringify({ ...m, requires: ['world.read@1', 'net.fetch@1'] })) };
  });
  const newer = await trial(page, 'newer', new Uint8Array(await (await writeZip(newerZip, 1 << 22)).arrayBuffer()));
  check(newer.every((x) => !x.ok && /网站/.test(x.error ?? '') && x.ms === 0), `清单要了网站没有的能力:${newer[0]?.error}`);
  await putBlob(page, 'broken', Buffer.from('not a plugin').toString('base64'));
  const broken = await ask(page, { type: 'civ-atlas:trial', v: 3, id: 't-broken' }, 'broken');
  check(!!broken.reply.ok && broken.reply.runs?.length === 2 && broken.reply.runs.every((x) => !x.ok && /打不开/.test(x.error ?? '')), `文件坏了:${broken.reply.runs?.[0]?.error}`);
}

/** 推演插件:示例插件厌战,两个种子各推 3000 年 */
async function simTrialChecks(page: Page) {
  console.log('第 3 版:试跑推演插件');
  const weariness = new Uint8Array(readFileSync(new URL('../examples/plugins/weariness/weariness.civplugin', import.meta.url)));
  for (const x of await trial(page, 'weariness', weariness, SIM_WAIT)) {
    const s = x.sim;
    console.log(`  种子 ${x.seed}:${x.ms} 毫秒;${x.log.join(';')}`);
    console.log(`  官方 ${JSON.stringify(s?.stats.official)}\n  带插件 ${JSON.stringify(s?.stats.plugin)}\n  命令 ${JSON.stringify(s?.commands)},编年史 ${s?.lines} 句`);
    check(
      x.ok && !!s && s.years === 3000 && !!s.stats.official && !!s.stats.plugin && (s.commands.treaty ?? 0) > 0 && s.chronicle.length > 0 && s.turns === 3001,
      `厌战@${x.seed}:推完 3000 年、和官方比的几样数、下了立约的命令、写了编年史:${x.error ?? ''}`,
    );
    check(s?.resumeSame === true, `厌战@${x.seed}:推到 1500 年存成文件读回来接着推,和一口气推的一样:${s?.resumeNote ?? ''}`);
    check(x.did === undefined && !!x.shots.map && !x.shots.panel,`厌战@${x.seed}:不带五项和面板,有带插件的地图截图`);
  }
  const counter = await packPluginFile({
    manifest: { id: 'counter', name: '全局变量', version: '1.0.0', role: 'sim', api: 1, runtime: 'quickjs', requires: ['sim.events@1', 'sim.influence@1'], sim: { every: 1, influences: ['war.odds'] }, license: 'MIT' },
    files: { 'main.js': "let n = 0;\ncivAtlas.sim({ act(turn) { n++; const c = turn.influence('war.odds'); for (let i = 0; i < c.length; i++) c[i] = 1 + (n % 7) / 5; return { influences: { 'war.odds': c } }; } });\n", 'README.md': 'counter', LICENSE: 'MIT' },
  });
  for (const x of await trial(page, 'counter', counter, SIM_WAIT)) {
    check(x.sim?.resumeSame === false && /^从第 \d+ 年起史事不一样$/.test(x.sim.resumeNote ?? ''), `用全局变量记数的@${x.seed}:分段推对不上:${x.sim?.resumeNote}`);
  }
}

async function main() {
  const server = await startDevServer();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 })).newPage();
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
    if (ONLY_TRIAL || ONLY_SIM) {
      await page.goto(server.url);
      const ready = (await openHelper(page, server.url)) as { v: number; versions?: number[] };
      check(ready.v === 1 && JSON.stringify(ready.versions) === '[1,2,3]', `帮手说准备好了、听得懂第 1、2、3 版:${JSON.stringify(ready)}`);
      if (ONLY_TRIAL) await trialChecks(page);
      await simTrialChecks(page);
      return;
    }

    // 一个用了非官方规则的世界(规则项、地貌的叫法都改了),先存成世界文件带出来
    const set = { name: '战乱年代', version: 1, values: { 'war.odds': 4, 'split.odds': 0, 'war.truce': 0 }, biomes: { temperateDesert: '灰烬荒原' } };
    const rp = { ...DEFAULT_PARAMS, seed: 7 };
    const rjson = path.join(OUT, 'world-rules.json');
    writeFileSync(rjson, JSON.stringify(makeSave(rp, { names: {}, interventions: [], terrain: [], rules: set }, worldCheck(generateWorld(rp)), '用了规则的世界')));
    const rsaved = await openAndSave(page, server.url, rjson, 'rules');
    console.log(`用了规则的世界文件 ${(rsaved.bytes / 1e6).toFixed(1)} MB`);
    const rulesB64 = await takeBlob(page, 'rules');

    // 一个有地形大事的世界(封面停在大事以后那一段),存成世界文件
    const params = { ...DEFAULT_PARAMS, seed: 2024 };
    const edits = { names: {}, interventions: [], terrain: [], upheavals: [{ year: 500, ops: [{ kind: 'volcano' as const, pts: [1310, 763], r: 60, s: 1.5 }] }] };
    const save = makeSave(params, edits, worldCheck(generateWorld(params)), '检查用的世界');
    const json = path.join(OUT, 'world.json');
    writeFileSync(json, JSON.stringify(save));
    const saved = await openAndSave(page, server.url, json, 'world');
    const wid = saved.wid;
    await putBlob(page, 'rules', rulesB64);
    console.log(`世界文件 ${(saved.bytes / 1e6).toFixed(1)} MB`);
    const listed = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wenming-ditu:world:')).length);
    const before = await listed();

    const ready = (await openHelper(page, server.url)) as { v: number; versions?: number[] };
    check(ready.v === 1 && JSON.stringify(ready.versions) === '[1,2,3]', `帮手说准备好了、听得懂第 1、2、3 版:${JSON.stringify(ready)}`);

    console.log('第 2 版:世界文件');
    const f = await ask(page, { type: 'civ-atlas:render', v: 2, id: 'f1', kind: 'world', at: 'at=1500' }, 'world');
    const fr = f.reply;
    check(fr.ok && fr.v === 2, `交回了(${f.ms} 毫秒)${fr.error ? `:${fr.error}` : ''}`);
    const fb = saveCover('v2-world', fr);
    check(fb > 0 && fb <= 600 * 1024, `封面是 JPEG、600 KB 以内(${(fb / 1024).toFixed(0)} KB)`);
    check(fr.info?.year === 1500 && fr.info.seed === 2024 && fr.info.states > 0, `停在 at 那年、几样数:${JSON.stringify(fr.info)}`);
    check(!('texts' in fr) && !('rules' in fr), '官方规则的世界文件不列名字、不带规则摘要');
    const loads = f.sent.filter((s) => s.type === 'load');
    check(loads.length === 1 && !f.sent.some((s) => s.type === 'generate') && !!loads[0].vault && loads[0].vault !== wid, `读存下的内容,用的是临时编号:${JSON.stringify(f.sent)}`);

    const g = await ask(page, { type: 'civ-atlas:render', v: 1, id: 'f2', kind: 'world', save: { ...save, moment: { year: 1500 } } });
    saveCover('v1-world-same', g.reply);
    check(g.reply.ok && g.sent.some((s) => s.type === 'generate'), `第 1 版照存档现推交回了(${g.ms} 毫秒)`);
    const d = await coverDiff(page, fr.cover!, g.reply.cover!);
    check(d < 0.001, `存下的内容画的和照存档现推的封面一样(差 ${(d * 100).toFixed(3)}%)`);
    check(Array.isArray(g.reply.texts) && g.reply.texts.length > 100, `第 1 版照旧列名字(${g.reply.texts?.length} 个)`);

    await page.waitForTimeout(4000);
    const tmp = loads[0]?.vault ?? '';
    const left = await page.evaluate(async (id) => {
      const ws = await import('/src/ui/worldStore.ts' as string);
      const marks = JSON.parse(localStorage.getItem('civ-atlas:trash') ?? '{}');
      return { marked: id in marks, head: await ws.vaultCall('latestOf', [id]).catch(() => 'err') };
    }, tmp);
    check(!left.marked && !left.head, `临时编号用完清掉了:${JSON.stringify(left)}`);
    check((await listed()) === before, '「我的世界」没多出来');

    console.log('第 2 版:规则');
    const r = await ask(page, { type: 'civ-atlas:render', v: 2, id: 'g1', kind: 'rules', rules: rulesHash(set).slice(1) });
    const rr = r.reply;
    check(rr.ok && rr.v === 2, `交回了(${r.ms} 毫秒)${rr.error ? `:${rr.error}` : ''}`);
    const rb = saveCover('v2-rules', rr);
    check(rb > 0 && rb <= 600 * 1024, `封面是 JPEG、600 KB 以内(${(rb / 1024).toFixed(0)} KB)`);
    check(rr.info?.seed === 7 && rr.info.year === 3000, `种子 7 的地图推到 3000 年:${JSON.stringify(rr.info)}`);
    check(rr.rules?.name === '战乱年代' && rr.rules.changed === 4 && rr.rules.brief === '战争 ×4、议和后 0 年不再开战、不分裂', `摘要:${JSON.stringify(rr.rules)}`);
    const o = await ask(page, { type: 'civ-atlas:render', v: 2, id: 'g2', kind: 'rules', rules: rulesHash({ name: '照抄', version: 1, values: {} }).slice(1) });
    saveCover('v2-rules-official', o.reply);
    check(o.reply.ok && o.reply.rules?.brief === '和官方规则一样', `官方规则:${JSON.stringify(o.reply.rules)}`);
    const rd = await coverDiff(page, rr.cover!, o.reply.cover!);
    check(rd > 0.01, `和官方规则推出来的封面不一样(差 ${(rd * 100).toFixed(1)}%)`);
    const bad = await ask(page, { type: 'civ-atlas:render', v: 2, id: 'g3', kind: 'rules', rules: 'rules=1&war.odds' });
    check(bad.reply.v === 2 && (bad.reply.ok || !!bad.reply.error), `读不全的规则链接也回话:${bad.reply.ok ? '照读' : bad.reply.error}`);

    console.log('第 2 版:用了规则的世界文件');
    const fw = await ask(page, { type: 'civ-atlas:render', v: 2, id: 'f3', kind: 'world' }, 'rules');
    const fwr = fw.reply;
    check(fwr.ok && fwr.v === 2, `交回了(${fw.ms} 毫秒)${fwr.error ? `:${fwr.error}` : ''}`);
    const fwb = saveCover('v2-world-rules', fwr);
    check(fwb > 0 && fwb <= 600 * 1024, `封面是 JPEG、600 KB 以内(${(fwb / 1024).toFixed(0)} KB)`);
    check(fwr.info?.seed === 7 && fwr.info.states > 0 && !('texts' in fwr), `几样数、不列名字:${JSON.stringify(fwr.info)}`);
    check(fwr.rules?.name === '战乱年代' && fwr.rules.changed === 4 && fwr.rules.brief === '战争 ×4、议和后 0 年不再开战、不分裂', `规则摘要:${JSON.stringify(fwr.rules)}`);
    check(JSON.stringify(fwr.rules) === JSON.stringify(rr.rules), '和同一套规则的规则作品交回的摘要一样');
    const fwLoads = fw.sent.filter((s) => s.type === 'load');
    check(fwLoads.length === 1 && !fw.sent.some((s) => s.type === 'generate'), `读存下的内容:${JSON.stringify(fw.sent)}`);

    console.log('第 1 版:新建参数');
    const p = await ask(page, { type: 'civ-atlas:render', v: 1, id: 'p1', kind: 'preset', preset: presetHash({ name: '两块大陆', params: { ...DEFAULT_PARAMS, continents: 2 }, seed: 5730 }).slice(1) });
    saveCover('v1-preset', p.reply);
    check(p.reply.ok && p.reply.v === 1 && p.reply.info?.seed === 5730 && (p.reply.texts?.length ?? 0) > 100, `交回封面和名字(${p.ms} 毫秒,${p.reply.texts?.length} 个名字)`);

    await trialChecks(page);
    await simTrialChecks(page);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().then(
  () => {
    console.log(fails.length ? `\n没过 ${fails.length} 项` : '\n全过了');
    console.log(`封面、试跑的截图在 ${OUT}`);
    process.exit(fails.length ? 1 : 0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
