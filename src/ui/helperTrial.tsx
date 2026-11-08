/**
 * 帮手第 3 版:后台审插件时的试跑(传话见 helperProtocol.ts)。每个种子生成一个示例世界(默认参数),
 * 用和用的人从文件装上时同一套沙箱临时开这个插件(不进插件仓库,存的数据只在内存里),照 plugin/trial.ts 的固定办法替它点、
 * 拦下改你写的东西;跑完(或到了限时)截地图(1200×600,带它的图层)和面板,交回它做了什么。用到时才下载。
 * 推演插件另走一条(simTrial):推 3000 年和官方比,见 plugin/simTrial.ts。
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Civ } from '../gen/civ/types';
import { DEFAULT_PARAMS } from '../gen/params';
import type { World } from '../gen/world';
import type { SimPluginFile } from '../plugin/pluginWorld';
import type { SimTrialSeed } from '../plugin/simTrial';
import type { SimTrialJob, SimTrialReply } from '../plugin/simTrialWorker';
import type { CellPaint } from '../render/pluginLayer';
import { PluginRefused, startPluginHost, type PluginHost } from '../plugin/host';
import { SandboxStopped } from '../plugin/sandbox';
import { PLUGIN_ICON, PluginFileError, openPluginFile, type OpenedPlugin } from '../plugin/pluginFile';
import { memoryStore } from '../plugin/store';
import { TRIAL_MS, TRIAL_QUIET_MS, TrialRecorder } from '../plugin/trial';
import type { PanelNode } from '../plugin/types';
import { NAME_ZOOM, type MarkFrame } from '../render/marks';
import { drawPluginMarks } from '../render/pluginMarks';
import { canvasOf, coverJpeg, ctxOf, politicalCanvas, run, type Generated } from './galleryHelper';
import type { TrialRequest, TrialRun } from './helperProtocol';
import { PluginIcon } from './plugins/pluginIcons';
import { versionLabel } from './plugins/pluginText';
import { PanelView } from './plugins/tools/PanelView';
import './countryPanel.css';
import './plugins/tools/tools.css';

const SHOT_W = 1200;
const SHOT_H = 600;
/** 面板截图:和电脑上的侧栏一样宽;太长的截到这么高 */
const PANEL_W = 340;
const PANEL_MAX_H = 1400;
const PANEL_BYTES = 300 * 1024;

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** ping 回得比这慢 = 插件线程刚才在算 */
const PING_SLOW_MS = 50;

/** 试跑一个插件:每个种子一份;插件文件打不开也是每个种子一份 ok = false。生成不了示例世界才抛出 */
export async function runTrial(req: TrialRequest): Promise<TrialRun[]> {
  let opened: OpenedPlugin | null = null;
  let refusal = '';
  try {
    opened = await openPluginFile(req.file);
  } catch (e) {
    refusal = e instanceof PluginFileError && e.kind === 'newer' ? e.message : `插件文件打不开：${e instanceof Error ? e.message : String(e)}`;
  }
  if (opened?.manifest.role === 'sim') return simTrial(req, opened);
  const runs: TrialRun[] = [];
  for (const seed of req.seeds) {
    runs.push(
      opened
        ? await trialSeed(opened, seed)
        : { seed, ok: false, ms: 0, error: refusal.slice(0, 300), log: [], did: { got: '没拿', picked: '没请点', drew: '没画', wrote: '没有', said: '没发话' }, shots: {} },
    );
  }
  return runs;
}

