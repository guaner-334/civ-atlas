/**
 * 开一个插件沙箱(传话格式见 ./protocol.ts)。只在用到插件时 import(),首页不带它。
 */
import { FRAME_SRCDOC, PROTOCOL, readFrameMessage, SANDBOX_FLAGS, workerSource, type PluginMessage } from './protocol';

export type StopReason = 'stopped' | 'start-timeout' | 'unresponsive' | 'crashed' | 'protocol';

export class SandboxStopped extends Error {
  constructor(
    readonly reason: StopReason,
    readonly detail = '',
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'SandboxStopped';
  }
}

export interface SandboxOptions {
  /** 框挂在哪,默认 document.body */
  parent?: HTMLElement;
  startTimeoutMs?: number;
  onMessage?: (data: unknown) => void;
  onStop?: (reason: StopReason, detail: string) => void;
}

export interface PluginSandbox {
  /** 停了没有、为什么停 */
  readonly stopped: StopReason | null;
  /** 单向发给插件;停了就不发 */
  send(data: unknown, transfer?: Transferable[]): void;
  /** 插件 onCall 的回话;超时就停掉插件 */
  call(data: unknown, opts?: { timeoutMs?: number; transfer?: Transferable[] }): Promise<unknown>;
  /** 插件线程有没有被占死;超时就停掉插件 */
  ping(timeoutMs?: number): Promise<void>;
  stop(): void;
}

const START_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 5_000;
const PING_TIMEOUT_MS = 2_000;

interface Pending {
  kind: 'pong' | 'reply';
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

class Sandbox implements PluginSandbox {
  stopped: StopReason | null = null;
  private readonly frame: HTMLIFrameElement;
  private readonly win: Window;
  private state: 'boot' | 'start' | 'run' = 'boot';
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly startTimer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly code: string,
    private readonly opts: SandboxOptions,
    private readonly started: (sb: Sandbox) => void,
    private readonly failed: (e: SandboxStopped) => void,
  ) {
    const f = document.createElement('iframe');
    // sandbox、srcdoc 都要在挂上页面之前设好,第一份文档就得是不透明来源
    f.setAttribute('sandbox', SANDBOX_FLAGS);
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = 'position:absolute;width:0;height:0;border:0;pointer-events:none';
    f.srcdoc = FRAME_SRCDOC;
    this.frame = f;
    addEventListener('message', this.listen);
    (opts.parent ?? document.body).append(f);
    this.win = f.contentWindow!;
    this.startTimer = setTimeout(() => this.halt('start-timeout'), opts.startTimeoutMs ?? START_TIMEOUT_MS);
  }

  private readonly listen = (e: MessageEvent) => {
    // 框是不透明来源,origin 都是 "null",只能认是哪个窗口发的
    if (this.stopped || e.source !== this.win) return;
    const m = readFrameMessage(e.data);
    if (!m) return this.halt('protocol', 'malformed message');
    if (m.from === 'boot') {
      if (m.kind === 'error') return this.halt('crashed', m.message);
      if (this.state !== 'boot') return this.halt('protocol', 'unexpected ready');
      this.state = 'start';
      this.win.postMessage({ kind: 'start', code: workerSource(this.code) }, '*');
      return;
    }
    this.onPlugin(m.msg);
  };

  private onPlugin(m: PluginMessage) {
    if (m.kind === 'hello') {
      if (this.state !== 'start') return this.halt('protocol', 'unexpected hello');
      this.state = 'run';
      clearTimeout(this.startTimer);
      this.started(this);
      return;
    }
    if (this.state !== 'run') return this.halt('protocol', `${m.kind} before hello`);
    if (m.kind === 'post') {
      this.opts.onMessage?.(m.data);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p || p.kind !== m.kind) return this.halt('protocol', `unexpected ${m.kind} ${m.id}`);
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.kind === 'pong') p.resolve(undefined);
    else if (m.ok) p.resolve(m.data);
    else p.reject(new Error(m.error));
  }

  private toWorker(msg: Record<string, unknown>, transfer: Transferable[] = []) {
    this.win.postMessage({ kind: 'to', data: { v: PROTOCOL, ...msg }, t: transfer }, '*', transfer);
  }

  private ask(kind: 'ping' | 'call', data: unknown, timeoutMs: number, transfer?: Transferable[]): Promise<unknown> {
    if (this.stopped) return Promise.reject(new SandboxStopped(this.stopped));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.halt('unresponsive', `${kind} took over ${timeoutMs} ms`), timeoutMs);
      this.pending.set(id, { kind: kind === 'ping' ? 'pong' : 'reply', resolve, reject, timer });
      try {
        this.toWorker(kind === 'ping' ? { kind, id } : { kind, id, data }, transfer);
      } catch (e) {
        // 网站这边递了传不过去的东西(函数之类),不怪插件
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  send(data: unknown, transfer?: Transferable[]) {
    if (!this.stopped) this.toWorker({ kind: 'post', data }, transfer);
  }

  call(data: unknown, opts: { timeoutMs?: number; transfer?: Transferable[] } = {}) {
    return this.ask('call', data, opts.timeoutMs ?? CALL_TIMEOUT_MS, opts.transfer);
  }

  async ping(timeoutMs = PING_TIMEOUT_MS) {
    await this.ask('ping', undefined, timeoutMs);
  }

  stop() {
    this.halt('stopped');
  }

  /** 整个拿掉框:只把框跳到空白页的话,Chromium、WebKit 里死循环的线程会一直转 */
  private halt(reason: StopReason, detail = '') {
    if (this.stopped) return;
    this.stopped = reason;
    removeEventListener('message', this.listen);
    clearTimeout(this.startTimer);
    try {
      this.win.postMessage({ kind: 'stop' }, '*');
    } catch {
      // 框已经不在了
    }
    this.frame.remove();
    const err = new SandboxStopped(reason, detail);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    if (this.state !== 'run') this.failed(err);
    this.opts.onStop?.(reason, detail);
  }
}

/** 开好(插件代码顶层跑完)才 resolve;没开成 reject SandboxStopped */
export function startPluginSandbox(code: string, opts: SandboxOptions = {}): Promise<PluginSandbox> {
  return new Promise((resolve, reject) => {
    new Sandbox(code, opts, resolve, reject);
  });
}
