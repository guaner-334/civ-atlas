/**
 * 「联系我们」:交流群的群名、群号、加群链接。
 *
 * 不写在代码里:网站根目录放一份 contact.json,网页第一次要显示「联系我们」时读一次。换群只换这个文件
 * (.github/workflows/contact.yml「更新联系方式」),不用重新构建、发布网站。读不到、格式不对
 * (本地开发、自己部署的网站没放这个文件)就不显示「联系我们」。
 *
 *   { "name": "《文明与地图》项目交流群", "qq": "925687934", "url": "https://qm.qq.com/q/xXrrfGrKso" }
 *
 *   name  群名(可不写,显示「QQ 交流群」)
 *   qq    群号(5–12 位数字)
 *   url   加群链接(https)。二维码按它现画(QQ 给的群二维码扫出来就是这个链接),不用另放图片
 *
 * 文件放在网站根目录、不跟着页面所在的目录走:测试网站(/beta/)、旧版网站和正式网站读同一份。
 */
import { useSyncExternalStore } from 'react';

export interface Contact {
  name: string;
  qq: string;
  url: string;
}

/** 二维码:size × size 个格子,d = 深色格子拼成的 SVG 路径(viewBox 0 0 size size,不含四周留白) */
export interface ContactQr {
  size: number;
  d: string;
}

export interface ContactInfo extends Contact {
  /** 二维码还没画好(画二维码的代码单独一个文件,用到时才下载)或画不出来 = null */
  qr: ContactQr | null;
}

export const CONTACT_FILE = '/contact.json';
const DEFAULT_NAME = 'QQ 交流群';

/** 读到的 contact.json → 群名、群号、链接;缺了群号或链接、格式不对 = null(不显示「联系我们」) */
export function parseContact(raw: unknown): Contact | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const qq = typeof o.qq === 'number' ? String(o.qq) : typeof o.qq === 'string' ? o.qq.trim() : '';
  if (!/^\d{5,12}$/.test(qq)) return null;
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : DEFAULT_NAME;
  return { name, qq, url };
}

/** 二维码的格子(true = 深色)→ SVG 路径;一行里连着的深色格子并成一段,路径短一些 */
export function qrPath(cells: boolean[][]): ContactQr {
  let d = '';
  cells.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let n = 1;
      while (row[x + n]) n++;
      d += `M${x} ${y}h${n}v1h-${n}z`;
      x += n;
    }
  });
  return { size: cells.length, d };
}

/** 按加群链接画二维码(纠错 M 级,QQ 和手机相机都扫得出) */
export async function makeQr(text: string): Promise<ContactQr | null> {
  try {
    const { encode } = await import('./qrcode');
    return qrPath(encode(text, { ecc: 'M', border: 0 }).data);
  } catch {
    return null;
  }
}

let info: ContactInfo | null = null;
let started = false;
const subs = new Set<() => void>();

function set(next: ContactInfo) {
  info = next;
  subs.forEach((f) => f());
}

/** 读 contact.json(只读一次);读到了再画二维码 */
export async function loadContact(): Promise<void> {
  if (started) return;
  started = true;
  let c: Contact | null = null;
  try {
    // no-cache:每次打开网站都问一下服务器换没换(没换只回一句"没变",不重新下载)
    const res = await fetch(CONTACT_FILE, { cache: 'no-cache' });
    if (res.ok) c = parseContact(await res.json());
  } catch {
    /* 没有这个文件、不是 JSON(本地开发时拿到的是首页) */
  }
  if (!c) return;
  set({ ...c, qr: null });
  const qr = await makeQr(c.url);
  if (qr) set({ ...c, qr });
}

function subscribe(f: () => void) {
  subs.add(f);
  void loadContact();
  return () => subs.delete(f);
}

/** 交流群的信息;没配、还没读到 = null */
export function useContact(): ContactInfo | null {
  return useSyncExternalStore(subscribe, () => info);
}
