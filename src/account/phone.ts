/**
 * 账号绑的手机号:服务器接口(要登录)。号码只回尾号和打星的写法,网页不存全号。
 *
 *   GET  /v1/me                            → { user, phone: { tail, masked } | null, ban?, … }
 *   POST /v1/account/phone/code { phone }  → { ok, to: '138****8866', resendAfter, expiresIn, devCode? }
 *   POST /v1/account/phone { phone, code } → { phone: { tail, masked } }(绑过别的号 = 换绑)
 *
 * 出错:bad-phone、bad-code、phone-taken、phone-blocked、phone-same、submit-banned(带 ban)、rate-limit、unavailable。
 */
import { authed } from './session';

export interface PhoneInfo {
  tail: string;
  masked: string;
}

export function readPhone(v: unknown): PhoneInfo | null {
  const p = v as { tail?: unknown; masked?: unknown } | null;
  if (!p || typeof p !== 'object' || typeof p.tail !== 'string') return null;
  return { tail: p.tail, masked: typeof p.masked === 'string' ? p.masked : `*******${p.tail}` };
}

/** 填的号码去掉空格、横杠和 +86;不是 1 开头的 11 位 = null */
export function cleanPhone(s: string): string | null {
  const d = s.replace(/[\s-]/g, '').replace(/^\+?86(?=1\d{10}$)/, '');
  return /^1\d{10}$/.test(d) ? d : null;
}

/** 绑的手机号和停没停投稿(ban 原样给,由界面认) */
export async function fetchMe(): Promise<{ phone: PhoneInfo | null; ban: unknown }> {
  const r = await authed<{ phone?: unknown; ban?: unknown }>('/v1/me');
  return { phone: readPhone(r.phone), ban: r.ban ?? null };
}

export interface PhoneCodeSent {
  /** 发到哪个号(打星的) */
  to: string;
  resendAfter: number;
  expiresIn: number;
  devCode?: string;
}

export async function sendPhoneCode(phone: string): Promise<PhoneCodeSent> {
  const r = await authed<{ to?: unknown; resendAfter?: unknown; expiresIn?: unknown; devCode?: unknown }>('/v1/account/phone/code', { method: 'POST', body: { phone } });
  return {
    to: typeof r.to === 'string' ? r.to : `${phone.slice(0, 3)}****${phone.slice(-4)}`,
    resendAfter: typeof r.resendAfter === 'number' ? r.resendAfter : 60,
    expiresIn: typeof r.expiresIn === 'number' ? r.expiresIn : 600,
    ...(typeof r.devCode === 'string' ? { devCode: r.devCode } : {}),
  };
}

export async function bindPhone(phone: string, code: string): Promise<PhoneInfo> {
  const r = await authed<{ phone?: unknown }>('/v1/account/phone', { method: 'POST', body: { phone, code } });
  return readPhone(r.phone) ?? { tail: phone.slice(-4), masked: `${phone.slice(0, 3)}****${phone.slice(-4)}` };
}
