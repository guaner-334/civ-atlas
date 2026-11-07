/** 投稿窗里填的字(一件作品一份)、这个账号看过第几版投稿须知:记在这个浏览器里,按账号分开 */
import { getSession } from '../account/session';

const DRAFTS = 'civ-atlas:submit-drafts';
const AGREED = 'civ-atlas:submit-terms';
/** 最多留几件没投出去的 */
const KEEP = 20;

export interface Draft {
  title: string;
  by: string;
  blurb: string;
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 记不下只是下次打开要重填 */
  }
}
const userKey = () => {
  const s = getSession();
  return s ? String(s.user.id || s.user.account) : '';
};

export function draftOf(work: string): Draft | null {
  const d = readJson<Record<string, Draft>>(DRAFTS)?.[`${userKey()}:${work}`];
  return d && typeof d.title === 'string' && typeof d.by === 'string' && typeof d.blurb === 'string' ? d : null;
}

/** d = null:投出去了,不用留 */
export function keepDraft(work: string, d: Draft | null): void {
  const all = { ...(readJson<Record<string, Draft>>(DRAFTS) ?? {}) };
  const k = `${userKey()}:${work}`;
  delete all[k];
  if (d) all[k] = d;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[old];
  writeJson(DRAFTS, Object.keys(all).length ? all : null);
}

/** 这个账号上次投稿时看的第几版须知;没投过 = null */
export function agreedTerms(): number | null {
  const v = readJson<Record<string, number>>(AGREED)?.[userKey()];
  return typeof v === 'number' ? v : null;
}

export function keepAgreed(version: number): void {
  writeJson(AGREED, { ...(readJson<Record<string, number>>(AGREED) ?? {}), [userKey()]: version });
}
