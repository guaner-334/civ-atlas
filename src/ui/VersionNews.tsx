/**
 * 版本号上的「测试版新功能」(内容从哪来见 betaNews.ts;测试网站没有多出来的,版本号和以前一样只是一行灰字)。
 *
 *   VersionText      底部一行小字最右边的版本号(我的世界、世界概览):后面一个小蓝点。鼠标移上去(或用键盘移到它上面)
 *                    上面出一张小卡片,移开收起;触屏点一下出、点外面收起
 *   VersionMenuFoot  「更多」菜单最底下一行(世界里、新建世界):版本号、小蓝点,右边「测试版新功能 ›」。
 *                    鼠标移上去,卡片出在菜单旁边(像子菜单);触屏点一下,整个菜单换成这张卡片。
 *                    有备案号时(beian.ts)下面再一行
 *
 * 小卡片挂在 body 下、按版本号的位置摆;滚动、改窗口大小、按 Esc、版本号所在的画面关掉时收起。样子在 betaNews.css。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { linkText, useBetaNews, type BetaNews } from './betaNews';
import { useCoarse } from './device';
import { Icon } from './icons';
import { usePopMenuPanel } from './PopMenu';
import { APP_VERSION } from './version';
import { BeianLinks } from './BeianLinks';
import './betaNews.css';

/** 离版本号(菜单)多远、离窗口边多远 */
const GAP = 8;
const EDGE = 8;
/** 鼠标离开版本号、小卡片以后过多久收起(从版本号移到卡片上要经过两者之间的空隙) */
const CLOSE_MS = 200;

/** 卡片里的内容(悬停出来的小卡片、手机上换掉菜单的那张都是它) */
function NewsCard({ n }: { n: BetaNews }) {
  return (
    <>
      <div className="news-title">{n.beta ? '比正式版多的功能' : '测试版里的新功能'}</div>
      <div className="news-when">预计 {n.when}（周日）更新到正式版</div>
      <ul className="news-list">
        {n.items.map((it) => (
          <li key={it.pr}>
            <b>{it.title}</b>
            <p>{it.text}</p>
          </li>
        ))}
      </ul>
      {n.more > 0 && <div className="news-more">还有 {n.more} 项</div>}
      <div className="news-foot">
        {n.beta ? '正式网站' : '测试地址'}
        <a href={n.link} target="_blank" rel="noreferrer" data-link="beta-news">
          {linkText(n.link)}
        </a>
      </div>
      <div className="news-hint">{n.beta ? '试出问题，欢迎进交流群说一声' : '测试版的世界和正式版分开存'}</div>
    </>
  );
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** 网页里排在 from 后面、下一个能用 Tab 移到的(skip 里面的不算) */
function nextTabbable(from: HTMLElement, skip: HTMLElement | null): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (el.tabIndex < 0 || from.contains(el) || skip?.contains(el)) continue;
    if (!(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (el.getClientRects().length) return el;
  }
  return null;
}

/**
 * 悬停 / 点开的开关:鼠标(或键盘焦点)移上去打开,离开版本号和卡片一会儿收起;触屏点一下开、再点或点外面收起。
 * 滚动、改窗口大小、按 Esc、版本号看不见了收起
 */
function usePop(anchor: RefObject<HTMLElement>, pop: RefObject<HTMLDivElement>) {
  const coarse = useCoarse();
  const [open, setOpen] = useState(false);
  const timer = useRef(0);

  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_MS);
  };
  /** 焦点离开版本号和小卡片(移到别处)才收起 */
  const blur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && (anchor.current?.contains(to) || pop.current?.contains(to))) return;
    hide();
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    // 卡片自己里面滚(内容太长、窗口太矮时)不算
    const onScroll = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    // 版本号所在的画面被关掉、藏起来了(比如浏览器后退关了世界概览),卡片跟着收起
    const seen = anchor.current && typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => !e.isIntersecting && close()) : null;
    if (seen && anchor.current) seen.observe(anchor.current);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      seen?.disconnect();
    };
  }, [open, anchor, pop]);

  // 键盘:卡片挂在 body 下,Tab 的先后跟着版本号走 —— 在版本号上按 Tab 进卡片里的链接,在卡片里按 Tab 回到版本号
  const toPop = (e: ReactKeyboardEvent) => {
    const link = pop.current?.querySelector('a');
    if (e.key !== 'Tab' || e.shiftKey || !open || !link) return;
    e.preventDefault();
    link.focus();
  };
  const fromPop = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !anchor.current) return;
    // Shift+Tab 回到版本号;Tab 到版本号后面那一个。后面没有别的了就照浏览器的走(出网页),卡片随焦点离开收起
    const to = e.shiftKey ? anchor.current : nextTabbable(anchor.current, pop.current);
    if (!to) return;
    e.preventDefault();
    to.focus();
  };

  // 触屏上没有悬停:点一下开关(点一下也会先给焦点,焦点不算)
  const handlers = coarse
    ? { onClick: () => setOpen((o) => !o) }
    : { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: blur, onClick: show, onKeyDown: toPop };
  const popHandlers = coarse ? {} : { onEnter: show, onLeave: hide, onBlur: blur, onKeyDown: fromPop };
  return { open, coarse, handlers, popHandlers };
}

