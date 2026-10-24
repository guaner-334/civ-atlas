/**
 * 网站公告(内容从哪来见 announcement.ts):打开网页就在屏幕中间弹出,样子照系统的提醒框(标题、日期、正文、整宽按钮)。
 * 「知道了」先灰着倒数 3 秒,这期间关不掉(点旁边、按 Esc 都不关);倒数完点「知道了」或按 Esc 关掉。
 * 带链接的多一个「查看详情」,新标签页打开,公告不关。字多时正文里面上下滑,按钮一直在底下。
 *
 *   AnnouncementHost  挂在 Boot 里;ready = 页面已经出来了(加载画面收起以后才弹、才开始倒数)
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { closeNotice, useNotice, type Notice } from './announcement';
import './announcement.css';

/** 弹出后多少秒才能关 */
export const NOTICE_WAIT = 3;

export function AnnouncementHost({ ready }: { ready: boolean }) {
  const notice = useNotice();
  return ready && notice ? <NoticeDialog notice={notice} /> : null;
}

function NoticeDialog({ notice }: { notice: Notice }) {
  const [left, setLeft] = useState(NOTICE_WAIT);
  const cardRef = useRef<HTMLElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  // 弹出时焦点先放到公告上(下面页面里按着焦点的按钮不会被回车、空格点到)
  useEffect(() => {
    cardRef.current?.focus();
  }, []);
  useEffect(() => {
    if (left <= 0) {
      okRef.current?.focus();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  // 开着的时候按键不传给下面的页面(空格不会播放、方向键不会挪地图);Tab 只在公告里的按钮之间转;倒数完 Esc 关掉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      const card = cardRef.current;
      if (e.key === 'Tab' && card) {
        e.preventDefault();
        const els = [...card.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
        const i = els.indexOf(document.activeElement as HTMLElement);
        const n = els.length;
        const j = i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n;
        (n ? els[j] : card).focus();
        return;
      }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (left <= 0) closeNotice();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [left]);
  const wait = left > 0;
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return createPortal(
    <div className="nt-bg" onPointerDown={stop} onWheel={stop} onContextMenu={stop}>
      <section ref={cardRef} tabIndex={-1} className="nt-card" role="alertdialog" aria-modal="true" aria-labelledby="nt-title" data-testid="notice">
        <div className="nt-body">
          <h2 id="nt-title">{notice.title}</h2>
          {notice.date && <p className="nt-date">{notice.date}</p>}
          {notice.paras.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div className="nt-btns">
          {notice.link && (
            <a className="nt-btn" href={notice.link} target="_blank" rel="noopener noreferrer">
              查看详情
            </a>
          )}
          <button ref={okRef} className={wait ? 'nt-btn wait' : 'nt-btn blue'} disabled={wait} onClick={closeNotice} data-act="notice-ok">
            {wait ? `知道了（${left}）` : '知道了'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
