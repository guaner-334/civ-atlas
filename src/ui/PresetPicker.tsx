/**
 * 「预设」(新建弹窗第 2 步最上面、新建页左边「世界参数」第一行;存在 presetStore):
 *
 *   弹出按钮   写着选的那个预设;选了以后又改过任何一项,后面写"(改过)"
 *   菜单       (打开了朋友的预设链接:分享来的那一套排最上面)默认 / 上次用的(右边小字"建「某某」时")/
 *              自己存的(右边小字是和默认不一样的前两样)/ 存成预设… / 复制分享链接… / 投到作品墙…(登录了、服务器开着投稿才有)/ 管理预设…
 *              (照 Mac 打印窗口的「预置」);手机上大一号,右边只写存了的种子
 *   存成预设   小窗:名字(同名的会替换)、「连种子一起存」、「连规则一起存」、下面列出会存哪些
 *   复制分享链接 小窗(和存成预设一个样子):名字、「连种子一起分享」、「连规则一起分享」、链接里有哪几样、链接多长,点「复制链接」;
 *              参数写在链接的 # 后面(presetLink.ts),不经过服务器。朋友打开就是填好参数的新建弹窗(NewWorldDialog.tsx)
 *              这两个小窗在 PresetDialogs.tsx,点了才下载
 *   管理预设   小窗:改名、删掉(删之前问一句)
 *
 * 菜单和小窗挂在 body 上(不被滚动的面板裁掉),颜色照按钮所在那一块(新建弹窗浅色、新建页深色)。
 * 开着的时候 Esc 只关它们,不关新建弹窗。
 */
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WorldParams } from '../gen/world';
import type { RuleSet } from '../gen/civ/ruleSet';
import { Icon } from './icons';
import { choiceName, choiceParams, choosePreset, deletePreset, presetSummary, renamePreset, sameAsChoice, sharedNote, usePresets, type PresetChoice, type PresetParams } from './presetStore';
import { useMyRulesNames } from './rulesCount';
import type { SavePresetProps, SharePresetProps } from './PresetDialogs';
import { openSubmitDialog } from './AccountDialogs';
import { askPhone, phoneRequired, useSubmitBan, useSubmitOn } from './submitView';
import './params.css';

const SaveDlg = lazy(() => import('./PresetDialogs').then((m) => ({ default: m.SavePresetDialog })));
const ShareDlg = lazy(() => import('./PresetDialogs').then((m) => ({ default: m.SharePresetDialog })));

/** 「存成预设」小窗(下载的那一下什么都不画) */
export function SavePreset(p: SavePresetProps) {
  return (
    <Suspense fallback={null}>
      <SaveDlg {...p} />
    </Suspense>
  );
}

function SharePreset(p: SharePresetProps) {
  return (
    <Suspense fallback={null}>
      <ShareDlg {...p} />
    </Suspense>
  );
}

/** 选了一个预设:参数(不含种子)、存了的种子、推演年数、存了的规则 */
export interface PresetPick {
  params: PresetParams;
  seed?: number;
  endYear?: number;
  rules?: RuleSet;
}

/** 开着菜单 / 小窗时 Esc 只关它们(先于新建弹窗、新建页自己的 Esc) */
export function useEscape(on: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!on) return;
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', f, true);
    return () => window.removeEventListener('keydown', f, true);
  }, [on]);
}

const themeOf = (el: Element | null) => el?.closest('[data-theme]')?.getAttribute('data-theme') ?? undefined;