async function trialSeed(p: OpenedPlugin, seed: number): Promise<TrialRun> {
  const g = await run({ type: 'generate', params: { ...DEFAULT_PARAMS, seed }, scale: 1 });
  try {
    const year = Math.floor(g.civ?.endYear ?? 0);
    const rec = new TrialRecorder({ world: g.world, civ: g.civ, year });
    const t0 = performance.now();
    let host: PluginHost | null = null;
    let done = false;
    try {
      host = await startPluginHost({
        plugin: p.manifest,
        code: p.code,
        source: rec.source(),
        sink: rec.sink(),
        stores: { local: memoryStore(), world: memoryStore() },
        onMessage: () => rec.posted(),
        onStop: (reason, detail) => rec.stopped(reason, detail),
      });
      done = await settle(host, rec, t0 + TRIAL_MS);
    } catch (e) {
      // 开到一半停下的(没反应、出错)停的时候已经记了
      if (e instanceof PluginRefused) rec.fault(e.kind === 'newer' ? e.message : `清单要的能力写得不对：${e.message}`);
      else if (!(e instanceof SandboxStopped)) rec.fault(`没开成：${e instanceof Error ? e.message : String(e)}`);
      done = true;
    }
    if (!done) rec.fault(`${TRIAL_MS / 1000} 秒内没跑完，到时停掉了`);
    const ms = Math.round(Math.min(TRIAL_MS, Math.max(0, (done ? rec.last : performance.now()) - t0)));
    rec.freeze();
    host?.stop();
    const did = rec.did();
    const shots: TrialRun['shots'] = {};
    try {
      shots.map = await mapShot(g, year, rec);
    } catch {
      // 截不到就不带(后台写「没截到地图」)
    }
    if (rec.panel?.length) {
      try {
        shots.panel = await panelShot(p, rec.panel);
      } catch {
        // 同上
      }
    }
    return { seed, ok: !rec.error, ms, ...(rec.error ? { error: rec.error } : {}), log: rec.logLines(), did, shots };
  } finally {
    g.stop();
  }
}

/** 推演插件两个种子一共最多跑多久(推得慢,不按工具插件的 TRIAL_MS) */
const SIM_TRIAL_MS = 180_000;

/** 推演插件:每个种子在一个后台线程里推(plugin/simTrial.ts),截带插件推到最后一年的政区图、盖上它的第一个图层 */
async function simTrial(req: TrialRequest, p: OpenedPlugin): Promise<TrialRun[]> {
  const files: SimPluginFile[] = [{ id: p.manifest.id, sum: p.sum, bytes: new Uint8Array(await req.file.arrayBuffer()) }];
  const until = performance.now() + SIM_TRIAL_MS;
  const runs: TrialRun[] = [];
  for (const seed of req.seeds) {
    const t0 = performance.now();
    if (t0 >= until) {
      runs.push({ seed, ok: false, ms: 0, error: `${SIM_TRIAL_MS / 60_000} 分钟限时到了，没轮到这个种子`, log: [], shots: {} });
      continue;
    }
    const got = await simInWorker({ seed, files }, until);
    const shots: TrialRun['shots'] = {};
    if (got.civ) {
      try {
        shots.map = await simMapShot(seed, got.civ, got.paint);
      } catch {
        // 截不到就不带(后台写「没截到地图」)
      }
    }
    const r = got.result;
    const error = got.error ?? r?.error;
    runs.push({ seed, ok: !error, ms: Math.round(performance.now() - t0), ...(error ? { error: error.slice(0, 300) } : {}), log: r?.log ?? [], shots, ...(r ? { sim: r.sim } : {}) });
  }
  return runs;
}

/** 在后台线程里试跑一个种子;到了 until 停掉线程,交回到那时为止的结果(error 写停在哪一步) */
function simInWorker(job: SimTrialJob, until: number): Promise<{ result: SimTrialSeed | null; error?: string; civ: Civ | null; paint: CellPaint | null }> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('../plugin/simTrialWorker.ts', import.meta.url), { type: 'module' });
    let result: SimTrialSeed | null = null;
    let civ: Civ | null = null;
    let paint: CellPaint | null = null;
    const finish = (error?: string) => {
      clearTimeout(timer);
      w.terminate();
      resolve({ result, ...(error ? { error } : {}), civ, paint });
    };
    const timer = setTimeout(() => {
      const stage = !result ? '官方推的时候' : !result.sim.stats.plugin ? '带插件推的时候' : '查分段推的时候';
      finish(`${SIM_TRIAL_MS / 60_000} 分钟限时到了，停在${stage}`);
    }, until - performance.now());
    w.onmessage = (e: MessageEvent<SimTrialReply>) => {
      const m = e.data;
      if (m.type === 'step') result = m.result;
      else if (m.type === 'civ') ({ civ, paint } = m);
      else if (m.type === 'done') {
        result = m.result;
        finish();
      } else finish(`没跑成：${m.error}`);
    };
    w.onerror = (e) => finish(`后台线程出错：${e.message || '不知道为什么'}`);
    w.postMessage(job satisfies SimTrialJob);
  });
}

