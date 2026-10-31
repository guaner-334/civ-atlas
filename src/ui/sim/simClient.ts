/**
 * 和生成世界、推演历史的后台线程(src/worker.ts)打交道的那一层:开线程、关线程、发请求、记账(线程手上还有几件没回音的活),
 * 收到消息先做各种消息共有的几步,剩下的按消息类型交给界面给的回调(on)。不碰 React、不碰 DOM;线程由 spawn 开(测试换成假的)。
 *
 * 线程一次只能算一个世界。连续改参数时,与其排队把每个中间世界都算完,不如直接终止还在忙的旧线程、另开一个
 * (启动只要几十毫秒),只算最后一次。回放帧、重推文明这些短活不打断线程,排在后面(打断了,线程手上的世界就没了,
 * 得按参数重新生成,反而更慢)。编辑地形时只换地形的生成(skipCiv)也不关线程:线程自己半路放下它(见 worker.ts 文件头),
 * 记着的网格、整图留给新的一笔。
 *
 * 线程出错(onerror):线程手上那件活不会再有回音了 —— 出错的那件活线程不交结果、排着的也不再做(worker.ts 的 broken),
 * 真死掉(内存不够)的线程更是什么都不回。当它坏了:关掉,开一个新的,把还没回音的活按原来的先后再发一遍
 * (请求本身带齐了参数,新线程按参数重新生成,结果一样,只是慢一点)。
 * 只重发一次:最前面那件(出错时线程正在做的)已经重发过、又出错了,就不再发它,交给 lost 让界面收起它(其余的照旧再发);
 * 换下来的线程后来的消息照第 1 条不管。
 *
 * 照原样打开的旧世界(读档 load,地形按原件、不按现在的生成器):线程被重开过(出错、叫停再推)时先发 pin 把它重新钉住,
 * 不然新线程按参数生成的是另一颗星球。
 *
 * 收到一条消息,按这个先后:
 *   1. 已被换掉的线程发来的:不管
 *   2. 交历史之前先交的几段历史(civPart,src/civParts.ts):收着;交历史的那条到了先拼回去,别处拿到的都是整份
 *   3. 记账:算一件回音的(见 QUIET)手上最早的那件活回完了;都回完了"在忙什么"清掉
 *   4. 半路放下的生成(aborted):只是一声回音,到此为止
 *   5. 记下线程回报的扩张节拍(tempo),下次发请求带回去
 *   6. 试推演(trial):交给等着它的那一次,到此为止
 *   7. 不是现在这个世界的请求(currentId 对不上):不管
 *   8. 交历史之前先交的编年史(chronicle):收着;交历史的那条(done、civ、civOnly、turn、extended、outlined)到了一起记下
 *      (src/ui/chronicleHandoff.ts)
 *   9. 按类型交给 on 里的回调(同步调,不绕异步)
 */
import { CivPartInbox } from '../../civParts';
import { diagBeat, recordWorkerError } from '../../diag/watch';
import type { Civ } from '../../gen/civ';
import type { LoadRequest, TempoNote, WorkerRequest, WorkerResponse } from '../../worker';
import { adoptChronicle, dropChronicleParts, takeChroniclePart } from '../chronicleHandoff';

