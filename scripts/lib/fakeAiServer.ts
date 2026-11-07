/**
 * 开发用的假网站服务器:照 src/ai/providers/official.ts(登录、AI)和 src/account/cloud.ts(世界、分享)文件头的接口约定实现,
 * 不联网、不调真 AI,只用来跑通"登录 → 看积分 → 调用扣积分 → 积分不够报错"和"世界存进账号、同步、分享短链接"整条流程。
 *
 * - 开发时(pnpm dev)vite.config.ts 把它挂在 /__fake-ai 下;网址加 `aiServer=fake` 让页面用它
 * - 单测里直接调 handle(Request) → Response(不开端口)
 * - 状态都在内存里:重启 dev server 就清空
 *
 * 规则:验证码固定 246810(发验证码时也在 devCode 里返回);新账户 10 积分;每次调用扣 3 积分,"连接测试"扣 1 积分;
 * POST /v1/dev/credits { credits } 直接改余额(测"积分不够")。
 * 我们的 AI 默认开着(登录窗选项 features.ai = true);选项 ai: false 或 POST /v1/dev/ai { off: true } 关掉,和服务器 AI=off 一样:
 * /v1/chat 404,登录和 /v1/me 不给积分。
 * 邀请制(inviteOnly,开发服务器里开着):新邮箱要邀请码 K7QM-2XPA(大小写、横线不计较;假服务器里用不完)。
 * 世界、最近删除、分享都在内存里;最近删除不会过期。
 * 带工具的请求(助手):最后一条不是工具结果时,回一个对第一个工具的调用(参数为空,done.tool_calls);是工具结果时正常回话。
 * 传到账号的世界(src/account/fullWorlds.ts):块和文件都在内存里;不真核对,看一眼开头是不是 ZIP,文字审核用 fullFail 模拟。
 * POST /v1/dev/full { off?, limits?, fail?, storeFull? } 改这部分的行为(off = 当服务器没开这个功能,接口都 404)。
 * 作品墙(src/account/gallery.ts):开着,摆着世界(带世界文件、用了非官方规则)、地图、新建参数、规则各一件,一件精选、一个挑战;不用登录。
 * 世界作品的文件第一次要的时候现做(fakeWorldFile.ts,一两秒),网页上能照存的内容打开。
 * POST /v1/dev/gallery { off?, withdrawn? } 关掉作品墙(接口都 404)、撤下几件。
 * 投到作品墙(src/account/submissions.ts):投世界、地图、新建参数、规则,撤回、撤下;一天 3 次、同时等审 5 件、须知第 3 版;
 * 作者填的字(地图、链接里的字也算)里有「敏感词」三个字就当碰到词。世界核对用 fullCheckMs,过了就进等审(不建后台草稿)。
 * POST /v1/dev/submit { off?, world?, phoneRequired?, terms?, fail?, refuse?, ban?, used?, pending?, forget?, add?, decide? }:
 * fail 下一次核对怎么判(同 fullFail);refuse { at: 'begin' | 'commit' | 'post', status, code, message, ... } 下一次先问 / 提交 / 投另外三种直接回这个错;
 * ban 当前账号停了投稿(null 解开);used、pending 把今天投过的次数、等审的件数当成几;forget 忘掉传上来的块(再投要整个重传);
 * add [{ kind, title, status, reason?, workId?, createdAt?, decidedAt?, updatedAt? }] 直接摆几件(时间是毫秒);
 * decide { id, status, reason?, workId? } 当成后台审了(上墙、退回、撤下)。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GENERATOR_VERSION } from '../../src/gen/edits';
import { STEADY_RULES, WARRING_RULES, makeWorldFile, rulesBriefOf, rulesLinkOf } from './fakeWorldFile';

export const FAKE_CODE = '246810';
/** 开发服务器的邀请码 */
export const FAKE_INVITE = 'K7QM-2XPA';

interface World {
  rev: number;
  save: unknown;
  meta: unknown;
  thumb: string | null;
  notes: unknown;
  updatedAt: number;
  deletedAt: number | null;
}

interface User {
  id: string;
  account: string;
  credits: number;
  worlds: Map<string, World>;
  fulls: Map<string, FullFile>;
  /** 今天提交了几次 */
  commits: number;
  /** 核对结果:世界编号 → 结果 */
  jobs: Map<string, { state: string; sum?: string; world?: unknown; error?: unknown; ready: number }>;
  /** 停了投稿(ban 的样子同服务器) */
  ban?: unknown;
  /** 开发时手动加的:今天另外投过几次、另外几件在等审 */
  extraUsed?: number;
  extraPending?: number;
}

/** 投到作品墙的一件 */
interface Sub {
  id: number;
  user: User;
  kind: WorkKind;
  title: string;
  by: string;
  blurb: string;
  moment: number | null;
  status: string;
  /** 世界文件的指纹(投世界) */
  sum: string;
  reason?: string;
  workId?: string;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
  /** 核对中:到这一刻出结果 */
  ready?: number;
  /** 核对完:过了(null)还是没过 */
  verdict?: FakeFullFail | null;
}

interface FullFile {
  rev: number;
  sum: string;
  bytes: number;
  uploadedAt: number;
  mark: string | null;
  public: boolean;
  reason?: string;
  blocks: string[];
}

/** 下一次核对怎么判:不给 = 过 */
export interface FakeFullFail {
  code: string;
  message?: string;
  hits?: unknown[];
  hitCount?: number;
}

export interface FakeFullLimits {
  worlds: number;
  bytes: number;
  perDay: number;
  worldBytes: number;
  blockBytes: number;
  blocksPerFile: number;
}

interface Share {
  user: User;
  worldId: string;
  createdAt: number;
  stopped: boolean;
  opens: number;
  /** 署名;没填 = 没有 */
  by?: string;
}

type WorkKind = 'world' | 'map' | 'preset' | 'rules';

interface Work {
  id: string;
  kind: WorkKind;
  title: string;
  by: string;
  blurb: string;
  version: number | null;
  addedAt: number;
  /** 地图:存档 */
  save?: unknown;
  /** 新建参数:预设链接 # 后面那段 */
  preset?: string;
  /** 规则:规则链接 # 后面那段 */
  link?: string;
  /** 世界:带世界文件 */
  full?: true;
  /** 规则作品、用了非官方规则的世界:列表里的规则摘要 */
  brief?: { name: string; changed: number; brief: string };
}