const updown = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5 6.2L8 3.5l3 2.7M5 9.8L8 12.5l3-2.7" />
  </svg>
);
const tick = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export function PresetPicker({
  params,
  endYear,
  rules,
  onPick,
  phone,
  saveLink,
  after,
  disabled,
}: {
  params: WorldParams;
  endYear: number | undefined;
  /** 现在用的那一套规则(官方 = 不给;存成预设、复制分享链接时先选好它) */
  rules?: RuleSet;
  onPick: (p: PresetPick) => void;
  phone: boolean;
  /** 右边另有「存成预设…」(电脑上的新建弹窗) */
  saveLink?: boolean;
  /** 紧跟在弹出按钮后面的(「存成预设…」前面) */
  after?: ReactNode;
  disabled?: boolean;
}) {
  const st = usePresets();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    w: number;
    theme?: string;
  } | null>(null);
  const [mini, setMini] = useState<{
    kind: 'save' | 'share' | 'manage';
    theme?: string;
  } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEscape(!!menu, () => setMenu(null));
  const changed = !sameAsChoice(st, st.chosen, params, endYear);
  const submitOn = useSubmitOn(!!menu);
  const banned = useSubmitBan();
  const submit = () => {
    setMenu(null);
    const picked = st.chosen === 'shared' ? st.shared : st.list.find((p) => p.id === st.chosen);
    const go = () => openSubmitDialog({ kind: 'preset', name: picked?.name ?? '', params, ...(endYear ? { endYear } : {}), ...(rules ? { rules } : {}) }, banned ? 'ban' : undefined);
    if (!banned && phoneRequired()) askPhone({ for: 'submit', then: go });
    else go();
  };

  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      w: r.width,
      theme: themeOf(btn.current),
    });
  };
  const pick = (c: PresetChoice) => {
    setMenu(null);
    choosePreset(c);
    onPick(choiceParams(st, c));
  };
  const openMini = (kind: 'save' | 'share' | 'manage') => {
    setMenu(null);
    setMini({ kind, theme: themeOf(btn.current) });
  };

  return (
    <>
      <button
        ref={btn}
        className="ps-pop"
        data-act="preset"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        disabled={disabled}
        onClick={() => (menu ? setMenu(null) : open())}
      >
        <span>
          {choiceName(st, st.chosen)}
          {st.chosen === 'shared' && st.shared && <i className="sh">（{sharedNote(st.shared)}）</i>}
          {changed && <i>（改过）</i>}
        </span>
        {updown}
      </button>
      {after}
      {saveLink && (
        <>
          <span className="ps-sp" />
          <button className="ps-lnk" data-act="preset-save" disabled={disabled} onClick={() => openMini('save')}>
            存成预设…
          </button>
        </>
      )}
      {menu &&
        createPortal(
          <PresetMenu
            at={menu}
            phone={phone}
            onClose={() => setMenu(null)}
            onPick={pick}
            onSave={() => openMini('save')}
            onShare={() => openMini('share')}
            onSubmit={submitOn ? { off: !!banned, go: submit } : null}
            onManage={() => openMini('manage')}
          />,
          document.body,
        )}
      {mini?.kind === 'save' && createPortal(<SavePreset theme={mini.theme} params={params} endYear={endYear} rules={rules} onClose={() => setMini(null)} />, document.body)}
      {mini?.kind === 'share' && createPortal(<SharePreset theme={mini.theme} params={params} endYear={endYear} rules={rules} onClose={() => setMini(null)} />, document.body)}
      {mini?.kind === 'manage' && createPortal(<ManagePresets theme={mini.theme} onClose={() => setMini(null)} />, document.body)}
    </>
  );
}

