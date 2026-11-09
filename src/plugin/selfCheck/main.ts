/**
 * 插件隔离自检页(sandbox-check.html):拿真手机打开,一打开就把插件沙箱在这个浏览器里试一遍;
 * 再在后台线程里量推演插件(一回合多久、推出来的和电脑上一不一样、栈够不够)、地图插件(长一张图多花多久、长出来的和电脑上一不一样),只量,不算进全部通过。
 * 只进测试网站的构建、没有入口;不用 React,和首页不共用任何文件。
 */
import '../../ui/theme.css';
import { APP_COMMIT, APP_VERSION } from '../../ui/version';
import { describeDevice } from './device';
import { battery, batteryCode, echo, frameNav, isolation, spin, stops } from './probes';
import { ESCAPED_PARAM, mapRows, report, simRows, summary, verdict, type Raw, type Row } from './verdict';

const ICONS = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  ok2: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.4 2.4 4.6-4.9"/>',
  x2: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
};
const icon = (name: keyof typeof ICONS) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const page = new URL(location.href);
const escapedTop = page.searchParams.has(ESCAPED_PARAM);
if (escapedTop) {
  page.searchParams.delete(ESCAPED_PARAM);
  history.replaceState(null, '', page.href);
}
const device = describeDevice(navigator.userAgent, navigator.maxTouchPoints > 1);
const root = document.getElementById('app')!;

let raw: Raw = { escapedTop };
let rows: Row[] = verdict(raw);
let finishedAt: Date | null = null;
let running = false;
let copyLabel = '';

function render() {
  const sum = summary(rows, finishedAt);
  const big = sum.state === 'run' ? '<span class="spin"></span>' : icon(sum.state === 'ok' ? 'check' : 'close');
  const list = rows
    .map((r) => {
      const bad = r.state === 'bad' || r.state === 'err';
      const mark = r.state === 'run' ? '<span class="spin"></span>' : icon(bad ? 'x2' : 'ok2');
      const line = `<div class="ck ${bad ? 'bad' : r.state}">${mark}${esc(r.label)}<span class="r">${esc(r.result)}</span></div>`;
      return bad ? `${line}<div class="why">${esc(r.why)}</div>` : line;
    })
    .join('');
  // 推演插件、地图插件那两组:没过的照样标红,量出来的那句(估几秒)过了也写
  const measured = (rs: Row[]) =>
    rs
      .map((r) => {
        const bad = r.state === 'bad' || r.state === 'err';
        const mark = r.state === 'run' ? '<span class="spin"></span>' : icon(bad ? 'x2' : 'ok2');
        const line = `<div class="ck ${bad ? 'bad' : r.state}">${mark}${esc(r.label)}<span class="r">${esc(r.result)}</span></div>`;
        return r.why ? `${line}<div class="why${bad ? '' : ' note'}">${esc(r.why)}</div>` : line;
      })
      .join('');
  const sims = measured(simRows(raw));
  const maps = measured(mapRows(raw));
  const tip =
    sum.state === 'bad'
      ? '复制的结果里带着浏览器型号和每一项的原始数，开发拿到就知道是哪里。'
      : '在 QQ、微信里查：把这页的网址发给自己，点开就是它们自带的浏览器。每个浏览器查一遍，把结果复制下来发给开发。';
  root.innerHTML = `
    <div class="site">文明与地图 测试网站</div>
    <h1>插件隔离自检</h1>
    <div class="dev">${icon('phone')}这台：${esc(device)}</div>
    <div class="sum ${sum.state}"><span class="big">${big}</span><span><b>${esc(sum.title)}</b><small>${esc(sum.note)}</small></span></div>
    <div class="grp">${list}</div>
    <div class="gl">推演插件</div>
    <div class="grp">${sims}</div>
    <div class="gl">地图插件</div>
    <div class="grp">${maps}</div>
    <div class="bs">
      <button type="button" class="btn" data-act="again"${running ? ' disabled' : ''}>再查一次</button>
      <button type="button" class="btn pri" data-act="copy"${running ? ' disabled' : ''}>${copyLabel || '复制结果'}</button>
    </div>
    <p class="tip">${tip}</p>`;
  (window as unknown as { __selfCheck: unknown }).__selfCheck = { done: !running && !!finishedAt, rows, raw };
}