const REPORT_REASONS = ['illegal', 'porn', 'abuse', 'privacy', 'infringe', 'other'];

function sampleWorks(now: number): Work[] {
  const day = 86400_000;
  const preset = new URLSearchParams({ preset: '1', name: '两块完整大陆', seed: '4242', landFraction: '0.4', continents: '2' }).toString();
  return [
    {
      id: 'k7qm2xpa',
      kind: 'world',
      title: '金阳洋两岸',
      by: '砚山',
      blurb: '两岸七个王朝打了三百年，最后谁也没吞下谁。',
      version: GENERATOR_VERSION,
      addedAt: now - day,
      full: true,
      brief: rulesBriefOf(STEADY_RULES),
    },
    {
      id: 'm3np8rta',
      kind: 'map',
      title: '九州大陆',
      by: '霜叶',
      blurb: '一块大陆、九条大河，留给你打造文明。',
      version: GENERATOR_VERSION,
      addedAt: now - 2 * day,
      save: { app: '文明与地图', format: 1, generator: GENERATOR_VERSION, seed: 2024, params: { seed: 2024 }, edits: { names: {}, interventions: [], terrain: [] }, title: '九州大陆' },
    },
    { id: 'p4tz6hwe', kind: 'preset', title: '两块完整大陆', by: '砚山', blurb: '', version: null, addedAt: now - 3 * day, preset },
    {
      id: 'r6zh9qkw',
      kind: 'rules',
      title: WARRING_RULES.name,
      by: WARRING_RULES.by!,
      blurb: '七八个国家并立，一百多年一场大战，谁也吞不下谁。',
      version: GENERATOR_VERSION,
      addedAt: now - 4 * day,
      link: rulesLinkOf(WARRING_RULES),
      brief: rulesBriefOf(WARRING_RULES),
    },
  ];
}

