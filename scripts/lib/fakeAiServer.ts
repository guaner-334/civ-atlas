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
 * 作品墙上的插件:示例插件(examples/plugins)现打的包,量路程(第 1.2 版,往前还有两版)、离海多远、框选合计;下载文件、试跑的图(种子 7、2024)、
 * 举报(插件那组理由)、停用名单 GET /v1/plugins/verdicts(maxAge 只给 60 秒,改了马上看得到)。
 * POST /v1/dev/plugins { publish?, block?, unblock? }:publish 'route-days' 让量路程第 1.3 版审过上墙(多要「看历史」);
 * block { id | sum, why } 停用(按编号停的作品墙上一起撤下);unblock 解除全部停用。
 * 投到作品墙(src/account/submissions.ts):投世界、地图、新建参数、规则,撤回、撤下;一天 3 次、同时等审 5 件、须知第 3 版;
 * 作者填的字(地图、链接里的字也算)里有「敏感词」三个字就当碰到词。世界核对用 fullCheckMs,过了就进等审(不建后台草稿)。
 * POST /v1/dev/submit { off?, world?, phoneRequired?, terms?, fail?, refuse?, ban?, used?, pending?, forget?, add?, decide? }:
 * fail 下一次核对怎么判(同 fullFail);refuse { at: 'begin' | 'commit' | 'post', status, code, message, ... } 下一次先问 / 提交 / 投另外三种直接回这个错;
 * ban 当前账号停了投稿(null 解开);used、pending 把今天投过的次数、等审的件数当成几;forget 忘掉传上来的块(再投要整个重传);
 * add [{ kind, title, status, reason?, workId?, createdAt?, decidedAt?, updatedAt? }] 直接摆几件(时间是毫秒);
 * decide { id, status, reason?, workId? } 当成后台审了(上墙、退回、撤下)。
 * 投插件(POST /v1/submissions/plugin):照清单读插件文件,不跑代码;插件投稿须知第 1 版;编号第一次投时归这个账号;上过墙的要写 note;
 * 新版上墙(decide live)时上一版变成 replaced、接着用同一个作品编号。dev/submit 另收 pluginTerms(插件须知第几版)、
 * pluginTaken [编号](当成别的账号的),add 里的 { kind: 'plugin', plugin: { id, version, name, note? } } 摆插件的投稿。
 * 绑手机号:验证码同样是 246810;139 0013 2277 当成绑了别的账号、135 0013 7701 当成封过的号;phoneRequired(上面那个开关)开着时
 * 投稿、开分享、改署名没绑回 need-phone。POST /v1/dev/phone { fail?, unbind? }:fail 让下一次发码回 'rate-limit' 或 'unavailable';unbind 解开当前账号的号。
 * 分享短链接的举报:3 次就自动暂停(假服务器认不出网络,一次算一个网络),一小时超过 5 次回太频繁;服务器没开作品墙时 404。
 * POST /v1/dev/share { code?, pause?, stop?, resolve? }(要登录;code 不给 = 当前账号最新开的那个):pause 'auto' | 'admin' 暂停、null 恢复;
 * stop 写原因就是我们彻底停了;resolve 我们看过了(暂停中停掉的那条放开,这个世界能再开)。
 * POST /v1/dev/ban { account, ban, gone? }(不用登录):ban 的样子同服务器,level 'submit' 停投稿、'all' 停用账号,null 解开;gone 封着注销掉。
 * 停用账号时已登录的令牌不认,拿着它的请求回 401 带 ban(说明是停用);解封、换回停投稿时这些令牌作废。
 * 封着注销的邮箱再注册:停投稿的带上同一档(carried),停用的不让注册。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GENERATOR_VERSION } from '../../src/gen/edits';
import { join } from 'node:path';
import { STEADY_RULES, WARRING_RULES, makeWorldFile, rulesBriefOf, rulesLinkOf } from './fakeWorldFile';
import { openPluginFile, type PluginManifest } from '../../src/plugin/pluginFile';
import { packPluginDir } from './pluginDir';

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
  /** 停用账号(ban 的样子,level 'all') */
  disabled?: unknown;
  /** 绑的手机号(11 位) */
  phone?: string;
  /** 开发时手动加的:今天另外投过几次、另外几件在等审 */
  extraUsed?: number;
  extraPending?: number;
}

/** 投到作品墙的一件 */
interface Sub {
  id: number;
  user: User;
  kind: WorkKind | 'plugin';
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
  /** 投插件:清单里的编号、版本、名字,文件指纹,这一版改了什么 */
  plugin?: { id: string; version: string; name: string; sum: string; note?: string };
}