/** 线程:浏览器的 Worker,测试里换成假的 */
export interface SimWorker {
  postMessage(m: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

type Msg<K extends WorkerResponse['type']> = Extract<WorkerResponse, { type: K }>;
/** 客户端自己收拾的:分段先交的历史、编年史,半路放下的回音,试推演的结果 */
type Internal = 'civPart' | 'chronicle' | 'aborted' | 'trial';
/** 每种消息交给谁(现在这个世界的;记账、拼历史、记编年史都已做完) */
export type SimHandlers = { [K in Exclude<WorkerResponse['type'], Internal>]: (m: Msg<K>) => void };

export interface SimClientOptions {
  /** 开一个新线程 */
  spawn: () => SimWorker;
  /** 现在这个世界的请求编号:消息带的编号对不上就是上一个世界的,不交给 on */
  currentId: () => number;
  on: SimHandlers;
  /**
   * 线程出错、重发过一次的活又出错了,不再发(见文件头「线程出错」):界面上收起这件活(地图上还是原来那份)。
   * 只交现在这个世界的(编号对不上的不交);试推演不交,这里直接 reject
   */
  lost: (req: WorkerRequest) => void;
}

/** 线程上的活,问题记录里的说法 */
const WORK_LABEL: Partial<Record<WorkerRequest['type'], string>> = {
  generate: '生成世界',
  resim: '推演历史',
  civOnly: '推演历史',
  history: '回放世界形成',
  trial: '助手试推演',
  upPreview: '预览地形大事',
  load: '打开世界',
  turn: '逐年推演',
  extend: '再推',
  outline: '照大纲推演',
};

/**
 * 不算一件回音的:主图补丁、原件是后台自己排的活;再推 / 照大纲推演的进度、先交的编年史、先交的地图也不算(推完 / 停下才算)。
 * 先交的几段历史(civPart)在记账之前就收下了,也不算
 */
const QUIET = new Set<WorkerResponse['type']>(['progress', 'eraPatch', 'snapshot', 'extendProgress', 'outlineProgress', 'chronicle', 'map']);

/** 发给线程、还没回音的一件活;tries = 已经重发过几次(线程出错时) */
interface Pending {
  req: WorkerRequest;
  tries: number;
}

interface Trial {
  resolve: (c: Civ) => void;
  reject: (e: Error) => void;
}

export class SimClient {
  private w: SimWorker | null = null;
  /** 发给当前线程、还没回音的活(生成世界 / 回放帧 / 重推文明……),按发出的先后;线程按这个先后一件件做、一件件回 */
  private pending: Pending[] = [];
  /**
   * 其中线程能半路放下的(编辑地形时只换地形、不推历史的生成):后面来了新的世界,线程自己不算完它(回音 aborted),
   * 只有这种活在忙时换世界不用关掉线程重开(记着的网格、板块、整图都还在)
   */
  private soft = new Set<number>();
  /** 线程在忙什么(问题记录用;闲下来 = null) */
  private doing: string | null = null;
  /** 线程回报的扩张节拍(改过地形的世界推文明要用):下次生成、重推时带回去,线程被重开过也不用多生成一遍原来的地形 */
  private tempo: TempoNote | null = null;
  /** 助手的试推演:发给线程、还没回音的(编号 → 等着的那一次) */
  private trials = new Map<number, Trial>();
  private trialSeq = 0;
  /** 线程交历史之前先交的几段;换了线程就清掉 */
  private parts = new CivPartInbox();
  /** 照原样打开的世界(打开它的那件读档;换了世界 = null):重开线程时先发 pin 重新钉住(见文件头) */
  private loaded: LoadRequest | null = null;

  constructor(private opts: SimClientOptions) {}

  /** 线程手上还没回音的活有几件 */
  get busy(): number {
    return this.pending.length;
  }

  /** 线程在忙什么(问题记录用;闲着 = null) */
  get label(): string | null {
    return this.doing;
  }

  /**
   * 备好线程:abort = 要换世界(生成、读档),线程手上还有不能半路放下的活就终止它(排着的试推演一起作废);
   * 没有线程就开一个
   */
  ensure(abort: boolean): SimWorker {
    if (abort && this.w && this.pending.length > this.soft.size) {
      this.w.terminate();
      this.w = null;
      // 线程上排着的试推演(助手)一起作废
      this.dropTrials('世界换了,试推演作废');
    }
    return this.w ?? this.open(true);
  }

  /** 开一个新线程(换下手上的账);pin = 照原样打开的世界先重新钉住 */
  private open(pin: boolean): SimWorker {
    const w = this.opts.spawn();
    dropChronicleParts();
    this.parts.drop();
    w.onerror = (e) => this.broke(w, e);
    w.onmessage = (e) => this.take(w, e.data);
    this.w = w;
    this.pending = [];
    this.soft.clear();
    this.doing = null;
    // 不算一件活、线程不回音
    if (pin && this.loaded) w.postMessage({ type: 'pin', id: this.loaded.id, load: this.loaded });
    return w;
  }

  /**
   * 发一件会回音的活:生成、读档先关掉还在忙的线程(见 ensure);带上线程回报过的扩张节拍(回放帧、地形大事预览不带)。
   * 改名之类要带的东西调用方先放进 req
   */
  send(req: WorkerRequest): void {
    const fresh = req.type === 'generate' || req.type === 'load';
    if (fresh) this.loaded = null;
    this.post(this.ensure(fresh), { req, tries: 0 });
    if (req.type === 'load') this.loaded = req;
  }

  /** 把一件活交给线程 w、记账(发、重发都走这里) */
  private post(w: SimWorker, p: Pending): void {
    const { req } = p;
    if (req.type === 'generate' && req.skipCiv) this.soft.add(req.id);
    this.pending.push(p);
    // 问题记录:意外关闭时记下线程在忙什么
    this.doing = WORK_LABEL[req.type] ?? this.doing;
    diagBeat();
    w.postMessage(req.type === 'history' || req.type === 'upPreview' || !this.tempo ? req : ({ ...req, tempo: this.tempo } as WorkerRequest));
  }

  /** 线程 w 出错(先后见文件头「线程出错」):关掉,还没回音的活重发给新开的线程,重发过又出错的那件交给 lost */
  private broke(w: SimWorker, e: ErrorEvent): void {
    if (this.w !== w) return; // 已被换掉的线程
    recordWorkerError(e, '生成世界的线程');
    w.terminate();
    this.w = null;
    const left = this.pending;
    this.pending = [];
    this.soft.clear();
    this.doing = null;
    const give = left.length && left[0].tries ? left.shift()! : null;
    // 打开世界那件不再发了:也不再拿它的原件去钉
    if (give?.req.type === 'load') this.loaded = null;
    if (left.length) {
      // 打开世界那件还没回音(要重发):不用先钉,它自己会读原件
      const nw = this.open(!left.some((p) => p.req.type === 'load'));
      for (const p of left) this.post(nw, { req: p.req, tries: p.tries + 1 });
    }
    // 重发完了再交 lost:界面收起它时要是接着发了新的活,排在重发的后面
    if (give) this.lose(give.req);
    diagBeat();
  }

  /** 不再重发的一件活:试推演 reject,现在这个世界的交给 lost */
  private lose(req: WorkerRequest): void {
    if (req.type === 'trial') {
      const t = this.trials.get(req.tid);
      this.trials.delete(req.tid);
      t?.reject(new Error('后台线程出错,试推演没算成'));
      return;
    }
    if (req.id === this.opts.currentId()) this.opts.lost(req);
  }

  /** 排着的试推演都作废(why = reject 的说法) */
  private dropTrials(why: string): void {
    for (const t of this.trials.values()) t.reject(new Error(why));
    this.trials.clear();
  }

  /** 不算一件活、线程不回音的(改名、换上了、叫停、放掉整图):有线程就直接发,没有就算了 */
  tell(req: WorkerRequest): void {
    this.w?.postMessage(req);
  }

  /**
   * 登记一次试推演(助手),返回编号(发 trial 请求时带上);线程交回来时调 resolve。
   * signal 停下 = 撤掉、reject「已停下」;线程被换掉 = reject「世界换了」。signal 已经停了 = 马上 reject,返回 null
   */
  trial(signal: AbortSignal | undefined, resolve: (c: Civ) => void, reject: (e: Error) => void): number | null {
    const tid = ++this.trialSeq;
    const onAbort = () => {
      this.trials.delete(tid);
      reject(new Error('已停下'));
    };
    if (signal?.aborted) {
      onAbort();
      return null;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    this.trials.set(tid, {
      resolve: (next) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(next);
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    });
    return tid;
  }

  /** 关掉线程(页面卸下时);排着的试推演一起作废 */
  dispose(): void {
    this.w?.terminate();
    this.w = null;
    this.loaded = null;
    this.pending = [];
    this.soft.clear();
    this.doing = null;
    this.dropTrials('页面关了,试推演作废');
  }

  /** 收到线程 w 的一条消息(先后见文件头) */
  private take(w: SimWorker, m: WorkerResponse): void {
    if (this.w !== w) return; // 已被换掉的线程
    if (m.type === 'civPart') return void this.parts.take(m);
    if ('split' in m && m.split) this.parts.join(m.civ!, m.split);
    if (!QUIET.has(m.type)) {
      this.pending.shift();
      if (!this.pending.length) {
        this.doing = null;
        diagBeat();
      }
      if (m.type === 'done' || m.type === 'aborted') this.soft.delete(m.id);
    }
    // 半路放下的生成(被新的一笔顶掉了):只是一声回音
    if (m.type === 'aborted') return;
    if ((m.type === 'done' || m.type === 'civ' || m.type === 'trial') && m.tempo) this.tempo = m.tempo;
    if (m.type === 'trial') {
      // 试推演(助手):交给等着它的那一次;世界换了的话助手那边已经停下,结果没人要
      const t = this.trials.get(m.tid);
      this.trials.delete(m.tid);
      t?.resolve(m.civ);
      return;
    }
    if (m.id !== this.opts.currentId()) return; // 过时的请求(上一个世界的)
    // 交历史之前先交的编年史:收着,交历史的那条到了一起记下(换上时不在主线程上整段重算)
    if (m.type === 'chronicle') return void takeChroniclePart(m);
    if (m.type === 'done' || m.type === 'civ' || m.type === 'civOnly' || m.type === 'turn' || m.type === 'extended' || m.type === 'outlined') adoptChronicle(m.civ, m.chron);
    (this.opts.on[m.type] as (m: WorkerResponse) => void)(m);
  }
}
