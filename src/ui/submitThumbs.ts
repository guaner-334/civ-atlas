/** 投稿的小图:服务器不给投稿的封面,只能投的时候在这台设备上记下(按账号分开) */
import { getSession } from '../account/session';
import { coverUrl } from '../account/gallery';
import { serverBase } from '../account/server';
import type { Submission } from '../account/submissions';
import type { SubmitWork } from './submitView';

const KEY = 'civ-atlas:submit-thumbs';
/** 最多记几件(我的投稿最多列 20 件) */
const KEEP = 30;
const WIDE_W = 112;
const WIDE_H = 56;
const ICON = 60;

type Saved = Record<string, string>;

function read(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return v && typeof v === 'object' ? (v as Saved) : {};
  } catch {
    return {};
  }
}
const userKey = () => {
  const s = getSession();
  return s ? String(s.user.id || s.user.account) : '';
};

/** 缩成 112×56(照 2:1 裁中间),插件图标缩成 60×60;读不出图 = null */
function shrink(src: string, square: boolean): Promise<string | null> {
  const W = square ? ICON : WIDE_W;
  const H = square ? ICON : WIDE_H;
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const x = c.getContext('2d');
      if (!x || !img.naturalWidth || !img.naturalHeight) return done(null);
      const r = img.naturalWidth / img.naturalHeight;
      const sw = r > W / H ? img.naturalHeight * (W / H) : img.naturalWidth;
      const sh = r > W / H ? img.naturalHeight : img.naturalWidth / (W / H);
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
      done(square ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => done(null);
    img.src = src;
  });
}

/** 投好了:记下这一件的小图(square = 插件图标) */
export async function keepSubmitThumb(id: number, src: string | null, square = false): Promise<void> {
  if (!src) return;
  const user = userKey();
  const small = await shrink(src, square);
  if (!small || !user) return;
  const all = { ...read() };
  const k = `${user}:${id}`;
  delete all[k];
  all[k] = small;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[old];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 记不下只是那一行没有小图 */
  }
}

/** 「我的投稿」那一行的小图:上了墙的用作品墙的封面,别的用这台设备上记下的;插件用图标,这台设备上记下的优先;都没有 = null */
export function submitThumb(s: Pick<Submission, 'id' | 'status' | 'workId' | 'kind'>): string | null {
  if (s.kind === 'plugin') {
    const base = serverBase();
    return read()[`${userKey()}:${s.id}`] ?? (s.workId && base ? `${base}/v1/gallery/${encodeURIComponent(s.workId)}/icon` : null);
  }
  if (s.status === 'live' && s.workId) {
    const u = coverUrl(s.workId);
    if (u) return u;
  }
  return read()[`${userKey()}:${s.id}`] ?? null;
}

const drawn = new Map<string, Promise<string | null>>();

/** 投稿窗里新建参数、规则的小图(现画;同一件只画一次);别的种类 = null */
export function drawWorkThumb(w: SubmitWork): Promise<string | null> {
  if (w.kind !== 'preset' && w.kind !== 'rules') return Promise.resolve(null);
  // 按画出来的东西记:同一套规则改过以后要重画
  const k = JSON.stringify(w.kind === 'preset' ? ['p', w.params] : ['r', w.rules.values, w.rules.biomes ?? null]);
  let p = drawn.get(k);
  if (!p) {
    p = import('./galleryHelper')
      .then((m) => m.smallCover(w.kind === 'preset' ? { kind: 'preset', params: w.params } : { kind: 'rules', rules: w.rules }, 192, 96))
      .catch(() => null)
      .then((t) => {
        if (!t) drawn.delete(k);
        return t;
      });
    drawn.set(k, p);
  }
  return p;
}
