/**
 * 「预设」(新建弹窗第 2 步最上面、新建页左边「世界参数」第一行;存在 presetStore):
 *
 *   弹出按钮   写着选的那个预设;选了以后又改过任何一项,后面写"(改过)"
 *   菜单       (打开了朋友的预设链接:分享来的那一套排最上面)默认 / 上次用的(右边小字"建「某某」时")/
 *              自己存的(右边小字是和默认不一样的前两样)/ 存成预设… / 复制分享链接… / 管理预设…
 *              (照 Mac 打印窗口的「预置」);手机上大一号,右边只写存了的种子
 *   存成预设   小窗:名字(同名的会替换)、「连种子一起存」、下面列出会存哪些
 *   复制分享链接 小窗(和存成预设一个样子):名字、「连种子一起分享」、链接里有哪几样、链接多长,点「复制链接」;
 *              参数写在链接的 # 后面(presetLink.ts),不经过服务器。朋友打开就是填好参数的新建弹窗(NewWorldDialog.tsx)
 *   管理预设   小窗:改名、删掉(删之前问一句)
 *
 * 菜单和小窗挂在 body 上(不被滚动的面板裁掉),颜色照按钮所在那一块(新建弹窗浅色、新建页深色)。
 * 开着的时候 Esc 只关它们,不关新建弹窗。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorldParams } from '../gen/world';
import { Icon } from './icons';
import { copyText } from './clipboard';
import { notify } from './saveStore';
import { SHARE_WARN_LENGTH } from '../gen/savefile';
import { cleanPresetName, presetHash } from './presetLink';
import {
  choiceName,
  choiceParams,
  choosePreset,
  deletePreset,
  keptGroups,
  presetSummary,
  renamePreset,
  sameAsChoice,
  savePreset,
  sharedNote,
  strip,
  usePresets,
  type PresetChoice,
  type PresetParams,
} from './presetStore';
import './params.css';

/** 选了一个预设:参数(不含种子)、存了的种子、推演年数 */
export interface PresetPick {
  params: PresetParams;
  seed?: number;
  endYear?: number;
}

/** 开着菜单 / 小窗时 Esc 只关它们(先于新建弹窗、新建页自己的 Esc) */
function useEscape(on: boolean, close: () => void) {
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
  onPick,
  phone,
  saveLink,
  disabled,
}: {
  params: WorldParams;
  endYear: number | undefined;
  onPick: (p: PresetPick) => void;
  phone: boolean;
  /** 右边另有「存成预设…」(电脑上的新建弹窗) */
  saveLink?: boolean;
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
            onManage={() => openMini('manage')}
          />,
          document.body,
        )}
      {mini?.kind === 'save' && createPortal(<SavePreset theme={mini.theme} params={params} endYear={endYear} onClose={() => setMini(null)} />, document.body)}
      {mini?.kind === 'share' && createPortal(<SharePreset theme={mini.theme} params={params} endYear={endYear} onClose={() => setMini(null)} />, document.body)}
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
  onManage,
}: {
  at: { x: number; y: number; w: number; theme?: string };
  phone: boolean;
  onClose: () => void;
  onPick: (c: PresetChoice) => void;
  onSave: () => void;
  onShare: () => void;
  onManage: () => void;
}) {
  const st = usePresets();
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
        {st.list.map((p) => item(p.id, p.name, phone ? (p.seed ? `种子 ${p.seed}` : null) : presetSummary(p, 2) || null))}
        <div className="sep" />
        <button role="menuitem" data-act="preset-save" onClick={onSave}>
          <span className="ck" />
          存成预设…
        </button>
        <button role="menuitem" data-act="preset-share" onClick={onShare}>
          <span className="ck" />
          复制分享链接…
        </button>
        <button role="menuitem" data-act="preset-manage" disabled={!st.list.length} onClick={onManage}>
          <span className="ck" />
          管理预设…
        </button>
      </div>
    </>
  );
}

/**
 * 「存成预设」小窗。名字先填好:选的是自己存的那个就是它的名字(存 = 改它),不然"我的预设 N";
 * initial = 打开朋友的预设链接后点「存进我的预设…」:名字、连不连种子照分享来的那一套
 */
