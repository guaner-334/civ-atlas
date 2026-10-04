/**
 * 点按钮弹出的小菜单(侧栏顶上的"更多"、面板里的"更多"):按钮 + 一列菜单项。
 * 点菜单项、点外面、按 Esc 收起。样式在 sidebar.css(.pm-*)。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function PopMenu({
  label,
  icon,
  className,
  title,
  act,
  align = 'left',
  disabled,
  children,
}: {
  label?: ReactNode;
  icon?: ReactNode;
  /** 加在外层上(决定按钮长什么样:sb-pill / cp-tile……) */
  className?: string;
  title?: string;
  /** 按钮的 data-act */
  act?: string;
  /** 菜单和按钮左对齐还是右对齐 */
  align?: 'left' | 'right';
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className={`pm${className ? ` ${className}` : ''}${open ? ' open' : ''}`} ref={root}>
      <button
        className={`pm-btn${open ? ' on' : ''}`}
        data-act={act}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {label}
      </button>
      {open && (
        <div
          className={`pm-menu pm-${align}`}
          role="menu"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.pm-item:not(:disabled)')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** 菜单里的一项:按钮,或者给了 href 就是新标签页打开的链接 */
export function MenuItem({
  icon,
  note,
  href,
  act,
  ain,
  disabled,
  onClick,
  children,
}: {
  icon?: ReactNode;
  /** 右边的灰色小字("需设置") */
  note?: ReactNode;
  href?: string;
  act?: string;
  /** 名字由来 / AI 起名(data-ain) */
  ain?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const body = (
    <>
      {icon}
      <span className="pm-text">{children}</span>
      {note && <small className="pm-note">{note}</small>}
    </>
  );
  if (href)
    return (
      <a className="pm-item" role="menuitem" href={href} target="_blank" rel="noreferrer" data-link={act}>
        {body}
      </a>
    );
  return (
    <button className="pm-item" role="menuitem" data-act={act} data-ain={ain} disabled={disabled} onClick={onClick}>
      {body}
    </button>
  );
}

export function MenuSep() {
  return <hr className="pm-sep" />;
}