function update() {
  rows = verdict(raw);
  render();
}

async function step<K extends Exclude<keyof Raw, 'escapedTop'>>(key: K, fn: () => Promise<NonNullable<Raw[K]>>, ms = 45_000) {
  try {
    raw[key] = await Promise.race([fn(), sleep(ms).then(() => Promise.reject(new Error(`no result in ${ms / 1000}s`)))]);
  } catch (e) {
    raw[key] = { error: String((e as Error)?.message ?? e).slice(0, 200) } as Raw[K];
  }
  update();
}

/** 推演插件那一组:开一个后台线程,先交一回合多久和散列,再交栈够不够;ms 内没交齐的算没量成 */
function simGroup(ms = 120_000): Promise<void> {
  return new Promise((resolve) => {
    const fail = (e: string) => {
      raw.sim ??= { error: e };
      raw.stack ??= { error: e };
    };
    let w: Worker;
    try {
      w = new Worker(new URL('./simProbe.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      fail(String((e as Error)?.message ?? e).slice(0, 200));
      update();
      return resolve();
    }
    const done = () => {
      clearTimeout(t);
      w.terminate();
      update();
      resolve();
    };
    const t = setTimeout(() => {
      fail(`no result in ${ms / 1000}s`);
      done();
    }, ms);
    w.onmessage = (e: MessageEvent<{ sim?: Raw['sim']; stack?: Raw['stack']; error?: string }>) => {
      const m = e.data;
      if (m.sim) raw.sim = m.sim;
      if (m.stack) raw.stack = m.stack;
      if (m.error) fail(m.error);
      if (raw.stack) done();
      else update();
    };
    w.onerror = (e) => {
      e.preventDefault();
      fail(`worker error: ${e.message || 'crashed'}`.slice(0, 200));
      done();
    };
    w.postMessage(null);
  });
}

/** 地图插件那一组:另开一个后台线程,ms 内没交的算没量成 */
function mapGroup(ms = 120_000): Promise<void> {
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./mapProbe.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      raw.map = { error: String((e as Error)?.message ?? e).slice(0, 200) };
      update();
      return resolve();
    }
    const done = (r: Raw['map']) => {
      clearTimeout(t);
      w.terminate();
      raw.map = r;
      update();
      resolve();
    };
    const t = setTimeout(() => done({ error: `no result in ${ms / 1000}s` }), ms);
    w.onmessage = (e: MessageEvent<{ map?: Raw['map']; error?: string }>) => done(e.data.map ?? { error: e.data.error ?? 'no result' });
    w.onerror = (e) => {
      e.preventDefault();
      done({ error: `worker error: ${e.message || 'crashed'}`.slice(0, 200) });
    };
    w.postMessage(null);
  });
}

async function runAll(first: boolean) {
  running = true;
  finishedAt = null;
  copyLabel = '';
  raw = { escapedTop: first && escapedTop };
  update();
  await step('battery', () => battery(batteryCode(page)));
  await step('isolation', isolation);
  await step('echo', echo);
  await step('stops', stops);
  // 量卡不卡、框跳走都单独跑,别的插件不同时占着手机
  await step('spin', spin);
  await step('nav', () => frameNav(page, raw.escapedTop));
  await simGroup();
  await mapGroup();
  running = false;
  finishedAt = new Date();
  update();
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // QQ、微信里有的没有 clipboard,换老办法
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

root.addEventListener('click', async (e) => {
  const act = (e.target as HTMLElement).closest('button')?.dataset.act;
  if (running || !act) return;
  if (act === 'again') {
    void runAll(false);
    return;
  }
  if (act === 'copy' && finishedAt) {
    const ok = await copy(report(rows, raw, { when: finishedAt, url: page.href, device, ua: navigator.userAgent, site: `v${APP_VERSION}${APP_COMMIT ? `（${APP_COMMIT}）` : ''}` }));
    copyLabel = ok ? '已复制' : '没复制上';
    render();
    setTimeout(() => {
      copyLabel = '';
      if (!running) render();
    }, 2000);
  }
});

void runAll(true);
