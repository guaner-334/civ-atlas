/**
 * 人物头像(gen/portrait.ts 挑好的一叠部件图,在这里叠起来):
 *   card  人物卡片、作者人物卡片顶上,名字左边的方头像(电脑 96、手机 80 像素),底色是淡淡的国家颜色;
 *         会眨眼、轻轻呼吸,按时间轴那一年的事换表情,打开时点一下头(打了败仗低头);
 *         去世以后不动,颜色变旧、加一圈白框,像一幅画像(遇弑、亡国、战死的再暗一点)
 *   mini  世系图格子里 30 像素的圆头像;row 人物页名字前 26 像素的圆头像。都只显示脸、不动
 * 系统设了"减少动态效果"的只显示不动的头像(portrait.css)。部件是同样大小的透明图,左上角对齐叠放;
 * 头发、胡须的白用滤镜(grayscale + brightness + contrast)。
 * 还没有画像部件的人(女性的头像部件以后补上)用 NameFace:同样大小的颜色方块 / 小圆,上面写名字(卡片写后两个字,小圆头像写最后一个字)。
 */
import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { Civ, Person } from '../gen/civ/types';
import { personPortrait, portraitLayers, type Portrait, type PortraitMood } from '../gen/portrait';
import { isFemale } from '../gen/civ/gender';
import './portrait.css';

const BASE = `${import.meta.env.BASE_URL}portraits/`;

/** 头发、胡须变白的滤镜(w = 0–1) */
function whiten(w: number): string | undefined {
  if (w <= 0) return undefined;
  return `grayscale(${w}) brightness(${(1 + 0.75 * w).toFixed(3)}) contrast(${(1 - 0.3 * w).toFixed(3)})`;
}

/** 一串字 → 0–1 的数(眨眼的间隔每人不一样,但同一个人每次一样) */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export interface PortraitViewProps {
  p: Portrait;
  size: 'card' | 'mini' | 'row';
  /** 底色(国家颜色、作者人物的颜色) */
  color: string;
  /** 去世以后:画像的样子;dark = 死于非命,再暗一点 */
  dead?: boolean;
  dark?: boolean;
  /** 卡片上那一年的神情(mini、row 不用) */
  mood?: PortraitMood;
  /** 右下角的小按钮(作者人物的"换一张") */
  corner?: ReactNode;
  /** card 大小但不眨眼、不动(关系图中间那张卡片) */
  still?: boolean;
}

export function PortraitView({ p, size, color, dead, dark, mood, corner, still }: PortraitViewProps) {
  const card = size === 'card';
  const live = card && !dead && !still;
  const expr = live ? (mood?.expr ?? 'calm') : 'calm';
  const layers = useMemo(() => portraitLayers(p, expr, live), [p, expr, live]);
  const filter = whiten(p.white);
  const id = p.layers.map((l) => l.src).join('|');
  // 卡片上的头像先把各种表情的图要来,换表情时不闪
  useEffect(() => {
    if (!live) return;
    for (const set of Object.values(p.exprs)) for (const l of set ?? []) new Image().src = BASE + l.src;
  }, [live, p]);
  const blinkStyle = { '--blink': `${(3 + hash01(id) * 3).toFixed(2)}s`, '--blink-at': `${(-hash01(`${id}#`) * 4).toFixed(2)}s` } as CSSProperties;
  const act = live ? mood?.act : undefined;
  return (
    <span
      className={`pt pt-${size}${dead ? ' pt-dead' : ''}${dead && dark ? ' pt-dark' : ''}${live ? ' pt-live' : ''}`}
      style={{ '--c': color } as CSSProperties}
    >
      {/* 点头 / 低头换了:key 变了,动作再做一次。图只是装饰,读屏跳过;角上的按钮不藏 */}
      <span key={act ?? ''} className={`pt-move${act ? ` pt-${act}` : ''}`} aria-hidden="true">
        <span className="pt-in">
          {layers.map((l) => (
            <img
              key={`${l.blink ? 'b' : ''}${l.src}`}
              className={l.blink ? 'pt-blink' : undefined}
              src={BASE + l.src}
              alt=""
              draggable={false}
              decoding="async"
              loading={card ? undefined : 'lazy'}
              style={l.blink ? blinkStyle : l.white && filter ? { filter } : undefined}
            />
          ))}
        </span>
      </span>
      {corner}
    </span>
  );
}

/**
 * 世系图、人物页里推演人物的小头像:时间轴那一年的岁数,但不早于上台那年(还没即位、还没出生的按上台那年),
 * 不晚于去世那年。时间轴在他一生以外拖动时,年龄不变、不重算。女的(头像部件还没有)写名字的最后一个字(NameFace)
 */
export function PersonFace({ civ, x, year, size }: { civ: Civ; x: Person; year: number; size: 'mini' | 'row' }) {
  const from = x.from ?? x.commands?.[0]?.from ?? x.born + 20;
  const age = Math.floor(Math.min(Math.max(year, from), x.died ?? Infinity) - x.born);
  const p = useMemo(() => (isFemale(x) ? null : personPortrait(civ, x.id, x.born + age)), [civ, x, age]);
  const pol = civ.polities[x.polity];
  if (!pol) return null;
  if (isFemale(x)) return <NameFace name={x.name} size={size} color={`rgb(${pol.color.join(',')})`} />;
  if (!p) return null;
  return <PortraitView p={p} size={size} color={`rgb(${pol.color.join(',')})`} />;
}

/**
 * 头像上写的字:卡片写名字的后两个字(只有一个字就一个),小圆头像(small)写最后一个字;空白、间隔号不算。
 * 名字里没有汉字(拉丁字母之类)的写第一个字母(大写)
 */
export function nameFaceText(name: string, small: boolean): string {
  const cs = [...name.replace(/[\s·・•.]/g, '')];
  if (!cs.length) return '';
  if (!cs.some((ch) => /\p{Script=Han}/u.test(ch))) return cs[0].toUpperCase();
  return cs.slice(small ? -1 : -2).join('');
}

/**
 * 没有画像的头像:颜色方块(卡片)/ 小圆(世系图、人物页)上写名字,大小、圆角、去世后的白框和 PortraitView 一样;
 * color = 底色(国家颜色、作者人物的颜色)
 */
export function NameFace({ name, size, color, dead }: { name: string; size: 'card' | 'mini' | 'row'; color: string; dead?: boolean }) {
  const text = nameFaceText(name, size !== 'card');
  return (
    <span className={`pt pt-${size} pt-name${[...text].length > 1 ? '' : ' pt-name-1'}${dead ? ' pt-dead' : ''}`} style={{ '--c': color } as CSSProperties} aria-hidden="true">
      {text}
    </span>
  );
}