function PresetMenu({
  at,
  phone,
  onClose,
  onPick,
  onSave,
  onShare,
  onSubmit,
  onManage,
}: {
  at: { x: number; y: number; w: number; theme?: string };
  phone: boolean;
  onClose: () => void;
  onPick: (c: PresetChoice) => void;
  onSave: () => void;
  onShare: () => void;
  /** 投到作品墙(没登录、服务器没开投稿 = 不给);off:账号停了投稿,灰着,点了说原因 */
  onSubmit: { off: boolean; go: () => void } | null;
  onManage: () => void;
}) {
  const st = usePresets();
  const names = useMyRulesNames();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  // 放不下就往左、往上挪(手机上和按钮一样宽、贴着它的右边)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(12, Math.min(at.x, innerWidth - w - 12));
    const top = at.y + h > innerHeight - 12 ? Math.max(12, innerHeight - h - 12) : at.y;
    setPos({ left, top });
    el.querySelector<HTMLButtonElement>('button[aria-checked=true]')?.focus();
  }, [at]);
  const item = (c: PresetChoice, name: string, small: string | null, off = false) => (
    <button key={c} role="menuitemradio" aria-checked={st.chosen === c} data-preset={c} disabled={off} onClick={() => onPick(c)}>
      <span className="ck">{st.chosen === c && tick}</span>
      <span className="nm">{name}</span>
      {small && <small>{small}</small>}
    </button>
  );
  return (
    <>
      <div className="ps-menu-scrim" onPointerDown={onClose} />
      <div
        ref={ref}
        className={`ps-menu${phone ? ' phone' : ''}`}
        role="menu"
        data-theme={at.theme}
        style={{ ...pos, ...(phone ? { width: Math.max(at.w, 240) } : {}) }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {st.shared && (
          <>
            {item('shared', st.shared.name, sharedNote(st.shared))}
            <div className="sep" />
          </>
        )}
        {item('default', '默认', null)}
        {item('last', '上次用的', st.last ? (phone ? null : st.last.title ? `建「${st.last.title}」时` : null) : '还没建过', !st.last)}
        {st.list.length > 0 && <div className="sep" />}
        {st.list.map((p) => item(p.id, p.name, phone ? (p.seed ? `种子 ${p.seed}` : null) : presetSummary(p, 2, p.rules?.id && names.get(p.rules.id)) || null))}
        <div className="sep" />
        <button role="menuitem" data-act="preset-save" onClick={onSave}>
          <span className="ck" />
          存成预设…
        </button>
        <button role="menuitem" data-act="preset-share" onClick={onShare}>
          <span className="ck" />
          复制分享链接…
        </button>
        {onSubmit && (
          <button role="menuitem" data-act="preset-submit" className={onSubmit.off ? 'off' : undefined} aria-disabled={onSubmit.off ? true : undefined} onClick={onSubmit.go}>
            <span className="ck" />
            投到作品墙…
          </button>
        )}
        <button role="menuitem" data-act="preset-manage" disabled={!st.list.length} onClick={onManage}>
          <span className="ck" />
          管理预设…
        </button>
      </div>
    </>
  );
}

function ManagePresets({ theme, onClose }: { theme?: string; onClose: () => void }) {
  const st = usePresets();
  const names = useMyRulesNames();
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  useEscape(true, () => (edit ? setEdit(null) : del ? setDel(null) : onClose()));
  const commit = () => {
    if (!edit) return;
    const n = edit.name.trim().slice(0, 24);
    if (n) renamePreset(edit.id, n);
    setEdit(null);
  };
  return (
    <div className="psd-scrim" data-theme={theme} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div
        className="psd wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="psd-manage-title"
        data-act="preset-manage-dlg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="psd-manage-title">管理预设</h3>
        <p>改名、删掉自己存的预设。「默认」和「上次用的」改不了。</p>
        <div className="psd-list">
          {!st.list.length && <div className="psd-empty">还没有自己存的预设。</div>}
          {st.list.map((p) =>
            edit?.id === p.id ? (
              <div key={p.id} className="psd-it">
                <input
                  className="psd-fld"
                  aria-label="新名字"
                  value={edit.name}
                  maxLength={24}
                  autoFocus
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setEdit({ id: p.id, name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && commit()}
                  onBlur={commit}
                />
              </div>
            ) : del === p.id ? (
              <div key={p.id} className="psd-it">
                <span className="psd-it-tx">
                  <b>删掉「{p.name}」？</b>
                  <small>删了就找不回来了</small>
                </span>
                <button className="psd-a" onClick={() => setDel(null)}>
                  取消
                </button>
                <button
                  className="psd-a red"
                  data-act="preset-del-ok"
                  onClick={() => {
                    deletePreset(p.id);
                    setDel(null);
                  }}
                >
                  删掉
                </button>
              </div>
            ) : (
              <div key={p.id} className="psd-it" data-preset={p.id}>
                <span className="psd-it-tx">
                  <b>{p.name}</b>
                  <small>{presetSummary(p, 3, p.rules?.id && names.get(p.rules.id)) || '和默认一样'}</small>
                </span>
                <button className="psd-a" data-act="preset-rename" onClick={() => setEdit({ id: p.id, name: p.name })}>
                  改名
                </button>
                <button className="psd-a del" data-act="preset-del" aria-label={`删掉「${p.name}」`} onClick={() => setDel(p.id)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ),
          )}
        </div>
        <div className="psd-btns">
          <button className="b1" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
