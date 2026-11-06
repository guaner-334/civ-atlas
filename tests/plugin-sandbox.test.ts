/**
 * 插件沙箱里外传话的格式、框的内容安全策略、线程里我们自己那段代码。
 * 真在浏览器里试坏事、停插件的在 scripts/sandbox-check.ts(PR 检查里三个浏览器各跑一遍)。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { BOOT, BOOT_HASH, FRAME_SRCDOC, PROTOCOL, readFrameMessage, SANDBOX_FLAGS, workerSource } from '../src/plugin/protocol';

const ROOT = path.resolve(__dirname, '..');

describe('框', () => {
  it('BOOT_HASH 是框里那段代码的散列', () => {
    expect(BOOT_HASH).toBe(`sha256-${createHash('sha256').update(BOOT, 'utf8').digest('base64')}`);
    expect(FRAME_SRCDOC).toContain(`<script>${BOOT}</script>`);
  });

  it('只给 allow-scripts', () => {
    expect(SANDBOX_FLAGS).toBe('allow-scripts');
  });

  it('内容安全策略禁联网、禁从字符串变代码,写在脚本前面', () => {
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(FRAME_SRCDOC);
    expect(m).not.toBeNull();
    expect(FRAME_SRCDOC.indexOf(m![0])).toBeLessThan(FRAME_SRCDOC.indexOf('<script'));
    const csp = new Map(m![1].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]));
    expect(csp.get('default-src')).toBe("'none'");
    expect(csp.get('script-src')).toBe(`'${BOOT_HASH}'`);
    expect(csp.get('worker-src')).toBe('blob:');
    for (const k of ['connect-src', 'img-src', 'style-src', 'font-src', 'media-src', 'object-src', 'frame-src', 'child-src', 'form-action', 'base-uri', 'manifest-src']) {
      expect(csp.get(k), k).toBe("'none'");
    }
    expect(m![1]).not.toMatch(/unsafe-eval|unsafe-inline|wasm-unsafe-eval|strict-dynamic|nonce-/);
  });

  it('网站页面限定只能嵌自己的页面(框跳走靠它拦),写在所有脚本前面', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    expect(meta?.[1]).toContain("frame-src 'self'");
    expect(html.indexOf(meta![0])).toBeLessThan(html.indexOf('<script'));
  });
});

describe('框发来的话', () => {
  const v = PROTOCOL;
  const plugin = (data: unknown) => readFrameMessage({ from: 'plugin', data });

  it('认得合格式的', () => {
    expect(readFrameMessage({ from: 'boot', kind: 'ready' })).toEqual({ from: 'boot', kind: 'ready' });
    expect(readFrameMessage({ from: 'boot', kind: 'error', message: 'x' })).toEqual({ from: 'boot', kind: 'error', message: 'x' });
    expect(plugin({ v, kind: 'hello' })).toEqual({ from: 'plugin', msg: { kind: 'hello' } });
    expect(plugin({ v, kind: 'pong', id: 3 })).toEqual({ from: 'plugin', msg: { kind: 'pong', id: 3 } });
    expect(plugin({ v, kind: 'reply', id: 1, ok: true, data: [1] })).toEqual({ from: 'plugin', msg: { kind: 'reply', id: 1, ok: true, data: [1] } });
    expect(plugin({ v, kind: 'reply', id: 1, ok: false, error: 'no' })).toEqual({ from: 'plugin', msg: { kind: 'reply', id: 1, ok: false, error: 'no' } });
    expect(plugin({ v, kind: 'post', data: { a: 1 } })).toEqual({ from: 'plugin', msg: { kind: 'post', data: { a: 1 } } });
  });

  it('不合格式的一律 null', () => {
    for (const raw of [null, undefined, 'x', 1, [], { from: 'other' }, { from: 'boot' }, { from: 'boot', kind: 'start' }, { from: 'plugin' }]) {
      expect(readFrameMessage(raw), JSON.stringify(raw)).toBeNull();
    }
    for (const data of [
      'garbage',
      { kind: 'hello' },
      { v: v + 1, kind: 'hello' },
      { v, kind: 'start' },
      { v, kind: 'pong' },
      { v, kind: 'pong', id: 0 },
      { v, kind: 'pong', id: -1 },
      { v, kind: 'pong', id: 1.5 },
      { v, kind: 'pong', id: '1' },
      { v, kind: 'reply', id: 1 },
      { v, kind: 'reply', id: 1, ok: 'yes' },
      { from: 'boot', kind: 'error', message: 'forged' },
    ]) {
      expect(plugin(data), JSON.stringify(data)).toBeNull();
    }
  });

  it('错误说明截短', () => {
    const m = readFrameMessage({ from: 'boot', kind: 'error', message: 'x'.repeat(5000) });
    expect(m && m.from === 'boot' && m.kind === 'error' && m.message.length).toBe(500);
  });
});

/** 在 Node 里照线程的样子跑一遍 workerSource:收发的话都记下 */
function runWorker(code: string) {
  const sent: unknown[] = [];
  const handlers: ((e: { data: unknown }) => void)[] = [];
  const ctx: Record<string, unknown> = {
    postMessage: (m: unknown) => sent.push(m),
    addEventListener: (type: string, fn: (e: { data: unknown }) => void) => type === 'message' && handlers.push(fn),
    Worker: function Worker() {},
    Promise,
    queueMicrotask,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(workerSource(code), ctx);
  const deliver = async (data: unknown) => {
    handlers.forEach((h) => h({ data }));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sent, deliver, ctx };
}

describe('线程里我们那段代码', () => {
  const v = PROTOCOL;

  it('插件顶层跑完才说 hello;拿掉了 Worker', () => {
    const w = runWorker('self.order = typeof civAtlas;');
    expect(w.ctx.order).toBe('object');
    expect(w.sent).toEqual([{ v, kind: 'hello' }]);
    expect('Worker' in w.ctx).toBe(false);
  });

  it('顶层里发的话排在 hello 后面', async () => {
    const w = runWorker("civAtlas.post('early'); Promise.resolve().then(() => civAtlas.post('later'));");
    await w.deliver('junk');
    expect(w.sent).toEqual([
      { v, kind: 'hello' },
      { v, kind: 'post', data: 'early' },
      { v, kind: 'post', data: 'later' },
    ]);
  });

  it('最后一行是注释也照样说 hello', () => {
    expect(runWorker('const a = 1 // 没有换行').sent).toEqual([{ v, kind: 'hello' }]);
  });

  it('ping、call、post', async () => {
    const w = runWorker('civAtlas.onCall(async (d) => d * 2); civAtlas.onMessage((d) => civAtlas.post({ got: d }));');
    w.sent.length = 0;
    await w.deliver({ v, kind: 'ping', id: 1 });
    await w.deliver({ v, kind: 'call', id: 2, data: 21 });
    await w.deliver({ v, kind: 'post', data: 'hi' });
    await w.deliver({ v: v + 1, kind: 'ping', id: 3 });
    await w.deliver('junk');
    expect(w.sent).toEqual([
      { v, kind: 'pong', id: 1 },
      { v, kind: 'reply', id: 2, ok: true, data: 42 },
      { v, kind: 'post', data: { got: 'hi' } },
    ]);
  });

  it('插件出错、没接 call 时回错误', async () => {
    const w = runWorker("civAtlas.onCall((d) => { if (d) throw new Error('bad'); return 1; });");
    const bare = runWorker('');
    await w.deliver({ v, kind: 'call', id: 1, data: true });
    await bare.deliver({ v, kind: 'call', id: 1, data: 1 });
    expect(w.sent.at(-1)).toEqual({ v, kind: 'reply', id: 1, ok: false, error: 'bad' });
    expect(bare.sent.at(-1)).toMatchObject({ v, kind: 'reply', id: 1, ok: false });
  });
});

describe('首页不带沙箱', () => {
  it('src 里别处只用 import() 或 import type 引用 plugin/ 下的代码', () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (p !== path.join(ROOT, 'src', 'plugin')) walk(p);
        } else if (/\.tsx?$/.test(e.name)) {
          const text = fs.readFileSync(p, 'utf8');
          for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+['"]([^'"]+)['"]/gm)) {
            if (/(^|\/)plugin\/(sandbox|protocol)$/.test(m[1])) bad.push(`${path.relative(ROOT, p)}: ${m[0].trim()}`);
          }
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(bad).toEqual([]);
  });
});