/** 带插件推到最后一年的政区图,盖上它的第一个图层,缩到 1200×600 */
async function simMapShot(seed: number, civ: Civ, paint: CellPaint | null): Promise<string> {
  const g = await run({ type: 'generate', params: { ...DEFAULT_PARAMS, seed }, scale: 1, skipCiv: true });
  try {
    const big = await politicalCanvas({ ...g, civ }, Math.floor(civ.endYear), undefined, paint ?? undefined);
    try {
      return coverJpeg(big);
    } finally {
      big.width = big.height = 0;
    }
  } finally {
    g.stop();
  }
}

/** 跑完了 = 安静了 TRIAL_QUIET_MS、线程也空着(在算的插件 ping 要等它算完);到了 until 还没完 = false */
async function settle(h: PluginHost, rec: TrialRecorder, until: number): Promise<boolean> {
  while (performance.now() < until) {
    if (h.sandbox.stopped) return true;
    if (performance.now() - rec.last < TRIAL_QUIET_MS) {
      await sleep(50);
      continue;
    }
    const sent = performance.now();
    try {
      await h.sandbox.ping(Math.max(200, until - performance.now()));
    } catch {
      return true;
    }
    const back = performance.now();
    if (back - sent > PING_SLOW_MS) {
      rec.busyUntil(back);
      continue;
    }
    if (back - rec.last >= TRIAL_QUIET_MS) return true;
  }
  return !!h.sandbox.stopped;
}

/** 地图截图:政区图 + 它开着的地块图层,缩到 1200×600 再画它的标注(线、点、字和屏幕上一样大) */
async function mapShot(g: Generated, year: number, rec: TrialRecorder): Promise<string> {
  const cells = rec.cellLayer();
  const big = await politicalCanvas(g, year, undefined, cells ?? undefined);
  const c = canvasOf(SHOT_W, SHOT_H);
  const x = ctxOf(c);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(big, 0, 0, SHOT_W, SHOT_H);
  big.width = big.height = 0;
  const marks = rec.markLayers();
  if (marks.length) drawPluginMarks(x, marks, shotFrame(g.world), g.world.mesh);
  try {
    return coverJpeg(c);
  } finally {
    c.width = c.height = 0;
  }
}

function shotFrame(world: World): MarkFrame {
  const sx = SHOT_W / world.width;
  const sy = SHOT_H / world.height;
  return { pt: (wx, wy) => [wx * sx, wy * sy], period: SHOT_W, win: [0, SHOT_W], w: SHOT_W, h: SHOT_H, k: NAME_ZOOM, textK: 1, cut: 0 };
}

