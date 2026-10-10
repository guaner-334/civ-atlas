/**
 * 「联系我们」:交流群的入口(群名、群号、加群链接从网站根目录的 contact.json 读,见 contact.ts;没配就哪里都不出现)。
 *
 *   ContactLink      底部一行小字里(我的世界、世界概览):鼠标移上去(或用键盘移到它上面),上面出一张小卡片 ——
 *                    二维码、群名、群号和「复制」;点它本身,新标签页打开加群链接。触屏不出卡片,点一下直接打开
 *   ContactMenuItem  「更多」菜单里(世界里、新建世界):右边灰字「QQ 群」,点了打开加群链接
 *
 * 小卡片挂在 body 下、按链接的位置摆(概览面板会把超出的部分裁掉);滚动、改窗口大小时收起。样子在 contact.css。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useContact, type ContactInfo } from './contact';
import { copyText } from './clipboard';
import { useCoarse } from './device';
import { Icon } from './icons';
import { MenuItem } from './PopMenu';
import './contact.css';

/** 小卡片的宽(和 contact.css 一致)、离链接多远、离窗口边多远 */
const POP_W = 212;
const GAP = 8;
const EDGE = 8;
/** 鼠标离开链接、小卡片以后过多久收起(从链接移到卡片上要经过两者之间的空隙) */
const CLOSE_MS = 200;
/** 「已复制」显示多久 */
const COPIED_MS = 2000;

export function ContactLink() {
  const c = useContact();
  const coarse = useCoarse();
  const [open, setOpen] = useState(false);
  const link = useRef<HTMLAnchorElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef(0);

  const show = () => {
    window.clearTimeout(timer.current);
    if (!coarse) setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_MS);
  };
  /** 焦点离开链接和小卡片(移到别处)才收起 */
  const blur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && (link.current?.contains(to) || pop.current?.contains(to))) return;
    hide();
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!c) return null;
  return (
    <>
      <a
        ref={link}
        className={`contact-link${open ? ' on' : ''}`}
        href={c.url}
        target="_blank"
        rel="noreferrer"
        data-link="contact"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={blur}
      >
        联系我们
      </a>
      {open && link.current && (
        <ContactPop c={c} anchor={link.current} popRef={pop} onEnter={show} onLeave={hide} onBlur={blur} />
      )}
    </>
  );
}

function ContactPop({
  c,
  anchor,
  popRef,
  onEnter,
  onLeave,
  onBlur,
}: {
  c: ContactInfo;
  anchor: HTMLElement;
  popRef: RefObject<HTMLDivElement>;
  onEnter: () => void;
  onLeave: () => void;
  onBlur: (e: FocusEvent) => void;
}) {
  const [at, setAt] = useState<CSSProperties>({ left: 0, top: 0, visibility: 'hidden' });
  const [copied, setCopied] = useState(false);
  const num = useRef<HTMLElement>(null);
  const timer = useRef(0);

  // 摆在链接正上方、左右居中;上面放不下就放下面;不出窗口
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = popRef.current?.offsetHeight ?? 0;
    const left = Math.max(EDGE, Math.min(window.innerWidth - POP_W - EDGE, r.left + r.width / 2 - POP_W / 2));
    const top = r.top - GAP - h >= EDGE ? r.top - GAP - h : r.bottom + GAP;
    setAt({ left, top });
  }, [anchor, popRef, c.qr]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    if (await copyText(c.qq)) {
      setCopied(true);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } else if (num.current) {
      // 复制不了(浏览器不让):把群号选上,按 ⌘C / Ctrl+C 自己复制
      window.getSelection()?.selectAllChildren(num.current);
    }
  };

  return createPortal(
    <div ref={popRef} className="contact-pop" style={at} role="group" aria-label={c.name} data-testid="contact-pop" onMouseEnter={onEnter} onMouseLeave={onLeave} onBlur={onBlur}>
      <div className="contact-qr">
        {c.qr ? (
          <svg viewBox={`0 0 ${c.qr.size} ${c.qr.size}`} shapeRendering="crispEdges" role="img" aria-label="加群二维码">
            <path d={c.qr.d} />
          </svg>
        ) : (
          <div className="contact-qr-wait" />
        )}
      </div>
      <div className="contact-name">{c.name}</div>
      <div className="contact-row">
        群号
        <b ref={num} data-contact-qq>
          {c.qq}
        </b>
        <button className={`contact-copy${copied ? ' done' : ''}`} data-act="contact-copy" onClick={() => void copy()}>
          {copied ? (
            <>
              <Icon name="check" size={13} />
              已复制
            </>
          ) : (
            '复制'
          )}
        </button>
      </div>
      <div className="contact-hint">用手机 QQ 扫一扫加群</div>
    </div>,
    document.body,
  );
}

/** 「更多」菜单里的一项:点了新标签页打开加群链接;没配交流群就没有这一项 */
export function ContactMenuItem() {
  const c = useContact();
  if (!c) return null;
  return (
    <MenuItem href={c.url} act="contact" note="QQ 群">
      联系我们
    </MenuItem>
  );
}