/** 认的开源许可证(SPDX 写法;A OR B 有一个是就行) */
const OPEN_LICENSE = /^(MIT|MIT-0|Apache-2\.0|BSD-[23]-Clause|0BSD|ISC|Zlib|Unlicense|CC0-1\.0|MPL-2\.0|MulanPSL-2\.0|(A|L)?GPL-[23]\.[01](-only|-or-later)?\+?)$/i;
const openLicense = (expr: string) => expr.split(/\s+OR\s+/i).some((x) => OPEN_LICENSE.test(x.replace(/[()]/g, '').trim()));
const compareVersions = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
/** 审过的插件投稿的几种状态 */
const PLUGIN_UP = ['live', 'replaced', 'withdrawn', 'disabled'];

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
  /** 暂停中(举报够数、我们暂停的) */
  paused?: { by: string; at: number };
  /** 暂停中被开的人停掉了,我们还没看过:这个世界开不了新链接 */
  held?: boolean;
  /** 我们彻底停了:给开的人看的原因;seen = 点过「知道了」 */
  siteStopped?: string;
  seen?: boolean;
  reports: number;
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
const PLUGIN_REPORT_REASONS = ['impersonate', 'mismatch', 'illegal', 'porn', 'infringe', 'other'];

/** 作品墙上的一个插件:各版新的在前(patch = 打包前改清单的几项);ready = 还没审过的新版(开发接口 publish 让它上墙) */
interface FakePlugin {
  work: string;
  dir: string;
  title: string;
  by: string;
  blurb: string;
  addedAt: number;
  versions: { version: string; note: string; at: number; patch: Record<string, unknown> }[];
  ready?: { version: string; note: string; patch: Record<string, unknown> };
}

function samplePlugins(now: number): FakePlugin[] {
  const day = 86400_000;
  // 量路程第 1.2 版以前不要「看历史」,第 1.3 版才要
  const noHistory = { optional: [], why: { 'world.read@1': '按地形和水陆找路、量距离', 'input.pick@1': '请你在地图上点起点和终点', 'layer.marks@1': '把路线画在地图上' } };
  return [
    {
      work: 'q8xr3mvd',
      dir: 'route-days',
      title: '量路程',
      by: '青石',
      blurb: '点两个点，沿陆路按地形算要走几天（山路难走，水上过不去），画出路线。',
      addedAt: now - 13 * day,
      versions: [
        { version: '1.2.0', note: '量完一条接着点下一条，不用再点「开始量」', at: now - 5 * day, patch: { ...noHistory, version: '1.2.0' } },
        { version: '1.1.0', note: '可以选步行还是骑马', at: now - 10 * day, patch: { ...noHistory, version: '1.1.0' } },
        { version: '1.0.0', note: '', at: now - 13 * day, patch: { ...noHistory, version: '1.0.0' } },
      ],
      ready: { version: '1.3.0', note: '起点、终点用附近的城起名，沿途经过哪几国也列出来', patch: { version: '1.3.0' } },
    },
    { work: 'h5ct7nbe', dir: 'coast-distance', title: '离海多远', by: '北岸', blurb: '加一个地块图层：每块陆地走陆路到海边有多少公里，分五段上色。', addedAt: now - 8 * day, versions: [{ version: '1.0.0', note: '', at: now - 8 * day, patch: {} }] },
    { work: 'b2fw9kye', dir: 'box-summary', title: '框选合计', by: '北岸', blurb: '框一片地方，合计里面的陆地、州、人口、城市和各国占多少；可以存成一个标记。', addedAt: now - 9 * day, versions: [{ version: '1.0.0', note: '', at: now - 9 * day, patch: {} }] },
  ];
}