/** 封面:2:1 的一块颜色,写着作品名(真的是 JPEG,这里用 SVG 代替) */
function coverSvg(w: Work): string {
  const bg = { world: '#c9d8b6', map: '#b9cfe0', preset: '#1d2a3a', rules: '#e3d6b8' }[w.kind];
  const fg = w.kind === 'preset' ? '#e8eef5' : '#2b3a2e';
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><rect width="640" height="320" fill="${bg}"/><text x="320" y="172" font-size="40" text-anchor="middle" fill="${fg}" font-family="sans-serif">${esc(w.title)}</text></svg>`;
}

export interface FakeAiOptions {
  startCredits?: number;
  /** 每段流式回复之间等多久(毫秒);单测里设 0 */
  chunkDelayMs?: number;
  /** 邀请制:新邮箱要邀请码 */
  inviteOnly?: boolean;
  /** 传到账号:核对要多久(毫秒);单测里设 0 */
  fullCheckMs?: number;
  /** 我们的 AI 开不开(默认开) */
  ai?: boolean;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

const WORLD_ID = /^w[0-9a-z]{6,24}$/;
const iso = (t: number) => new Date(t).toISOString();
const normInvite = (v: unknown) => (typeof v === 'string' ? v.toUpperCase().replace(/[\s-]/g, '') : '');
/** 看到的几个字(一个组合表情算一个) */
const seen = (s: string) => [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s)].length;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json(status, { error: { code, message, ...extra } });

const costOf = (feature: string) => (feature === '连接测试' ? 1 : 3);

export function createFakeAiServer(opts: FakeAiOptions = {}) {
  const start = opts.startCredits ?? 10;
  const delay = opts.chunkDelayMs ?? 60;
  const inviteOnly = !!opts.inviteOnly;
  let aiOn = opts.ai ?? true;
  const users = new Map<string, User>();
  const tokens = new Map<string, string>();
  const shares = new Map<string, Share>();
  /** 同一个 requestId 只扣一次 */
  const charged = new Set<string>();
  let seq = 0;
  // 传到账号
  const blocks = new Map<string, Uint8Array>();
  const fullCheckMs = opts.fullCheckMs ?? 800;
  const fullState: { off: boolean; storeFull: boolean; fail: FakeFullFail | null; limits: FakeFullLimits } = {
    off: false,
    storeFull: false,
    fail: null,
    limits: { worlds: 20, bytes: 200e6, perDay: 30, worldBytes: 150e6, blockBytes: 16777216, blocksPerFile: 512 },
  };
  const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const fullView = (id: string, f: FullFile) => ({ id, rev: f.rev, sum: f.sum, bytes: f.bytes, uploadedAt: iso(f.uploadedAt), mark: f.mark, public: f.public, ...(f.reason ? { reason: f.reason } : {}) });
  const aliveFulls = (u: User) => [...u.fulls].filter(([id]) => u.worlds.get(id)?.deletedAt === null);
  const fileOf = (f: FullFile) => {
    const parts = f.blocks.map((s) => blocks.get(s)!);
    const out = new Uint8Array(f.bytes);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  // 投到作品墙
  const submitState = {
    off: false,
    world: true,
    phoneRequired: false,
    terms: 3,
    perDay: 3,
    pendingMax: 5,
    fail: null as FakeFullFail | null,
    refuse: null as { at: string; status: number; code: string; message: string; [k: string]: unknown } | null,
  };
  const subs: Sub[] = [];
  let subSeq = 0;
  const bjDay = (t: number) => new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
  const settle = (x: Sub) => {
    if (x.status !== 'checking' || x.ready === undefined || Date.now() < x.ready) return;
    x.status = x.verdict ? 'failed' : 'pending';
    x.updatedAt = Date.now();
  };
  const subView = (x: Sub) => {
    settle(x);
    const v = x.verdict;
    return {
      id: x.id,
      kind: x.kind,
      title: x.title,
      by: x.by,
      blurb: x.blurb,
      status: x.status,
      ...(x.status === 'failed' && v ? { reason: v.message ?? '没有收下', error: v } : {}),
      ...(x.reason && (x.status === 'returned' || x.status === 'withdrawn') ? { reason: x.reason } : {}),
      ...(x.workId ? { workId: x.workId } : {}),
      createdAt: iso(x.createdAt),
      updatedAt: iso(x.updatedAt),
      ...(x.decidedAt !== undefined ? { decidedAt: iso(x.decidedAt) } : {}),
    };
  };
  const SUB_KINDS: readonly string[] = ['world', 'map', 'preset', 'rules'];
  const submitLimits = (u: User) => {
    const mine = subs.filter((x) => x.user === u);
    mine.forEach(settle);
    const today = bjDay(Date.now());
    return {
      perDay: submitState.perDay,
      usedToday: mine.filter((x) => bjDay(x.createdAt) === today && x.status !== 'failed').length + (u.extraUsed ?? 0),
      pendingMax: submitState.pendingMax,
      pending: mine.filter((x) => x.status === 'checking' || x.status === 'pending' || x.status === 'reviewing').length + (u.extraPending ?? 0),
      worldTriesPerDay: 10,
      worldTriesToday: mine.filter((x) => bjDay(x.createdAt) === today).length,
    };
  };
  // 作品墙
  const gallery = { off: false, works: sampleWorks(Date.now()), withdrawn: new Set<string>(), reports: [] as { id: string; reason: string }[] };
  let worldFile: Promise<{ data: Uint8Array; sum: string }> | null = null;
  const galleryFile = () =>
    (worldFile ??= makeWorldFile('金阳洋两岸').then(async (data) => ({ data, sum: await sha(data) })));
  const workView = (w: Work) => ({
    id: w.id,
    kind: w.kind,
    title: w.title,
    by: w.by,
    blurb: w.blurb,
    version: w.version,
    addedAt: iso(w.addedAt),
    ...(w.brief ? { rules: w.brief } : {}),
  });
  const galleryList = async () => {
    const live = gallery.works.filter((w) => !gallery.withdrawn.has(w.id)).sort((a, b) => b.addedAt - a.addedAt);
    const bytes = live.some((w) => w.full) ? (await galleryFile()).data.length : 0;
    const bj = (t: number) => new Date(t + 8 * 3600_000).toISOString();
    const has = (id: string) => live.some((w) => w.id === id);
    return {
      month: bj(Date.now()).slice(0, 7),
      featured: [{ id: 'k7qm2xpa', note: '海峡两岸的拉锯写得很细，每一次换手都有来由。' }].filter((f) => has(f.id)),
      challenges: [{ id: 1, title: '一个王朝三百年', blurb: '从立国到灭亡，讲一个王朝的三百年。', deadline: bj(Date.now() + 30 * 86400_000).slice(0, 10), works: ['m3np8rta'].filter(has) }],
      works: live.map((w) => ({ ...workView(w), ...(w.full ? { full: { bytes } } : {}) })),
    };
  };

  const fullFileResponse = (f: FullFile) =>
    new Response(fileOf(f), { status: 200, headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'Content-Length': String(f.bytes), ETag: `"${f.sum}"` } });

  const who = (req: Request): User | null => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
    const acc = m ? tokens.get(m[1]) : undefined;
    return acc ? (users.get(acc) ?? null) : null;
  };

  const body = async (req: Request): Promise<any> => {
    try {
      return await req.json();
    } catch {
      return null;
    }
  };

  async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // ---- 作品墙(不用登录) ----
    if (req.method === 'POST' && path === '/v1/dev/gallery') {
      const b = await body(req);
      if (typeof b?.off === 'boolean') gallery.off = b.off;
      if (Array.isArray(b?.withdrawn)) gallery.withdrawn = new Set(b.withdrawn.filter((x: unknown) => typeof x === 'string'));
      return json(200, { ok: true });
    }
    if (path === '/v1/gallery' || path.startsWith('/v1/gallery/')) {
      if (gallery.off) return fail(404, 'bad-request', '没有这个接口');
      if (req.method === 'GET' && path === '/v1/gallery') return json(200, await galleryList());
      const g = /^\/v1\/gallery\/([^/]+)(\/cover|\/full|\/report)?$/.exec(path);
      const w = g ? gallery.works.find((x) => x.id === decodeURIComponent(g[1])) : undefined;
      if (!g || !w) return fail(404, 'not-found', '这个作品已经撤下');
      if (gallery.withdrawn.has(w.id)) return json(410, { withdrawn: true, error: { code: 'gallery-gone', message: '这个作品已经撤下' } });
      if (req.method === 'GET' && !g[2]) {
        if (w.preset) return json(200, { ...workView(w), preset: w.preset });
        if (w.link) return json(200, { ...workView(w), rules: w.link });
        if (!w.full) return json(200, { ...workView(w), save: w.save });
        const f = await galleryFile();
        return json(200, { ...workView(w), full: { sum: f.sum, bytes: f.data.length } });
      }
      if (req.method === 'GET' && g[2] === '/cover') return new Response(coverSvg(w), { status: 200, headers: { ...CORS, 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' } });
      if (req.method === 'GET' && g[2] === '/full') {
        if (!w.full) return fail(404, 'not-found', '这个作品没有世界文件');
        const f = await galleryFile();
        return new Response(f.data, { status: 200, headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'Content-Length': String(f.data.length), ETag: `"${f.sum}"` } });
      }
      if (req.method === 'POST' && g[2] === '/report') {
        const reason = (await body(req))?.reason;
        if (!REPORT_REASONS.includes(reason)) return fail(400, 'bad-request', '举报理由不对');
        gallery.reports.push({ id: w.id, reason });
        return new Response(null, { status: 204, headers: CORS });
      }
      return fail(404, 'bad-request', '没有这个接口');
    }

    if (req.method === 'POST' && path === '/v1/dev/ai') {
      const b = await body(req);
      if (typeof b?.off === 'boolean') aiOn = !b.off;
      return json(200, { ok: true });
    }
    if (req.method === 'GET' && path === '/v1/auth/options') {
      const submit = !submitState.off && !gallery.off;
      return json(200, { accountKinds: ['email'], inviteOnly, codeTtlSec: 600, features: { ai: aiOn, submit, submitWorld: submit && submitState.world && !fullState.off, phoneRequired: submitState.phoneRequired } });
    }

    // 邀请制下的新邮箱:没带邀请码 = 403 need-invite;带了不对 = 400 bad-invite
    const inviteCheck = (account: string, invite: unknown): Response | null => {
      if (!inviteOnly || users.has(account)) return null;
      if (!normInvite(invite)) return fail(403, 'need-invite', '这个邮箱还没有账号。现在只开放给收到邀请的人，填上邀请码就能注册');
      if (normInvite(invite) !== normInvite(FAKE_INVITE)) return fail(400, 'bad-invite', '邀请码不对，或者已经用完了');
      return null;
    };

    if (req.method === 'POST' && path === '/v1/auth/code') {
      const b = await body(req);
      const account = typeof b?.account === 'string' ? b.account.trim() : '';
      if (!/^\S+@\S+\.\S+$/.test(account) && !/^1\d{10}$/.test(account)) return fail(400, 'bad-request', '请填邮箱或 11 位手机号');
      const bad = inviteCheck(account, b?.invite);
      if (bad) return bad;
      return json(200, { ok: true, resendAfter: 60, expiresIn: 600, devCode: FAKE_CODE });
    }

    if (req.method === 'POST' && path === '/v1/auth/login') {
      const b = await body(req);
      const account = typeof b?.account === 'string' ? b.account.trim() : '';
      if (!account || b?.code !== FAKE_CODE) return fail(400, 'bad-code', '验证码不对或已过期');
      const bad = inviteCheck(account, b?.invite);
      if (bad) return bad;
      let u = users.get(account);
      if (!u) users.set(account, (u = { id: `u${++seq}`, account, credits: start, worlds: new Map(), fulls: new Map(), commits: 0, jobs: new Map() }));
      const token = `fake-${crypto.randomUUID()}`;
      tokens.set(token, account);
      return json(200, { token, user: { id: u.id, account, name: account.split('@')[0] }, ...(aiOn ? { credits: u.credits } : {}) });
    }

    const open = /^\/v1\/s\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && open) {
      const sh = shares.get(decodeURIComponent(open[1]));
      const w = sh && !sh.stopped && users.get(sh.user.account) === sh.user ? sh.user.worlds.get(sh.worldId) : undefined;
      if (!sh || !w || w.deletedAt !== null) return fail(404, 'share-gone', '这个分享已经停止了');
      const full = fullState.off ? undefined : sh.user.fulls.get(sh.worldId);
      if (full && !full.public) return fail(403, 'content-filter', '这个世界带着服务器看不到的附加数据,暂时打不开');
      sh.opens++;
      return json(200, { save: w.save, updatedAt: iso(w.updatedAt), ...(sh.by ? { by: sh.by } : {}), ...(full ? { full: { sum: full.sum, bytes: full.bytes, uploadedAt: iso(full.uploadedAt) } } : {}) });
    }
    const openFull = /^\/v1\/s\/([^/]+)\/full$/.exec(path);
    if (req.method === 'GET' && openFull) {
      const sh = fullState.off ? undefined : shares.get(decodeURIComponent(openFull[1]));
      const f = sh && !sh.stopped ? sh.user.fulls.get(sh.worldId) : undefined;
      if (!f) return fail(404, 'share-gone', '这个分享已经停止了');
      return fullFileResponse(f);
    }

    if (!aiOn && path === '/v1/chat') return fail(404, 'bad-request', '没有这个接口');
    const u = who(req);
    if (path.startsWith('/v1/') && !u) return fail(401, 'auth', '登录过期了,请重新登录');
    if (!u) return fail(404, 'bad-request', '没有这个接口');

    if (req.method === 'GET' && path === '/v1/me') {
      return json(200, {
        user: { id: u.id, account: u.account, name: u.account.split('@')[0] },
        ...(aiOn ? { credits: u.credits, pricing: { note: '每次调用扣 3 积分,连接测试扣 1 积分(开发用假服务器)' } } : {}),
      });
    }

    if (req.method === 'POST' && path === '/v1/auth/logout') {
      const t = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
      if (t) tokens.delete(t);
      return new Response(null, { status: 204, headers: CORS });
    }

    if (req.method === 'POST' && path === '/v1/dev/credits') {
      const b = await body(req);
      if (typeof b?.credits === 'number' && b.credits >= 0) u.credits = Math.floor(b.credits);
      return json(200, { credits: u.credits });
    }

    if (req.method === 'POST' && path === '/v1/dev/full') {
      const b = await body(req);
      if (typeof b?.off === 'boolean') fullState.off = b.off;
      if (typeof b?.storeFull === 'boolean') fullState.storeFull = b.storeFull;
      if (b?.limits) Object.assign(fullState.limits, b.limits);
      if (b?.fail !== undefined) fullState.fail = b.fail;
      if (typeof b?.commits === 'number') u.commits = b.commits;
      return json(200, { ok: true });
    }

    if (req.method === 'POST' && path === '/v1/dev/submit') {
      const b = await body(req);
      for (const k of ['off', 'world', 'phoneRequired'] as const) if (typeof b?.[k] === 'boolean') submitState[k] = b[k];
      if (typeof b?.terms === 'number') submitState.terms = b.terms;
      if (b?.fail !== undefined) submitState.fail = b.fail;
      if (b?.refuse !== undefined) submitState.refuse = b.refuse;
      if (b?.ban !== undefined) u.ban = b.ban ?? undefined;
      if (typeof b?.used === 'number') u.extraUsed = b.used - (submitLimits(u).usedToday - (u.extraUsed ?? 0));
      if (typeof b?.pending === 'number') u.extraPending = b.pending - (submitLimits(u).pending - (u.extraPending ?? 0));
      if (b?.forget === true) blocks.clear();
      if (Array.isArray(b?.add)) {
        const now = Date.now();
        for (const a of b.add as Record<string, unknown>[]) {
          const t = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : undefined);
          const kind = (SUB_KINDS.includes(String(a.kind)) ? a.kind : 'world') as WorkKind;
          subs.push({
            id: ++subSeq,
            user: u,
            kind,
            title: String(a.title ?? ''),
            by: String(a.by ?? ''),
            blurb: String(a.blurb ?? ''),
            moment: null,
            status: String(a.status ?? 'pending'),
            sum: '',
            ...(typeof a.reason === 'string' ? { reason: a.reason } : {}),
            ...(typeof a.workId === 'string' ? { workId: a.workId } : {}),
            createdAt: t('createdAt') ?? now,
            updatedAt: t('updatedAt') ?? t('decidedAt') ?? t('createdAt') ?? now,
            ...(t('decidedAt') !== undefined ? { decidedAt: t('decidedAt') } : {}),
          });
        }
      }
      if (b?.decide && typeof b.decide === 'object') {
        const d = b.decide as Record<string, unknown>;
        const x = subs.find((y) => y.user === u && y.id === d.id);
        if (x && typeof d.status === 'string') {
          const now = Date.now();
          x.status = d.status;
          x.updatedAt = now;
          if (d.status === 'live' || d.status === 'returned') x.decidedAt = now;
          if (typeof d.reason === 'string') x.reason = d.reason;
          if (typeof d.workId === 'string') x.workId = d.workId;
        }
      }
      return json(200, { ok: true });
    }

    // ---- 投到作品墙 ----
    if (path === '/v1/submissions' || path.startsWith('/v1/submissions/')) {
      if (submitState.off || gallery.off) return fail(404, 'bad-request', '没有这个接口');
      if (req.method === 'GET' && path === '/v1/submissions') {
        const list = subs.filter((x) => x.user === u && x.status !== 'cancelled').sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
        return json(200, { submissions: list.map(subView), limits: submitLimits(u), terms: submitState.terms, ...(u.ban ? { ban: u.ban } : {}) });
      }
      const one = /^\/v1\/submissions\/(\d+)(\/withdraw)?$/.exec(path);
      const mine = one ? subs.find((s) => s.user === u && s.id === Number(one[1]) && s.status !== 'cancelled') : undefined;
      if (one && (req.method === 'GET' || req.method === 'DELETE' || req.method === 'POST') && !mine) return fail(404, 'not-found', '没有这份投稿');
      if (req.method === 'GET' && one && !one[2]) return json(200, subView(mine!));
      if (req.method === 'DELETE' && one && !one[2]) {
        const x = mine!;
        settle(x);
        if (x.status !== 'checking' && x.status !== 'pending' && x.status !== 'reviewing') return fail(409, 'conflict', x.status === 'live' ? '已经上墙了,不想展示请点撤下' : '这份投稿已经处理完了', { status: x.status });
        x.status = 'cancelled';
        x.updatedAt = Date.now();
        return new Response(null, { status: 204, headers: CORS });
      }
      if (req.method === 'POST' && one?.[2]) {
        const x = mine!;
        if (x.status !== 'live') return fail(409, 'conflict', '这个作品已经撤下了', { status: x.status });
        x.status = 'withdrawn';
        x.reason = '作者自己撤下';
        x.updatedAt = Date.now();
        return json(200, subView(x));
      }
      if (req.method === 'POST' && path === '/v1/submissions') {
        const b = await body(req);
        const r = submitState.refuse;
        if (r && r.at === 'post') {
          submitState.refuse = null;
          const { at: _a, status, code, message, ...extra } = r;
          return fail(status, code, message, extra);
        }
        const kind = b?.kind;
        if (kind === 'world') return fail(400, 'bad-request', '投世界另有接口(先传世界文件)');
        if (kind !== 'map' && kind !== 'preset' && kind !== 'rules') return fail(400, 'bad-request', '种类不对');
        if (b?.terms !== submitState.terms) return fail(409, 'terms-changed', '投稿须知改过了,请看过新的再投', { terms: submitState.terms });
        const f = { title: String(b?.title ?? '').trim(), by: String(b?.by ?? '').trim(), blurb: String(b?.blurb ?? '').trim() };
        if (!f.title || !f.by || !f.blurb) return fail(400, 'bad-request', '要填作品名、署名和一句话介绍');
        if (u.ban) return fail(403, 'submit-banned', `你的账号已停止投稿。原因:${(u.ban as { reasonText?: string }).reasonText ?? ''}`, { ban: u.ban });
        if (submitState.phoneRequired) return fail(403, 'need-phone', '先绑定手机号再投稿');
        const lim = submitLimits(u);
        if (lim.usedToday >= lim.perDay) return fail(429, 'submit-limit', '今天投够 3 次了,明天再投', { limit: 'per-day', retryAfter: 3600, left: 0, ...lim });
        if (lim.pending >= lim.pendingMax) return fail(429, 'submit-limit', '等审的太多了,审完一份再投', { limit: 'pending', left: lim.perDay - lim.usedToday, ...lim });
        let content: string;
        if (kind === 'map') {
          const sv = b?.save as { app?: unknown } | undefined;
          if (!sv || sv.app !== '文明与地图') return fail(400, 'bad-request', '这不是「文明与地图」的存档');
          content = JSON.stringify(sv);
        } else {
          content = typeof b?.link === 'string' ? b.link.replace(/^.*#/, '') : '';
          if (!content.startsWith(`${kind}=`)) return fail(400, 'bad-request', `这不是${kind === 'preset' ? '新建参数' : '规则'}的链接`);
          content = decodeURIComponent(content.replace(/\+/g, ' '));
        }
        const hits = [
          ...(['title', 'by', 'blurb'] as const).filter((k) => f[k].includes('敏感词')).map((k) => ({ by: 'author', part: 'info', kind: { title: '作品名', by: '署名', blurb: '一句话介绍' }[k], text: f[k].slice(0, 60) })),
          ...(content.includes('敏感词') ? [{ by: 'author', part: 'content', kind: '名字', text: '敏感词' }] : []),
        ];
        if (hits.length) return fail(400, 'content-filter', `有 ${hits.length} 处字词不能公开,改掉以后再投`, { hits, hitCount: hits.length });
        const now = Date.now();
        const x: Sub = { id: ++subSeq, user: u, kind, ...f, moment: null, status: 'pending', sum: '', createdAt: now, updatedAt: now };
        subs.push(x);
        return json(201, { id: x.id, status: 'pending' });
      }
      const world = /^\/v1\/submissions\/world(\/begin)?$/.exec(path);
      if (req.method === 'POST' && world) {
        if (!submitState.world || fullState.off) return fail(404, 'bad-request', '没有这个接口');
        const b = await body(req);
        const at = world[1] ? 'begin' : 'commit';
        const r = submitState.refuse;
        if (r && r.at === at) {
          submitState.refuse = null;
          const { at: _a, status, code, message, ...extra } = r;
          return fail(status, code, message, extra);
        }
        const plan = b?.plan;
        const list: { sum: string; bytes: number }[] = Array.isArray(plan?.blocks) ? plan.blocks : [];
        if (typeof plan?.sum !== 'string' || !list.length) return fail(400, 'bad-request', '世界文件的清单不对');
        if (at === 'commit' && b?.terms !== submitState.terms) return fail(409, 'terms-changed', '投稿须知改过了,请看过新的再投', { terms: submitState.terms });
        const f = { title: String(b?.title ?? '').trim(), by: String(b?.by ?? '').trim(), blurb: String(b?.blurb ?? '').trim() };
        if (at === 'commit' && (!f.title || !f.by || !f.blurb)) return fail(400, 'bad-request', '要填作品名、署名和一句话介绍');
        if (u.ban) return fail(403, 'submit-banned', `你的账号已停止投稿。原因:${(u.ban as { reasonText?: string }).reasonText ?? ''}`, { ban: u.ban });
        if (submitState.phoneRequired) return fail(403, 'need-phone', '先绑定手机号再投稿');
        const checking = subs.find((x) => x.user === u && (settle(x), x.status === 'checking'));
        if (checking) return checking.sum === plan.sum && at === 'commit' ? json(202, { id: checking.id, status: 'checking' }) : fail(429, 'rate-limit', '上一个世界还在核对,等它核对完再投', { retryAfter: 5 });
        const lim = submitLimits(u);
        if (lim.usedToday >= lim.perDay) return fail(429, 'submit-limit', '今天投够 3 次了,明天再投', { limit: 'per-day', retryAfter: 3600, left: 0, ...lim });
        if (lim.pending >= lim.pendingMax) return fail(429, 'submit-limit', '等审的太多了,审完一份再投', { limit: 'pending', left: lim.perDay - lim.usedToday, ...lim });
        const total = list.reduce((n, x) => n + x.bytes, 0);
        if (total > fullState.limits.worldBytes) return fail(413, 'world-too-big', '这个世界太大了', { worldBytes: total, maxBytes: fullState.limits.worldBytes });
        if (at === 'begin') return json(200, { need: [...new Set(list.map((x) => x.sum))].filter((s) => !blocks.has(s)) });
        const hits = (['title', 'by', 'blurb'] as const).filter((k) => f[k].includes('敏感词')).map((k) => ({ by: 'author', part: 'info', kind: { title: '作品名', by: '署名', blurb: '一句话介绍' }[k], text: f[k].slice(0, 60) }));
        if (hits.length) return fail(400, 'content-filter', `有 ${hits.length} 处字词不能公开,改掉以后再投`, { hits, hitCount: hits.length });
        const missing = list.map((x) => x.sum).filter((s) => !blocks.has(s));
        if (missing.length) return fail(409, 'blocks-missing', '还有块没传完', { missing });
        const first = blocks.get(list[0].sum);
        const isZip = first?.[0] === 0x50 && first?.[1] === 0x4b;
        const verdict = submitState.fail ?? (isZip ? null : { code: 'world-invalid', message: '这个世界文件没过校验' });
        submitState.fail = null;
        const now = Date.now();
        const x: Sub = { id: ++subSeq, user: u, kind: 'world', ...f, moment: typeof b?.moment === 'number' ? b.moment : null, status: 'checking', sum: plan.sum, createdAt: now, updatedAt: now, ready: now + fullCheckMs, verdict };
        subs.push(x);
        return json(202, { id: x.id, status: 'checking' });
      }
      return fail(404, 'bad-request', '没有这个接口');
    }

    // ---- 传到账号的世界 ----
    const fullPath = /^\/v1\/worlds\/([^/]+)\/full(\/begin|\/status)?$/.exec(path);
    const blockPath = /^\/v1\/world-blocks\/([^/]+)$/.exec(path);
    if (path === '/v1/world-full' || fullPath || blockPath) {
      if (fullState.off) return fail(404, 'bad-request', '没有这个接口');
      const L = fullState.limits;
      const used = () => {
        const list = aliveFulls(u);
        return { worlds: list.length, bytes: list.reduce((n, [, f]) => n + f.bytes, 0), today: u.commits };
      };
      if (req.method === 'GET' && path === '/v1/world-full') {
        return json(200, { limits: L, used: used(), storeFull: fullState.storeFull, checker: 'fake', worlds: aliveFulls(u).map(([id, f]) => fullView(id, f)) });
      }
      if (req.method === 'PUT' && blockPath) {
        const data = new Uint8Array(await req.arrayBuffer());
        if (data.length > L.blockBytes) return fail(413, 'world-too-big', '一块太大了');
        if ((await sha(data)) !== blockPath[1]) return fail(400, 'bad-hash', '这一块的内容和它的指纹对不上,再传一次');
        blocks.set(blockPath[1], data);
        return json(200, { sum: blockPath[1], bytes: data.length });
      }
      if (fullPath) {
        const id = decodeURIComponent(fullPath[1]);
        const cur = u.fulls.get(id);
        const alive = u.worlds.get(id)?.deletedAt === null;
        if (req.method === 'GET' && fullPath[2] === '/status') {
          const j = u.jobs.get(id);
          if (!j) return json(200, { state: 'none' });
          if (Date.now() < j.ready) return json(200, { state: 'checking', sum: j.sum });
          const { ready: _r, ...rest } = j;
          return json(200, rest);
        }
        if (req.method === 'GET' && !fullPath[2]) {
          if (!alive || !cur) return fail(404, 'not-found', '这个世界没有传过完整世界');
          return fullFileResponse(cur);
        }
        if (req.method === 'DELETE' && !fullPath[2]) {
          u.fulls.delete(id);
          u.jobs.delete(id);
          const save = (u.worlds.get(id)?.save ?? {}) as { edits?: { map?: { grown?: unknown } } };
          if (save.edits?.map?.grown !== undefined) for (const sh of shares.values()) if (sh.user === u && sh.worldId === id) sh.stopped = true;
          return new Response(null, { status: 204, headers: CORS });
        }
        if (req.method === 'POST') {
          const b = await body(req);
          if (!alive) return fail(404, 'not-found', '账号里还没有这个世界,等同步好了再传');
          const list: { sum: string; bytes: number }[] = Array.isArray(b?.blocks) ? b.blocks : [];
          const total = list.reduce((n, x) => n + x.bytes, 0);
          if (cur?.sum === b?.sum) return json(200, fullPath[2] ? { need: [], current: fullView(id, cur!) } : { state: 'done', sum: cur!.sum, world: fullView(id, cur!) });
          if ((b?.baseRev ?? 0) !== (cur?.rev ?? 0)) return fail(409, 'conflict', '这个世界的完整世界在别的设备上更新过了', { rev: cur?.rev ?? 0 });
          if (total > L.worldBytes) return fail(413, 'world-too-big', '这个世界太大了', { worldBytes: total, maxBytes: L.worldBytes });
          const others = aliveFulls(u).filter(([x]) => x !== id);
          if (!cur && others.length >= L.worlds) return fail(400, 'full-count', '账号里已经放满了', { max: L.worlds });
          const left = L.bytes - others.reduce((n, [, f]) => n + f.bytes, 0);
          if (total > left) return fail(400, 'full-bytes', '账号里放不下这个世界', { worldBytes: total, leftBytes: left, maxBytes: L.bytes });
          if (u.commits >= L.perDay) return fail(429, 'full-daily', '今天传够了', { max: L.perDay, retryAfter: 3600 });
          if (fullState.storeFull) return fail(507, 'storage-full', '服务器放不下了');
          if (fullPath[2] === '/begin') return json(200, { need: [...new Set(list.map((x) => x.sum))].filter((s) => !blocks.has(s)) });
          const missing = list.map((x) => x.sum).filter((s) => !blocks.has(s));
          if (missing.length) return fail(409, 'blocks-missing', '还有块没传完', { missing });
          u.commits++;
          const failing = fullState.fail;
          fullState.fail = null;
          const parts = list.map((x) => blocks.get(x.sum)!);
          const isZip = parts[0]?.[0] === 0x50 && parts[0]?.[1] === 0x4b;
          if (failing || !isZip) {
            u.jobs.set(id, { state: 'failed', sum: b.sum, error: failing ?? { code: 'world-invalid', message: '这个世界文件没过校验' }, ready: Date.now() + fullCheckMs });
          } else {
            const f: FullFile = { rev: (cur?.rev ?? 0) + 1, sum: b.sum, bytes: total, uploadedAt: Date.now(), mark: typeof b.mark === 'string' ? b.mark : null, public: true, blocks: list.map((x) => x.sum) };
            u.fulls.set(id, f);
            u.jobs.set(id, { state: 'done', sum: b.sum, world: fullView(id, f), ready: Date.now() + fullCheckMs });
          }
          return json(202, { state: 'checking', sum: b.sum });
        }
      }
      return fail(404, 'bad-request', '没有这个接口');
    }

    if (req.method === 'POST' && path === '/v1/chat') {
      const b = await body(req);
      const messages = Array.isArray(b?.messages) ? b.messages : null;
      if (!messages?.length || typeof b?.feature !== 'string') return fail(400, 'bad-request', '请求缺少 feature 或 messages');
      const cost = costOf(b.feature);
      const dup = typeof b.requestId === 'string' && charged.has(b.requestId);
      if (!dup && u.credits < cost) {
        return fail(402, 'quota', `积分不够了:这次要 ${cost} 积分,还剩 ${u.credits} 积分`, { balance: u.credits, need: cost });
      }
      const input = messages.reduce((s: number, m: any) => s + String(m?.content ?? '').length, 0);
      // 带工具的请求(助手):还没交回过工具结果 = 调用第一个工具(参数为空);交回过 = 正常回话
      const tool = Array.isArray(b.tools) && b.toolChoice !== 'none' && messages[messages.length - 1]?.role !== 'tool' ? b.tools[0]?.function?.name : undefined;
      const toolCalls = typeof tool === 'string' && tool ? [{ id: 'call_fake_0', type: 'function', function: { name: tool, arguments: '{}' } }] : undefined;
      const reply = toolCalls
        ? ''
        : b.json
        ? JSON.stringify({ fake: true, feature: b.feature })
        : b.feature === '连接测试'
          ? '你好'
          : `【开发用假服务器 · ${b.feature}】${b.title ? `「${b.title}」` : ''}这是一段假的回复,用来检查登录、扣积分和流式显示,不代表真实效果。`;
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(ctl) {
          const send = (event: string, data: unknown) => ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          ctl.enqueue(enc.encode(': 开发用假服务器\n\n'));
          const step = Math.max(4, Math.ceil(reply.length / 6));
          for (let i = 0; i < reply.length; i += step) {
            send('delta', { text: reply.slice(i, i + step) });
            if (delay) await new Promise((r) => setTimeout(r, delay));
          }
          if (!dup) {
            u.credits -= cost;
            if (typeof b.requestId === 'string') charged.add(b.requestId);
          }
          send('done', {
            model: 'fake-ai-1',
            usage: { inputTokens: input, outputTokens: reply.length },
            charged: dup ? 0 : cost,
            balance: u.credits,
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
          });
          ctl.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
      });
    }

    if (req.method === 'POST' && path === '/v1/account/delete') {
      const b = await body(req);
      if (b?.code !== FAKE_CODE) return fail(400, 'bad-code', '验证码不对或已过期');
      users.delete(u.account);
      for (const [t, a] of tokens) if (a === u.account) tokens.delete(t);
      for (const sh of shares.values()) if (sh.user === u) sh.stopped = true;
      return new Response(null, { status: 204, headers: CORS });
    }

    // ---- 账号里的世界(src/account/cloud.ts) ----
    const now = Date.now();
    if (req.method === 'GET' && path === '/v1/worlds') {
      return json(200, {
        worlds: [...u.worlds].map(([id, w]) => ({ id, rev: w.rev, updatedAt: iso(w.updatedAt), ...(w.deletedAt !== null ? { deleted: true } : {}) })),
      });
    }
    if (req.method === 'GET' && path === '/v1/trash') {
      const list = [...u.worlds].filter(([, w]) => w.deletedAt !== null).sort((a, b) => b[1].deletedAt! - a[1].deletedAt!);
      return json(200, {
        worlds: list.map(([id, w]) => {
          const s = (w.save ?? {}) as { title?: string; seed?: number };
          return { id, title: s.title || '未命名世界', seed: s.seed, meta: w.meta, thumb: w.thumb, deletedAt: iso(w.deletedAt!), purgeAt: iso(w.deletedAt! + 30 * 86400_000) };
        }),
      });
    }
    if (req.method === 'GET' && path === '/v1/shares') {
      const list = [...shares].filter(([, sh]) => sh.user === u && !sh.stopped && u.worlds.get(sh.worldId)?.deletedAt === null);
      return json(200, {
        shares: list
          .sort((a, b) => b[1].createdAt - a[1].createdAt)
          .map(([code, sh]) => ({
            code,
            worldId: sh.worldId,
            title: ((u.worlds.get(sh.worldId)!.save ?? {}) as { title?: string }).title || '未命名世界',
            createdAt: iso(sh.createdAt),
            opens: sh.opens,
            ...(sh.by ? { by: sh.by } : {}),
          })),
      });
    }
    const restore = /^\/v1\/trash\/([^/]+)\/restore$/.exec(path);
    if (req.method === 'POST' && restore) {
      const w = u.worlds.get(restore[1]);
      if (!w || w.deletedAt === null) return fail(404, 'not-found', '最近删除里没有这个世界');
      w.deletedAt = null;
      w.rev++;
      w.updatedAt = now;
      return json(200, { rev: w.rev, updatedAt: iso(now), ...(u.fulls.has(restore[1]) ? { full: 'kept' } : {}) });
    }
    const one = /^\/v1\/worlds\/([^/]+)(\/share)?$/.exec(path);
    if (one) {
      const id = decodeURIComponent(one[1]);
      if (!WORLD_ID.test(id)) return fail(400, 'bad-request', '世界编号不对');
      const w = u.worlds.get(id);
      if (one[2]) {
        const active = [...shares].find(([, sh]) => sh.user === u && sh.worldId === id && !sh.stopped);
        if (req.method === 'POST') {
          // 署名:带了就改(空 = 不署名),不带 = 不动;最多 20 个字(按看到的字算,一个组合表情算一个),总长不超过 320
          const raw = (await body(req))?.by;
          if (raw !== undefined && (typeof raw !== 'string' || raw.length > 320 || seen(raw.trim()) > 20)) return fail(400, 'bad-request', '署名最多 20 个字');
          const by = typeof raw === 'string' ? raw.trim() : undefined;
          if (!w || w.deletedAt !== null) return fail(404, 'not-found', '账号里还没有这个世界,等同步好了再分享');
          const out = (code: string, sh: Share) => json(200, { code, worldId: id, createdAt: iso(sh.createdAt), opens: sh.opens, ...(sh.by ? { by: sh.by } : {}) });
          if (active) {
            if (by !== undefined) active[1].by = by || undefined;
            return out(active[0], active[1]);
          }
          let code = '';
          while (!code || shares.has(code)) code = Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
          const sh: Share = { user: u, worldId: id, createdAt: now, stopped: false, opens: 0, ...(by ? { by } : {}) };
          shares.set(code, sh);
          return out(code, sh);
        }
        if (req.method === 'DELETE') {
          if (active) active[1].stopped = true;
          return new Response(null, { status: 204, headers: CORS });
        }
      } else if (req.method === 'GET') {
        if (!w || w.deletedAt !== null) return fail(404, 'not-found', '账号里没有这个世界');
        return json(200, { id, rev: w.rev, updatedAt: iso(w.updatedAt), save: w.save, meta: w.meta, thumb: w.thumb, notes: w.notes });
      } else if (req.method === 'PUT') {
        const b = await body(req);
        if (!b || typeof b.baseRev !== 'number' || b.baseRev < 0 || !b.save || typeof b.save !== 'object') return fail(400, 'bad-request', '存档不对');
        const cur = w?.rev ?? 0;
        const deleted = !!w && w.deletedAt !== null;
        if (b.baseRev !== cur || (deleted && !b.revive)) return fail(409, 'conflict', '别的设备先改过了', { rev: cur, deleted });
        const next: World = w ?? { rev: 0, save: null, meta: null, thumb: null, notes: null, updatedAt: now, deletedAt: null };
        next.save = b.save;
        if (b.meta !== undefined) next.meta = b.meta;
        if (b.thumb !== undefined) next.thumb = b.thumb;
        if (b.notes !== undefined) next.notes = Array.isArray(b.notes) && b.notes.length ? b.notes : null;
        next.rev = cur + 1;
        next.updatedAt = now;
        next.deletedAt = null;
        u.worlds.set(id, next);
        return json(200, { rev: next.rev, updatedAt: iso(now) });
      } else if (req.method === 'DELETE') {
        const base = new URL(req.url).searchParams.get('baseRev');
        if (!w || w.deletedAt !== null) return json(200, { rev: w?.rev ?? 0, deleted: true });
        if (base !== null && Number(base) !== w.rev) return fail(409, 'conflict', '别的设备之后又改过', { rev: w.rev, deleted: false });
        w.rev++;
        w.deletedAt = now;
        w.updatedAt = now;
        for (const sh of shares.values()) if (sh.user === u && sh.worldId === id) sh.stopped = true;
        return json(200, { rev: w.rev, deleted: true });
      }
    }

    return fail(404, 'bad-request', '没有这个接口');
  }

  return { handle, users, shares, gallery, subs };
}

/** 挂到 Vite 开发服务器上用(connect 中间件;挂载前缀已被去掉,req.url 是 /v1/...) */
export function fakeAiMiddleware(opts?: FakeAiOptions) {
  const server = createFakeAiServer(opts);
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      if (req.method !== 'GET' && req.method !== 'HEAD') for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const r = await server.handle(
        new Request(`http://fake-ai${req.url ?? '/'}`, {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        }),
      );
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (!r.body) return void res.end();
      const reader = r.body.getReader();
      res.on('close', () => void reader.cancel().catch(() => {}));
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'server', message: `假服务器出错:${e instanceof Error ? e.message : String(e)}` } }));
    }
  };
}