export function SavePreset({
  theme,
  params,
  endYear,
  initial,
  onClose,
  onSaved,
}: {
  theme?: string;
  params: WorldParams;
  endYear: number | undefined;
  initial?: { name: string; withSeed: boolean };
  onClose: () => void;
  onSaved?: () => void;
}) {
  const st = usePresets();
  const own = st.list.find((p) => p.id === st.chosen);
  const [name, setName] = useState(() => initial?.name ?? own?.name ?? `我的预设 ${st.list.length + 1}`);
  const [withSeed, setWithSeed] = useState(initial?.withSeed ?? !!own?.seed);
  useEscape(true, onClose);
  const clean = name.trim().slice(0, 24);
  const same = st.list.find((p) => p.name === clean);
  const save = () => {
    if (!clean) return;
    savePreset(clean, params, withSeed, endYear);
    onSaved?.();
    onClose();
  };
  const kept = keptGroups(params);
  return (
    <div className="psd-scrim" data-theme={theme} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="psd" role="dialog" aria-modal="true" aria-labelledby="psd-save-title" data-act="preset-save-dlg" onClick={(e) => e.stopPropagation()}>
        <h3 id="psd-save-title">存成预设</h3>
        <p>以后新建世界，在「预设」里一选就是这一套。只存在这个浏览器里。</p>
        <div className="psd-name">
          <span>名字</span>
          <input
            className="psd-fld"
            aria-label="预设的名字"
            data-act="preset-name"
            value={name}
            maxLength={24}
            autoFocus
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        {same && <div className="psd-warn">已经有叫「{same.name}」的预设，存好会替换它</div>}
        <label className="psd-cbx">
          <input type="checkbox" checked={withSeed} data-act="preset-seed" onChange={(e) => setWithSeed(e.target.checked)} />
          <span>
            连种子一起存
            <small>
              勾上以后，用这个预设新建总是这颗星球（种子 {params.seed}
              ）；不勾，种子照旧随机给。
            </small>
          </span>
        </label>
        <div className="psd-kept">
          会存下：
          {kept.map((g, i) => (
            <span key={g.name}>
              {i > 0 && '，'}
              <b>{g.name}</b>
              {g.detail && `（${g.detail}）`}
            </span>
          ))}
          {withSeed && (
            <span>
              ，<b>种子</b>（{params.seed}）
            </span>
          )}
          。
        </div>
        <div className="psd-btns">
          <button onClick={onClose}>取消</button>
          <button className="b1" data-act="preset-save-ok" disabled={!clean} onClick={save}>
            {same ? '替换' : '存好'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 「复制分享链接」小窗(样子照「存成预设」):名字(先填好选中的预设名,没选就是"我的预设")、「连种子一起分享」(预设里存了种子就先勾上)、
 * 链接里有哪几样、左下角链接多长;点「复制链接」复制好、小窗关掉,顶上提示条说一声。剪贴板用不了:小窗留着,下面一格选中了链接让人自己复制
 */
function SharePreset({ theme, params, endYear, onClose }: { theme?: string; params: WorldParams; endYear: number | undefined; onClose: () => void }) {
  const st = usePresets();
  const picked = st.chosen === 'shared' ? st.shared : st.list.find((p) => p.id === st.chosen);
  const [name, setName] = useState(() => picked?.name ?? '我的预设');
  const [withSeed, setWithSeed] = useState(picked?.seed !== undefined);
  const [manual, setManual] = useState(false);
  useEscape(true, onClose);
  const clean = cleanPresetName(name);
  const url = `${location.origin}${location.pathname}${presetHash({ name: clean, params: strip(params), ...(withSeed ? { seed: params.seed } : {}), ...(endYear ? { endYear } : {}) })}`;
  const copy = async () => {
    if (!clean) return;
    const ok = await copyText(url);
    (window as unknown as { __wfPresetShare?: { url: string; copied: boolean } }).__wfPresetShare = { url, copied: ok };
    if (!ok) return setManual(true);
    onClose();
    const long = url.length > SHARE_WARN_LENGTH;
    notify({ kind: long ? 'warn' : 'ok', text: `已复制预设链接「${clean}」`, more: long ? [`链接较长，可能打不开（${url.length} 字）`] : undefined });
  };
  const kept = keptGroups(params);
  return (
    <div className="psd-scrim" data-theme={theme} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="psd share" role="dialog" aria-modal="true" aria-labelledby="psd-share-title" data-act="preset-share-dlg" onClick={(e) => e.stopPropagation()}>
        <h3 id="psd-share-title">复制分享链接</h3>
        <p>朋友打开这个链接，新建世界的窗口里就照这一套填好参数，也能存进他自己的预设。参数都写在链接里，不经过服务器。</p>
        <div className="psd-name">
          <span>名字</span>
          <input
            className="psd-fld"
            aria-label="预设的名字"
            data-act="preset-share-name"
            value={name}
            maxLength={24}
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setName(e.target.value);
              setManual(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void copy()}
          />
        </div>
        <label className="psd-cbx">
          <input
            type="checkbox"
            checked={withSeed}
            data-act="preset-share-seed"
            onChange={(e) => {
              setWithSeed(e.target.checked);
              setManual(false);
            }}
          />
          <span>
            连种子一起分享
            <small>
              勾上以后，朋友建出来的是同一颗星球（种子 {params.seed}
              ）；不勾，朋友那边种子照旧随机给。
            </small>
          </span>
        </label>
        <div className="psd-kept">
          链接里有：
          {kept.map((g, i) => (
            <span key={g.name}>
              {i > 0 && '，'}
              <b>{g.name}</b>
              {g.detail && `（${g.detail}）`}
            </span>
          ))}
          {withSeed && (
            <span>
              ，<b>种子</b>（{params.seed}）
            </span>
          )}
          。
        </div>
        {manual && (
          <div className="psd-manual" data-testid="preset-share-manual">
            <span>没能自动复制，请手动复制</span>
            <input readOnly value={url} spellCheck={false} aria-label="预设的分享链接" autoFocus onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
        <div className="psd-btns">
          <span className="psd-note" data-testid="preset-share-len">
            链接 {url.length} 字
          </span>
          <span className="psd-sp" />
          <button onClick={onClose}>取消</button>
          <button className="b1" data-act="preset-share-ok" disabled={!clean} onClick={() => void copy()}>
            <Icon name="link" size={16} />
            复制链接
          </button>
        </div>
      </div>
    </div>
  );
}

function ManagePresets({ theme, onClose }: { theme?: string; onClose: () => void }) {
  const st = usePresets();
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
                  <small>{presetSummary(p, 3) || '和默认一样'}</small>
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