function iconData(p: OpenedPlugin): string | null {
  const b = p.files.get(PLUGIN_ICON);
  if (!b) return null;
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

/** 面板截图里的卡片:和网站上开着的插件卡一样(浅色),只有名字、作者、第几版和它的面板 */
function TrialCard({ p, nodes }: { p: OpenedPlugin; nodes: readonly PanelNode[] }) {
  const m = p.manifest;
  return (
    <section
      className="inspector cpanel"
      data-theme="light"
      style={{ position: 'static', width: PANEL_W, maxWidth: 'none', height: 'auto', maxHeight: 'none', animation: 'none', boxShadow: 'none', backdropFilter: 'none', WebkitBackdropFilter: 'none', background: 'var(--panel-solid)' }}
    >
      <div className="cp plg-card">
        <div className="cp-head">
          <PluginIcon src={iconData(p)} size="md" className="plg-ci" />
          <div className="cp-title">
            <div className="plg-cn">
              <span>{m.name}</span>
              <span className="plg-tag">插件</span>
            </div>
            <span className="cp-sub">
              {m.author?.name ? `${m.author.name} 写的，` : ''}
              {versionLabel(m.version)}
            </span>
          </div>
        </div>
        <div className="cp-body plg-cb" style={{ overflow: 'visible' }}>
          <PanelView nodes={nodes} act={() => {}} />
        </div>
      </div>
    </section>
  );
}

/** 页面上管得着这张卡的样式(去掉悬停这类状态再比;深色、窄屏的不要) */
function cssFor(root: Element): string {
  const els = [root, ...root.querySelectorAll('*')];
  const used = (sel: string) =>
    sel.split(',').some((part) => {
      const s = part
        .replace(/::?(before|after|placeholder|marker|selection|-webkit-[\w-]+)\b/g, '')
        .replace(/:(hover|active|focus|focus-visible|focus-within|visited)\b/g, '')
        .trim();
      try {
        return !s || els.some((e) => e.matches(s));
      } catch {
        return true;
      }
    });
  const out: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) {
        if (/:root|data-theme/.test(r.selectorText) || used(r.selectorText)) out.push(r.cssText);
      } else if (r instanceof CSSMediaRule) {
        if (!/prefers-color-scheme:\s*dark/.test(r.conditionText) && matchMedia(r.conditionText).matches) walk(r.cssRules);
      } else if (r instanceof CSSSupportsRule) {
        if (CSS.supports(r.conditionText)) walk(r.cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // 别的来源的样式表读不了
    }
  }
  return out.join('\n');
}

/** 拷一份卡片:下拉选中哪项、滑块的值这些只在属性(property)上,序列化前写成 HTML 属性 */
function formsAsAttrs(card: HTMLElement): HTMLElement {
  const copy = card.cloneNode(true) as HTMLElement;
  const from = card.querySelectorAll('select, input');
  const to = copy.querySelectorAll('select, input');
  from.forEach((el, i) => {
    const c = to[i];
    if (el instanceof HTMLSelectElement) {
      Array.from(el.options).forEach((o, k) => (o.selected ? (c as HTMLSelectElement).options[k].setAttribute('selected', '') : (c as HTMLSelectElement).options[k].removeAttribute('selected')));
    } else if (el instanceof HTMLInputElement) {
      c.setAttribute('value', el.value);
      if (el.checked) c.setAttribute('checked', '');
      else c.removeAttribute('checked');
    }
  });
  return copy;
}

/**
 * 面板截图:照网站自己的插件卡画出来,连同管得着它的样式放进一张 SVG(foreignObject)再画到画布上。
 * 浏览器不让这样画(画布被当成别处来的)就抛出,后台写「没截到面板」
 */
async function panelShot(p: OpenedPlugin, nodes: readonly PanelNode[]): Promise<string> {
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-${PANEL_W * 4}px;top:0;width:${PANEL_W}px;pointer-events:none`;
  document.body.append(box);
  const root = createRoot(box);
  try {
    flushSync(() => root.render(<TrialCard p={p} nodes={nodes} />));
    await document.fonts?.ready;
    const card = box.firstElementChild as HTMLElement;
    const h = Math.min(PANEL_MAX_H, Math.ceil(card.getBoundingClientRect().height));
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${PANEL_W}px;height:${h}px;overflow:hidden;background:#fff`;
    wrap.append(Object.assign(document.createElement('style'), { textContent: cssFor(card) }), formsAsAttrs(card));
    const xml = new XMLSerializer().serializeToString(wrap);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_W}" height="${h}"><foreignObject x="0" y="0" width="${PANEL_W}" height="${h}">${xml}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const c = canvasOf(PANEL_W * 2, h * 2);
    const x = ctxOf(c);
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, c.width, c.height);
    x.scale(2, 2);
    x.drawImage(img, 0, 0, PANEL_W, h);
    try {
      for (const q of [0.9, 0.8, 0.7, 0.55]) {
        const url = c.toDataURL('image/jpeg', q);
        if (!url.startsWith('data:image/jpeg')) break;
        if (Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4) <= PANEL_BYTES) return url;
      }
      throw new Error('面板截图压不到 300 KB 以内');
    } finally {
      c.width = c.height = 0;
    }
  } finally {
    root.unmount();
    box.remove();
  }
}
