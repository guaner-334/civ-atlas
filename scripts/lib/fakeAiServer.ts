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
 * 邀请制(inviteOnly,开发服务器里开着):新邮箱要邀请码 K7QM-2XPA(大小写、横线不计较;假服务器里用不完)。
 * 世界、最近删除、分享都在内存里;最近删除不会过期。
 * 带工具的请求(助手):最后一条不是工具结果时,回一个对第一个工具的调用(参数为空,done.tool_calls);是工具结果时正常回话。
 * 传到账号的世界(src/account/fullWorlds.ts):块和文件都在内存里;不真核对,看一眼开头是不是 ZIP,文字审核用 fullFail 模拟。
 * POST /v1/dev/full { off?, limits?, fail?, storeFull? } 改这部分的行为(off = 当服务器没开这个功能,接口都 404)。
 * 作品墙(src/account/gallery.ts):开着,摆着世界(带世界文件)、地图、新建参数各一件,一件精选、一个挑战;不用登录。
 * 世界作品的文件是 tests/fixtures/world-file/v1.civworld。POST /v1/dev/gallery { off?, withdrawn? } 关掉作品墙(接口都 404)、撤下几件。
 */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GENERATOR_VERSION } from '../../src/gen/edits';

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

type WorkKind = 'world' | 'map' | 'preset';

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
  /** 世界:带世界文件 */
  full?: true;
}

const REPORT_REASONS = ['illegal', 'porn', 'abuse', 'privacy', 'infringe', 'other'];
const WORLD_FILE = new URL('../../tests/fixtures/world-file/v1.civworld', import.meta.url);

function sampleWorks(now: number): Work[] {
  const day = 86400_000;
  const preset = new URLSearchParams({ preset: '1', name: '两块完整大陆', seed: '4242', landFraction: '0.4', continents: '2' }).toString();
  return [
    { id: 'k7qm2xpa', kind: 'world', title: '金阳洋两岸', by: '砚山', blurb: '两岸七个王朝打了三百年，最后谁也没吞下谁。', version: GENERATOR_VERSION, addedAt: now - day, full: true },
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
  ];
}

/** 封面:2:1 的一块颜色,写着作品名(真的是 JPEG,这里用 SVG 代替) */
function coverSvg(w: Work): string {
  const bg = { world: '#c9d8b6', map: '#b9cfe0', preset: '#1d2a3a' }[w.kind];
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
  // 作品墙
  const gallery = { off: false, works: sampleWorks(Date.now()), withdrawn: new Set<string>(), reports: [] as { id: string; reason: string }[] };
  let worldFile: Promise<{ data: Uint8Array; sum: string }> | null = null;
  const galleryFile = () =>
    (worldFile ??= readFile(WORLD_FILE).then(async (b) => {
      const data = new Uint8Array(b);
      return { data, sum: await sha(data) };
    }));
  const workView = (w: Work) => ({ id: w.id, kind: w.kind, title: w.title, by: w.by, blurb: w.blurb, version: w.version, addedAt: iso(w.addedAt) });
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

    if (req.method === 'GET' && path === '/v1/auth/options') {
      return json(200, { accountKinds: ['email'], inviteOnly, codeTtlSec: 600 });
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
      return json(200, { token, user: { id: u.id, account, name: account.split('@')[0] }, credits: u.credits });
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

    const u = who(req);
    if (path.startsWith('/v1/') && !u) return fail(401, 'auth', '登录过期了,请重新登录');
    if (!u) return fail(404, 'bad-request', '没有这个接口');

    if (req.method === 'GET' && path === '/v1/me') {
      return json(200, {
        user: { id: u.id, account: u.account, name: u.account.split('@')[0] },
        credits: u.credits,
        pricing: { note: '每次调用扣 3 积分,连接测试扣 1 积分(开发用假服务器)' },
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

  return { handle, users, shares, gallery };
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