/** 插件试跑的图:2:1 的一块颜色,写着插件名和种子 */
function shotSvg(title: string, seed: string): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const bg = seed === '2024' ? '#d8cfb4' : '#cfdcc0';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><rect width="640" height="320" fill="${bg}"/><path d="M90 90 C 220 140, 300 220, 540 230" stroke="#c0392b" stroke-width="5" fill="none"/><text x="320" y="160" font-size="36" text-anchor="middle" fill="#2b3a2e" font-family="sans-serif">${esc(title)}</text><text x="320" y="204" font-size="20" text-anchor="middle" fill="#55624f" font-family="sans-serif">种子 ${esc(seed)}</text></svg>`;
}

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
    pluginTerms: 1,
    pluginTaken: new Set<string>(),
    perDay: 3,
    pendingMax: 5,
    fail: null as FakeFullFail | null,
    refuse: null as { at: string; status: number; code: string; message: string; [k: string]: unknown } | null,
  };
  const subs: Sub[] = [];
  let subSeq = 0;
  /** 插件编号第一次投时归哪个账号 */
  const pluginOwners = new Map<string, User>();
  // 手机号、封禁、短链接的举报
  const phoneState = { taken: new Set(['13900132277']), blocked: new Set(['13500137701']), fail: null as string | null, sent: new Map<string, { phone: string; at: number }>() };
  /** 封着注销的邮箱 → 那时的封禁 */
  const bannedEmails = new Map<string, { level?: string; reason?: string; reasonText?: string }>();
  const shareReports: number[] = [];
  const masked = (p: string) => `${p.slice(0, 3)}****${p.slice(-4)}`;
  const banOf = (u: User) => (u.disabled ?? u.ban) as { level?: string; reason?: string; reasonText?: string } | undefined;
  const bannedReply = (u: User) => {
    const b = u.ban as { reason?: string; reasonText?: string };
    return fail(403, 'submit-banned', b.reason === 'withdraw' ? (b.reasonText ?? '') : `你的账号已停止投稿。原因:${b.reasonText ?? ''}`, { ban: u.ban });
  };
  /** 暂停中:我们暂停的、举报够数的;开的人被封了也算 */
  const pausedOf = (sh: Share) => sh.paused ?? (banOf(sh.user) ? { by: 'ban', at: Date.now() } : undefined);
  /** 打开、下载、举报前看这个码现在能不能看 */
  const shareProblem = (sh: Share | undefined): Response | null => {
    if (sh?.siteStopped) return fail(404, 'share-gone', '这个分享已经停止了', { stoppedBy: 'site' });
    const w = sh && !sh.stopped && users.get(sh.user.account) === sh.user ? sh.user.worlds.get(sh.worldId) : undefined;
    if (!sh || !w || w.deletedAt !== null) return fail(404, 'share-gone', '这个分享已经停止了');
    if (pausedOf(sh)) return fail(403, 'share-paused', '这个链接暂停了。恢复以后,原来的链接照样能打开');
    return null;
  };
  const phoneProblem = (u: User, phone: string): Response | null => {
    if (u.ban) return bannedReply(u);
    if (u.phone === phone) return fail(409, 'phone-same', '这个手机号已经绑在你的账号上了');
    if (phoneState.blocked.has(phone)) return fail(403, 'phone-blocked', '这个手机号不能用来绑定');
    if (phoneState.taken.has(phone) || [...users.values()].some((x) => x !== u && x.phone === phone)) return fail(409, 'phone-taken', '这个手机号已经绑了别的账号。一个手机号只能绑一个账号');
    return null;
  };
  const cleanNum = (v: unknown) => {
    const d = typeof v === 'string' ? v.replace(/[\s-]/g, '').replace(/^\+?86(?=1\d{10}$)/, '') : '';
    return /^1\d{10}$/.test(d) ? d : null;
  };
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
      ...(x.reason && (x.status === 'returned' || x.status === 'withdrawn' || x.status === 'disabled') ? { reason: x.reason } : {}),
      ...(x.workId ? { workId: x.workId } : {}),
      ...(x.plugin ? { plugin: x.plugin } : {}),
      createdAt: iso(x.createdAt),
      updatedAt: iso(x.updatedAt),
      ...(x.decidedAt !== undefined ? { decidedAt: iso(x.decidedAt) } : {}),
    };
  };
  const SUB_KINDS: readonly string[] = ['world', 'map', 'preset', 'rules', 'plugin'];
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
  // 作品墙上的插件
  const plugins = { list: samplePlugins(Date.now()), blocked: [] as { id?: string; sum?: string; why: string; at: number }[], packs: new Map<string, Promise<{ id: string; bytes: Uint8Array; sum: string; manifest: PluginManifest }>>() };
  const packOf = (p: FakePlugin, patch: Record<string, unknown>) => {
    const key = `${p.dir}:${JSON.stringify(patch)}`;
    let got = plugins.packs.get(key);
    if (!got) {
      got = packPluginDir(join(process.cwd(), 'examples', 'plugins', p.dir), patch).then(async (r) => {
        const opened = await openPluginFile(r.bytes);
        return { ...r, sum: opened.sum, manifest: opened.manifest };
      });
      plugins.packs.set(key, got);
    }
    return got;
  };
  const pluginGone = (p: FakePlugin) => gallery.withdrawn.has(p.work) || plugins.blocked.some((b) => b.id === p.dir);
  const pluginView = async (p: FakePlugin, full: boolean) => {
    const cur = p.versions[0];
    const pack = await packOf(p, cur.patch);
    const m = pack.manifest;
    const versions = await Promise.all(p.versions.map(async (v) => ({ version: v.version, sum: (await packOf(p, v.patch)).sum, at: iso(v.at), note: v.note })));
    return {
      id: p.work,
      kind: 'plugin',
      title: p.title,
      by: p.by,
      blurb: p.blurb,
      version: null,
      addedAt: iso(p.addedAt),
      plugin: {
        id: m.id,
        name: m.name,
        version: m.version,
        sum: pack.sum,
        bytes: pack.bytes.length,
        role: m.role,
        api: m.api,
        requires: m.requires,
        ...(m.optional?.length ? { optional: m.optional } : {}),
        license: m.license,
        icon: false,
        updatedAt: iso(cur.at),
        note: cur.note,
        versions,
        shots: [7, 2024],
        ...(full ? { runtime: m.runtime, ...(m.why ? { why: m.why } : {}), ...(m.description ? { description: m.description } : {}), ...(m.author ? { author: m.author } : {}) } : {}),
      },
    };
  };
  const pluginVerdicts = async () => ({
    reviewed: (await Promise.all(plugins.list.flatMap((p) => p.versions.map(async (v) => ({ sum: (await packOf(p, v.patch)).sum, id: p.dir, version: v.version }))))),
    blocked: plugins.blocked.map((b) => ({ ...(b.id ? { id: b.id } : { sum: b.sum }), why: b.why, at: iso(b.at) })),
    maxAge: 60,
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
      works: [
        ...live.map((w) => ({ ...workView(w), ...(w.full ? { full: { bytes } } : {}) })),
        ...(await Promise.all(plugins.list.filter((p) => !pluginGone(p)).map((p) => pluginView(p, false)))),
      ],
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
    if (req.method === 'POST' && path === '/v1/dev/plugins') {
      const b = await body(req);
      const p = plugins.list.find((x) => x.dir === b?.publish);
      if (p?.ready) {
        p.versions.unshift({ ...p.ready, at: Date.now() });
        p.ready = undefined;
      }
      if (b?.block && typeof b.block.why === 'string') plugins.blocked.push({ ...(typeof b.block.id === 'string' ? { id: b.block.id } : { sum: String(b.block.sum) }), why: b.block.why, at: Date.now() });
      if (b?.unblock) plugins.blocked = [];
      return json(200, { ok: true });
    }
    if (req.method === 'GET' && path === '/v1/plugins/verdicts') {
      if (gallery.off) return fail(404, 'bad-request', '没有这个接口');
      return json(200, await pluginVerdicts());
    }
    if (path === '/v1/gallery' || path.startsWith('/v1/gallery/')) {
      if (gallery.off) return fail(404, 'bad-request', '没有这个接口');
      if (req.method === 'GET' && path === '/v1/gallery') return json(200, await galleryList());
      const g = /^\/v1\/gallery\/([^/]+)(\/cover|\/full|\/report|\/plugin|\/icon)?$/.exec(path);
      const pl = g ? plugins.list.find((x) => x.work === decodeURIComponent(g[1])) : undefined;
      if (g && pl) {
        if (pluginGone(pl)) {
          const why = plugins.blocked.find((b) => b.id === pl.dir)?.why;
          return json(410, { withdrawn: true, error: { code: 'gallery-gone', message: '这个作品已经撤下', kind: 'plugin', ...(why ? { blocked: why } : {}) } });
        }
        if (req.method === 'GET' && !g[2]) return json(200, await pluginView(pl, true));
        if (req.method === 'GET' && g[2] === '/cover') {
          const seed = new URL(req.url).searchParams.get('seed') ?? '7';
          return new Response(shotSvg(pl.title, seed), { status: 200, headers: { ...CORS, 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' } });
        }
        if (req.method === 'GET' && g[2] === '/plugin') {
          const pack = await packOf(pl, pl.versions[0].patch);
          return new Response(pack.bytes, { status: 200, headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${pack.id}.civplugin"`, ETag: `"${pack.sum}"` } });
        }
        if (req.method === 'GET' && g[2] === '/icon') return fail(404, 'not-found', '这个插件没带图标');
        if (req.method === 'POST' && g[2] === '/report') {
          const reason = (await body(req))?.reason;
          if (!PLUGIN_REPORT_REASONS.includes(reason)) return fail(400, 'bad-request', '举报理由不对');
          gallery.reports.push({ id: pl.work, reason });
          return new Response(null, { status: 204, headers: CORS });
        }
        return fail(404, 'bad-request', '没有这个接口');
      }
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
    if (req.method === 'POST' && path === '/v1/dev/ban') {
      const b = await body(req);
      const t = typeof b?.account === 'string' ? users.get(b.account.trim()) : undefined;
      if (!t) return fail(404, 'not-found', '没有这个账号');
      const ban = b?.ban ?? null;
      const was = !!t.disabled;
      t.ban = ban?.level === 'submit' ? ban : undefined;
      t.disabled = ban?.level === 'all' ? ban : undefined;
      if ((was && !t.disabled) || b?.gone === true) for (const [k, a] of tokens) if (a === t.account) tokens.delete(k);
      if (b?.gone === true) {
        if (ban) bannedEmails.set(t.account, ban);
        users.delete(t.account);
      }
      return json(200, { ok: true });
    }
    if (req.method === 'GET' && path === '/v1/auth/options') {
      const submit = !submitState.off && !gallery.off;
      return json(200, {
        accountKinds: ['email'],
        inviteOnly,
        codeTtlSec: 600,
        features: { ai: aiOn, submit, submitWorld: submit && submitState.world && !fullState.off, submitPlugin: submit, pluginTerms: submitState.pluginTerms, phoneRequired: submitState.phoneRequired },
      });
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
      const carried = u ? undefined : bannedEmails.get(account);
      if (carried?.level === 'all') {
        const ban = { level: 'all', reason: carried.reason, reasonText: carried.reasonText ?? '', at: null, carried: true };
        return fail(401, 'auth', `这个邮箱注销前的账号已停用,不能再注册${ban.reasonText ? `。原因:${ban.reasonText}` : ''}`, { ban });
      }
      if (!u) users.set(account, (u = { id: `u${++seq}`, account, credits: start, worlds: new Map(), fulls: new Map(), commits: 0, jobs: new Map(), ...(carried ? { ban: { ...carried, carried: true } } : {}) }));
      if (u.disabled) {
        const ban = u.disabled as { reasonText?: string };
        return fail(401, 'auth', `这个账号已停用,登录不了${ban.reasonText ? `。原因:${ban.reasonText}` : ''}`, { ban: u.disabled });
      }
      const token = `fake-${crypto.randomUUID()}`;
      tokens.set(token, account);
      return json(200, { token, user: { id: u.id, account, name: account.split('@')[0] }, ...(aiOn ? { credits: u.credits } : {}) });
    }

    const open = /^\/v1\/s\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && open) {
      const sh = shares.get(decodeURIComponent(open[1]));
      const no = shareProblem(sh);
      if (no || !sh) return no!;
      const w = sh.user.worlds.get(sh.worldId)!;
      const full = fullState.off ? undefined : sh.user.fulls.get(sh.worldId);
      if (full && !full.public) return fail(403, 'content-filter', '这个世界带着服务器看不到的附加数据,暂时打不开');
      sh.opens++;
      return json(200, { save: w.save, updatedAt: iso(w.updatedAt), ...(sh.by ? { by: sh.by } : {}), ...(full ? { full: { sum: full.sum, bytes: full.bytes, uploadedAt: iso(full.uploadedAt) } } : {}) });
    }
    const openFull = /^\/v1\/s\/([^/]+)\/full$/.exec(path);
    if (req.method === 'GET' && openFull) {
      const sh = fullState.off ? undefined : shares.get(decodeURIComponent(openFull[1]));
      const no = shareProblem(sh);
      if (no) return no;
      const f = sh!.user.fulls.get(sh!.worldId);
      if (!f) return fail(404, 'share-gone', '这个分享已经停止了');
      return fullFileResponse(f);
    }

    const report = /^\/v1\/s\/([^/]+)\/report$/.exec(path);
    if (req.method === 'POST' && report) {
      if (gallery.off) return fail(404, 'bad-request', '没有这个接口');
      const reason = (await body(req))?.reason;
      if (!REPORT_REASONS.includes(reason)) return fail(400, 'bad-request', '举报理由不对');
      const sh = shares.get(decodeURIComponent(report[1]));
      const no = shareProblem(sh);
      if (no && no.status === 404) return no;
      const hour = Date.now() - 3600_000;
      while (shareReports.length && shareReports[0] < hour) shareReports.shift();
      if (shareReports.length >= 5) return fail(429, 'rate-limit', '举报太频繁,请稍后再试', { retryAfter: 600 });
      shareReports.push(Date.now());
      sh!.reports++;
      if (sh!.reports >= 3 && !sh!.paused) sh!.paused = { by: 'auto', at: Date.now() };
      return new Response(null, { status: 204, headers: CORS });
    }

    if (!aiOn && path === '/v1/chat') return fail(404, 'bad-request', '没有这个接口');
    const u = who(req);
    if (path.startsWith('/v1/') && u?.disabled) {
      const ban = u.disabled as { reasonText?: string };
      return fail(401, 'auth', `这个账号已停用,已经退出登录${ban.reasonText ? `。原因:${ban.reasonText}` : ''}`, { ban: u.disabled });
    }
    if (path.startsWith('/v1/') && !u) return fail(401, 'auth', '登录过期了,请重新登录');
    if (!u) return fail(404, 'bad-request', '没有这个接口');

    if (req.method === 'GET' && path === '/v1/me') {
      return json(200, {
        user: { id: u.id, account: u.account, name: u.account.split('@')[0] },
        phone: u.phone ? { tail: u.phone.slice(-4), masked: masked(u.phone) } : null,
        ...(aiOn ? { credits: u.credits, pricing: { note: '每次调用扣 3 积分,连接测试扣 1 积分(开发用假服务器)' } } : {}),
        ...(u.ban ? { ban: u.ban } : {}),
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
      if (typeof b?.pluginTerms === 'number') submitState.pluginTerms = b.pluginTerms;
      if (Array.isArray(b?.pluginTaken)) submitState.pluginTaken = new Set(b.pluginTaken.filter((x: unknown) => typeof x === 'string'));
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
          const kind = (SUB_KINDS.includes(String(a.kind)) ? a.kind : 'world') as Sub['kind'];
          const pl = a.plugin as { id?: unknown; version?: unknown; name?: unknown; note?: unknown } | undefined;
          const plugin =
            kind === 'plugin' && typeof pl?.id === 'string' && typeof pl.version === 'string'
              ? { id: pl.id, version: pl.version, name: typeof pl.name === 'string' ? pl.name : String(a.title ?? ''), sum: `fake-${pl.id}-${pl.version}`, ...(typeof pl.note === 'string' ? { note: pl.note } : {}) }
              : undefined;
          if (plugin && !pluginOwners.has(plugin.id)) pluginOwners.set(plugin.id, u);
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
            ...(plugin ? { plugin } : {}),
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
          // 插件的新版上墙:上一版换下来,作品还是同一个
          if (x.plugin && d.status === 'live') {
            for (const y of subs) {
              if (y === x || y.plugin?.id !== x.plugin.id || y.status !== 'live') continue;
              y.status = 'replaced';
              y.updatedAt = now;
              x.workId ??= y.workId;
            }
          }
        }
      }
      return json(200, { ok: true });
    }

    if (req.method === 'POST' && path === '/v1/dev/phone') {
      const b = await body(req);
      if (b?.fail !== undefined) phoneState.fail = typeof b.fail === 'string' ? b.fail : null;
      if (b?.unbind === true) u.phone = undefined;
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && path === '/v1/dev/share') {
      const b = await body(req);
      const mine = [...shares].filter(([, sh]) => sh.user === u).sort((x, y) => y[1].createdAt - x[1].createdAt);
      const hit = typeof b?.code === 'string' ? mine.find(([c]) => c === b.code) : mine.find(([, sh]) => !sh.stopped);
      if (b?.resolve === true) for (const [, sh] of mine) sh.held = false;
      if (!hit) return b?.resolve === true ? json(200, { ok: true }) : fail(404, 'not-found', '没有开着的分享');
      const sh = hit[1];
      if (b?.pause === null) sh.paused = undefined;
      else if (typeof b?.pause === 'string') sh.paused = { by: b.pause, at: Date.now() };
      if (typeof b?.stop === 'string') Object.assign(sh, { stopped: true, siteStopped: b.stop, seen: false, held: false, paused: undefined });
      return json(200, { ok: true, code: hit[0] });
    }

    // ---- 绑手机号 ----
    if (req.method === 'POST' && path === '/v1/account/phone/code') {
      const phone = cleanNum((await body(req))?.phone);
      if (!phone) return fail(400, 'bad-phone', '手机号要是 11 位,1 开头');
      const no = phoneProblem(u, phone);
      if (no) return no;
      const f = phoneState.fail;
      phoneState.fail = null;
      if (f === 'rate-limit') return fail(429, 'rate-limit', '发得太频繁了,过一会儿再试', { retryAfter: 60 });
      if (f === 'unavailable') return fail(503, 'unavailable', '短信暂时发不出去,过一会儿再试');
      const last = phoneState.sent.get(u.id);
      if (last?.phone === phone && Date.now() - last.at < 60_000) {
        return fail(429, 'rate-limit', `验证码刚发过,${Math.ceil((last.at + 60_000 - Date.now()) / 1000)} 秒后才能重发`, { retryAfter: 60 });
      }
      phoneState.sent.set(u.id, { phone, at: Date.now() });
      return json(200, { ok: true, to: masked(phone), resendAfter: 60, expiresIn: 600, devCode: FAKE_CODE });
    }
    if (req.method === 'POST' && path === '/v1/account/phone') {
      const b = await body(req);
      const phone = cleanNum(b?.phone);
      if (!phone) return fail(400, 'bad-phone', '手机号要是 11 位,1 开头');
      if (b?.code !== FAKE_CODE || phoneState.sent.get(u.id)?.phone !== phone) return fail(400, 'bad-code', '验证码不对或已过期');
      const no = phoneProblem(u, phone);
      if (no) return no;
      u.phone = phone;
      phoneState.sent.delete(u.id);
      return json(200, { phone: { tail: phone.slice(-4), masked: masked(phone) } });
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
      if (req.method === 'POST' && path === '/v1/submissions/plugin') {
        const b = await body(req);
        const r = submitState.refuse;
        if (r && r.at === 'plugin') {
          submitState.refuse = null;
          const { at: _a, status, code, message, ...extra } = r;
          return fail(status, code, message, extra);
        }
        if (b?.terms !== submitState.terms || b?.pluginTerms !== submitState.pluginTerms) {
          return fail(409, 'terms-changed', '投稿须知改过了,请看过新的再投', { terms: submitState.terms, pluginTerms: submitState.pluginTerms });
        }
        const f = { by: String(b?.by ?? '').trim(), blurb: String(b?.blurb ?? '').trim() };
        const note = typeof b?.note === 'string' ? b.note.trim() : '';
        if (!f.by || !f.blurb) return fail(400, 'bad-request', '要填署名和一句话介绍');
        if (seen(note) > 40) return fail(400, 'bad-request', '这一版改了什么最多 40 个字');
        if (typeof b?.file !== 'string' || !b.file) return fail(400, 'bad-request', '要交插件文件(.civplugin)');
        if (u.ban) return bannedReply(u);
        if (submitState.phoneRequired && !u.phone) return fail(403, 'need-phone', '按国家规定,在网站上投稿、开分享链接,要先绑定手机号');
        const lim = submitLimits(u);
        if (lim.usedToday >= lim.perDay) return fail(429, 'submit-limit', '今天投够 3 次了,明天再投', { limit: 'per-day', retryAfter: 3600, left: 0, ...lim });
        if (lim.pending >= lim.pendingMax) return fail(429, 'submit-limit', '等审的太多了,审完一份再投', { limit: 'pending', left: lim.perDay - lim.usedToday, ...lim });
        const typed = { by: f.by, blurb: f.blurb, note };
        const labels = { by: '署名', blurb: '一句话介绍', note: '这一版改了什么' } as const;
        const hits = (['by', 'blurb', 'note'] as const).filter((k) => typed[k].includes('敏感词')).map((k) => ({ by: 'author', part: 'info', kind: labels[k], text: typed[k].slice(0, 60) }));
        if (hits.length) return fail(400, 'content-filter', `有 ${hits.length} 处字词不能公开,改掉以后再投`, { hits, hitCount: hits.length });
        let opened: Awaited<ReturnType<typeof openPluginFile>>;
        try {
          opened = await openPluginFile(new Uint8Array(Buffer.from(b.file, 'base64')));
        } catch (e) {
          return fail(400, 'plugin-invalid', `这个插件文件没过检查,没有收下:${(e as Error).message}`);
        }
        const m = opened.manifest;
        if (!openLicense(m.license)) return fail(400, 'plugin-license', `上架的插件要用开源许可证(比如 MIT、Apache-2.0、GPL-3.0-or-later),清单里写的是「${m.license}」`);
        const owner = pluginOwners.get(m.id);
        if (submitState.pluginTaken.has(m.id) || (owner && owner !== u)) return fail(409, 'plugin-taken', `插件编号「${m.id}」已经是别人的插件了,换一个编号再投`);
        const mine = subs.filter((x) => x.user === u && x.plugin?.id === m.id);
        mine.forEach(settle);
        const waiting = mine.find((x) => x.status === 'checking' || x.status === 'pending' || x.status === 'reviewing');
        if (waiting) return fail(409, 'conflict', '这个插件还有一版在等审核。要换成这一版,先在我的投稿里撤回那一版', { reason: 'waiting', id: waiting.id });
        const up = mine.filter((x) => PLUGIN_UP.includes(x.status));
        const last = up.reduce<Sub | null>((best, x) => (!best || compareVersions(x.plugin!.version, best.plugin!.version) > 0 ? x : best), null);
        if (last?.plugin?.sum === opened.sum) return fail(409, 'conflict', '这一版已经审过了', { reason: 'same' });
        if (last && compareVersions(m.version, last.plugin!.version) <= 0) {
          return fail(409, 'conflict', `版本号要比审过的 ${last.plugin!.version} 大,改了清单的 version 再投`, { reason: 'version', version: last.plugin!.version });
        }
        if (last && !note) return fail(400, 'note-required', '这个插件上过作品墙,投新版要写这一版改了什么');
        const first = [...up].sort((a, c) => a.createdAt - c.createdAt || a.id - c.id)[0];
        pluginOwners.set(m.id, u);
        const now = Date.now();
        const plugin = { id: m.id, version: m.version, name: m.name, sum: opened.sum, ...(note ? { note } : {}) };
        const x: Sub = { id: ++subSeq, user: u, kind: 'plugin', title: m.name, by: first?.by || f.by, blurb: f.blurb, moment: null, status: 'pending', sum: opened.sum, createdAt: now, updatedAt: now, plugin };
        subs.push(x);
        return json(201, { id: x.id, status: 'pending', plugin: { id: m.id, version: m.version, sum: opened.sum } });
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
        if (u.ban) return bannedReply(u);
        if (submitState.phoneRequired && !u.phone) return fail(403, 'need-phone', '按国家规定,在网站上投稿、开分享链接,要先绑定手机号');
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
        if (u.ban) return bannedReply(u);
        if (submitState.phoneRequired && !u.phone) return fail(403, 'need-phone', '按国家规定,在网站上投稿、开分享链接,要先绑定手机号');
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
      const ban = banOf(u);
      if (ban) bannedEmails.set(u.account, ban);
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
      const alive = (sh: Share) => sh.user === u && u.worlds.get(sh.worldId)?.deletedAt === null;
      const titleOf = (sh: Share) => ((u.worlds.get(sh.worldId)!.save ?? {}) as { title?: string }).title || '未命名世界';
      const list = [...shares].filter(([, sh]) => alive(sh) && !sh.stopped);
      return json(200, {
        shares: list
          .sort((a, b) => b[1].createdAt - a[1].createdAt)
          .map(([code, sh]) => {
            const p = pausedOf(sh);
            return {
              code,
              worldId: sh.worldId,
              title: titleOf(sh),
              createdAt: iso(sh.createdAt),
              opens: sh.opens,
              ...(sh.by ? { by: sh.by } : {}),
              ...(p ? { paused: { by: p.by, at: iso(p.at) } } : {}),
            };
          }),
        stopped: [...shares].filter(([, sh]) => alive(sh) && sh.siteStopped && !sh.seen).map(([code, sh]) => ({ code, worldId: sh.worldId, title: titleOf(sh), stoppedAt: iso(sh.createdAt), reason: sh.siteStopped })),
      });
    }
    const seenPath = /^\/v1\/shares\/([^/]+)\/seen$/.exec(path);
    if (req.method === 'POST' && seenPath) {
      const sh = shares.get(decodeURIComponent(seenPath[1]));
      if (!sh || sh.user !== u || !sh.siteStopped) return fail(404, 'not-found', '没有这个分享');
      sh.seen = true;
      return new Response(null, { status: 204, headers: CORS });
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
          if (u.ban) return bannedReply(u);
          if (submitState.phoneRequired && !u.phone) return fail(403, 'need-phone', '按国家规定,在网站上投稿、开分享链接,要先绑定手机号');
          if (!w || w.deletedAt !== null) return fail(404, 'not-found', '账号里还没有这个世界,等同步好了再分享');
          const out = (code: string, sh: Share) => {
            const p = pausedOf(sh);
            return json(200, { code, worldId: id, createdAt: iso(sh.createdAt), opens: sh.opens, ...(sh.by ? { by: sh.by } : {}), ...(p ? { paused: { by: p.by, at: iso(p.at) } } : {}) });
          };
          if (active) {
            if (by !== undefined) active[1].by = by || undefined;
            return out(active[0], active[1]);
          }
          const held = [...shares.values()].find((sh) => sh.user === u && sh.worldId === id && sh.held);
          if (held) return fail(403, 'share-held', '这个世界的分享暂停了,等我们看过才能再开', { paused: { by: held.paused?.by ?? 'admin', at: iso(held.paused?.at ?? now) } });
          let code = '';
          while (!code || shares.has(code)) code = Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
          const sh: Share = { user: u, worldId: id, createdAt: now, stopped: false, opens: 0, reports: 0, ...(by ? { by } : {}) };
          shares.set(code, sh);
          return out(code, sh);
        }
        if (req.method === 'DELETE') {
          if (active) Object.assign(active[1], { stopped: true, ...(pausedOf(active[1]) ? { held: true, paused: pausedOf(active[1]) } : {}) });
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

  return { handle, users, shares, gallery, subs, plugins };
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