/**
 * 挂在 body 下的小卡片。above:摆在版本号上面、和它右边对齐(上面放不下就放下面);
 * side:摆在版本号所在的菜单旁边(右边放不下就放左边),上下和版本号那一行对齐中间。都不出窗口
 */
function NewsPop({
  n,
  anchor,
  side,
  popRef,
  onEnter,
  onLeave,
  onBlur,
  onKeyDown,
}: {
  n: BetaNews;
  anchor: HTMLElement;
  side?: boolean;
  popRef: RefObject<HTMLDivElement>;
  onEnter?: () => void;
  onLeave?: () => void;
  onBlur?: (e: FocusEvent) => void;
  onKeyDown?: (e: ReactKeyboardEvent) => void;
}) {
  const [at, setAt] = useState<CSSProperties>({ left: 0, top: 0, visibility: 'hidden' });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = popRef.current?.offsetWidth ?? 0;
    const h = popRef.current?.offsetHeight ?? 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (side) {
      const m = (anchor.closest('.pm-menu') ?? anchor).getBoundingClientRect();
      left = m.right + GAP + w <= vw - EDGE ? m.right + GAP : m.left - GAP - w;
      top = r.top + r.height / 2 - h / 2;
    } else {
      left = r.right - w;
      top = r.top - GAP - h >= EDGE ? r.top - GAP - h : r.bottom + GAP;
    }
    setAt({ left: Math.max(EDGE, Math.min(vw - w - EDGE, left)), top: Math.max(EDGE, Math.min(vh - h - EDGE, top)) });
  }, [anchor, popRef, side, n]);

  return createPortal(
    <div
      ref={popRef}
      className="news-pop"
      style={at}
      role="group"
      aria-label="测试版新功能"
      data-testid="beta-news"
      data-pm-inside
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <NewsCard n={n} />
    </div>,
    document.body,
  );
}

/** 底部一行小字最右边的版本号;className 是那一行原来给版本号的(mw-ver / ov-ver) */
export function VersionText({ className }: { className: string }) {
  const n = useBetaNews();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const { open, handlers, popHandlers } = usePop(btn, pop);
  if (!n)
    return (
      <span className={className} data-version>
        版本 {APP_VERSION}
      </span>
    );
  return (
    <>
      <button ref={btn} className={`${className} ver-news${open ? ' on' : ''}`} data-act="beta-news" aria-expanded={open} {...handlers}>
        <span data-version>版本 {APP_VERSION}</span>
        <i className="ver-dot" aria-hidden />
      </button>
      {open && btn.current && <NewsPop n={n} anchor={btn.current} popRef={pop} {...popHandlers} />}
    </>
  );
}

/** 「更多」菜单最底下:版本号那一行,有备案号时下面再一行(beian.ts;一个号一行) */
export function VersionMenuFoot() {
  return (
    <>
      <VersionMenuRow />
      <BeianLinks className="pm-foot pm-beian" />
    </>
  );
}

function VersionMenuRow() {
  const n = useBetaNews();
  const panel = usePopMenuPanel();
  const row = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const { open, coarse, handlers, popHandlers } = usePop(row, pop);
  if (!n)
    return (
      <div className="pm-foot" data-version>
        版本 {APP_VERSION}
      </div>
    );
  // 触屏:整个菜单换成卡片(菜单收起时换回来)
  const tap = () =>
    panel?.(
      <div className="news-in-menu" data-testid="beta-news">
        <NewsCard n={n} />
      </div>,
    );
  return (
    <>
      <button ref={row} className={`pm-foot pm-news${open ? ' on' : ''}`} data-act="beta-news" aria-expanded={open} {...(coarse && panel ? { onClick: tap } : handlers)}>
        <span data-version>版本 {APP_VERSION}</span>
        <i className="ver-dot" aria-hidden />
        <span className="pm-news-more">
          测试版新功能
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && row.current && <NewsPop n={n} anchor={row.current} side popRef={pop} {...popHandlers} />}
    </>
  );
}
