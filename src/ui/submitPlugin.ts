/** 投插件:插件投稿须知、窗里那段话,从「我的投稿」认出这个插件上没上过墙,作品墙上那一版要了哪几行。不碰插件代码 */
import { call } from '../account/server';
import type { Submission } from '../account/submissions';
import type { AuthOptions } from '../account/session';
import type { PluginWork } from './submitView';

/** 插件投稿须知第几版(投的时候带上;服务器的对不上回 terms-changed),和作品的投稿须知分开 */
export const PLUGIN_TERMS_VERSION = 1;

export const PLUGIN_TERMS: readonly string[] = [
  '代码是你写的，或者你有权发布；用了别人的代码，许可证要允许，并写明出处。',
  '用开源许可证（MIT、Apache-2.0、GPL-3.0 这类），包里带许可证全文。',
  '代码不压缩、不混淆，一个人能读懂；我们看不懂的退回。',
  '做的和说明写的一样：不冒充网站，不让人输入密码、密钥、账号，不按日期或随机偷偷换做法。',
  '每一版都要审：新版审过之前，作品墙上照旧是上一版。',
  '出了问题我们会停用：装了它的人不再能启动它，用过它的世界照常能看。',
];

export const PLUGIN_TERMS_CHECKS = '我们会看全部代码、在示例世界上试跑，再照这几条打勾：做的和说的一致、不冒充网站、字合规、权限没多要、许可证对、没有按日期或随机偷偷变。';

export const PLUGIN_SHOW = '插件还是你的。投稿等于允许我们在作品墙上展示、分发这个插件文件：谁都能装上，照它的开源许可证用、改。我们会看全部代码，在示例世界上跑一遍再决定上不上。';

/** 服务器收插件:开着投插件,也说了插件投稿须知第几版 */
export const pluginSubmitOn = (f: AuthOptions['features'] | null | undefined): boolean => !!f?.submit && !!f.submitPlugin && f.pluginTerms !== null;

/** 审过的(上过墙的)几种状态 */
const UP = new Set(['live', 'replaced', 'withdrawn', 'disabled']);
const WAITING = new Set(['checking', 'pending', 'reviewing']);

/** 主.次.补丁 比大小 */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

export interface PluginWall {
  /** 审过的最新一版;没上过墙 = null */
  up: Submission | null;
  /** 第一次上墙时的署名(新版跟着它) */
  by: string | null;
  /** 正在等审的那一版 */
  waiting: Submission | null;
}

/** 这个账号投过的这个插件(按编号):上过墙没有、署名、有没有一版在等审 */
export function pluginWall(list: readonly Submission[], id: string): PluginWall {
  const mine = list.filter((s) => s.kind === 'plugin' && s.plugin?.id === id);
  const up = mine.filter((s) => UP.has(s.status));
  const latest = up.reduce<Submission | null>((best, s) => (!best || compareVersions(s.plugin!.version, best.plugin!.version) > 0 ? s : best), null);
  const first = [...up].sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? '') || a.id - b.id)[0];
  return { up: latest, by: first?.by || null, waiting: mine.find((s) => WAITING.has(s.status)) ?? null };
}

/** 作品墙上那一版要的能力;取不到 = null */
export async function wallCaps(workId: string): Promise<string[] | null> {
  try {
    const w = await call<{ plugin?: { requires?: unknown; optional?: unknown } }>(`/v1/gallery/${encodeURIComponent(workId)}`);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return w.plugin && Array.isArray(w.plugin.requires) ? [...list(w.plugin.requires), ...list(w.plugin.optional)] : null;
  } catch {
    return null;
  }
}

/** 这一份比作品墙上那一版多出来的权限行(同一行里多要了一样能力不算) */
export function addedLines(p: Pick<PluginWork, 'lines' | 'capLines'>, oldCaps: readonly string[]): string[] {
  const had = new Set(oldCaps.map((c) => p.capLines[c]).filter((k): k is string => !!k));
  return p.lines.filter((k) => !had.has(k));
}

/** 「1.4」:比 v 大一点的版本号,告诉作者该改成多少 */
export function nextVersion(v: string): string {
  const [a = 0, b = 0] = v.split('.').map(Number);
  return `${a}.${b + 1}`;
}
