/**
 * 世界卡片头部的"存档"菜单:只管正在看的这一个世界(打开别的世界、从文件打开在"我的世界"那一页,见 MyWorlds.tsx) ——
 *
 *   当前世界:缩略图、名字、种子、地形改过几处、"已自动存在这个浏览器里"(打开的链接还没动过 = 还没存)
 *   存成文件:整个世界存成 .civworld(worldFileFlow.ts;小字写多大,要打包才知道的不写);没有内容可存的存 .json
 *   复制配方链接:整份存档压缩进网址的 # 后面(gen/savefile.ts 的 encodeShare),复制到剪贴板;
 *     没有修改 = 普通网址(只带种子、参数);剪贴板用不了:菜单留着,里面多一行选中了链接的输入框,让用户自己复制。
 *     下面一行勾选「停在这一刻」(shareMoment.tsx):勾着就带上时间轴那一年、选中的国家或州、地图的位置和大小,
 *     对方打开停在那里(不自动播放);默认勾着,记住上次的选择
 *   从文件打开进来的:当前世界那一行多一句「来自文件」和哪天打开的(只在这台设备上记)
 *   登录了网站账号:当前世界那一行写同步到账号了没有;"复制配方链接"换成"分享…"(短链接,随时能停,AccountDialogs.tsx 的分享窗)
 *   看原样:旧版本建的世界(留着原来那一份,saveStore 的 currentOriginal)到那一版的旧网站里打开,新页面(oldSite.ts)
 *   按新版另存一份:照原样打开的旧世界(没有重新生成,FrozenWorld.tsx)另存一份按新版推演;这时不放「看原样」(看到的就是原样)。
 *                   存的内容读不出、先按新版算了一遍的世界也放:那一份不自动存,要留着看到的样子只能另存(「看原样」照放)
 *
 * 存、读、列都在 saveStore.ts。存储满了之类的提示(saveStore 的 notify)显示在顶部的提示条上。
 * ⌘S 打开这个菜单(openSaveMenu;世界本来就自动存着,菜单上写着存没存好)。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SHARE_WARN_LENGTH } from '../gen/savefile';
import { useEdits } from './editsStore';
import { currentOriginal, currentWorld, loadWorld, persistent, storageFullWhy, storageIsFull, useSavesVersion } from './saveStore';
import { withFileFlow } from './worldFileLazy';
import { oldSiteFor, openOriginal } from './oldSite';
import { openFailed } from './openTrouble';
import { Icon } from './icons';
import { noteDismiss } from './dismissClick';
import { openShareDialog } from './AccountDialogs';
import { when } from './worldParts';
import { useSession } from '../account/session';
import { useSyncView, worldSync } from '../account/sync';
import { saveAsNew } from './FrozenWorld';
import { LONG_HINT, MomentCheck, copyShareLink, momentNow, shareCopiedToast, useMomentOn } from './shareMoment';

export interface SaveMenuProps {
  /** 世界生成完了(能存) */
  ready: boolean;
  /** 按钮上文字前面的小图标 */
  icon?: ReactNode;
}

/** 当前世界存成文件(菜单里的"存成文件"、存储满了时提示条上的"存成文件") */
function saveCurrentFile() {
  withFileFlow('没能存成文件', (m) => m.saveCurrentToFile());
}

/** 菜单上写的:来自文件，11 月 4 日打开(不是今年的带上年) */
function fromFileLine(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()} 年 `;
  return `来自文件，${year}${d.getMonth() + 1} 月 ${d.getDate()} 日打开`;
}

/** 剪贴板用不了:菜单里一行"没能自动复制",下面是选中了链接的输入框(不另开窗口) */
function ManualCopy({ url }: { url: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [url]);
  return (
    <div className="save-manual" data-testid="share-manual">
      <span>{url.length > SHARE_WARN_LENGTH ? `没能自动复制，请手动复制。${LONG_HINT}` : '没能自动复制，请手动复制'}</span>
      <input ref={ref} readOnly value={url} spellCheck={false} aria-label="配方链接" onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

function Thumb({ src }: { src: string | null }) {
  return src ? <img className="save-thumb" src={src} alt="" draggable={false} /> : <div className="save-thumb empty" />;
}

/** 页面上的存档菜单(宽屏侧栏顶上一个;手机在世界卡片里):⌘S 打开看得见的那一个 */
const openers = new Set<{ root: () => HTMLElement | null; open: () => void }>();

/** ⌘S:打开看得见的那个存档菜单(已经开着就留着);没有看得见的 = false */
export function openSaveMenu(): boolean {
  for (const o of openers) {
    const el = o.root();
    if (!el || !el.getClientRects().length || el.closest('[inert]')) continue;
    o.open();
    return true;
  }
  return false;
}

export function SaveMenu({ ready, icon }: SaveMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = { root: () => rootRef.current, open: () => setOpen(true) };
    openers.add(o);
    return () => {
      openers.delete(o);
    };
  }, []);
  const v = useSavesVersion();
  const edits = useEdits();
  const cur = ready ? currentWorld() : null;
  const curStored = useMemo(() => (open && cur ? loadWorld(cur.id) : null), [open, cur, v]);
  const keep = persistent();
  const full = storageIsFull();
  const session = useSession();
  const syncView = useSyncView();
  const synced = useMemo(() => (open && session && cur && curStored ? worldSync(cur.id) : null), [open, session, cur, curStored, syncView]);
  // 存成文件有多大:菜单开着才算;存储满了时写不准(页面里的比存着的新),不写
  const [size, setSize] = useState<{ id: string; note: string } | null>(null);
  const curId = cur?.id;
  const hasFile = !!curStored && !curStored.draft && !curStored.map && !full;
  useEffect(() => {
    if (!open || !curId || !hasFile) return;
    let live = true;
    import('./worldFileFlow')
      .then((m) => m.fileSizeNote(curId))
      .then((note) => {
        if (live && note) setSize({ id: curId, note });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, curId, hasFile]);
  const sizeNote = size && hasFile && size.id === curId ? `，${size.note}` : '';

  // 点菜单外面就收起(在捕获阶段听:地图上的按钮条拦了冒泡,点旁边的按钮照样收起)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      noteDismiss(e);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const saveFile = () => {
    setOpen(false);
    saveCurrentFile();
  };

  // 「停在这一刻」:勾着就带上时间轴那一年、选中的国家或州、地图的位置和大小(默认勾着,记住上次的选择)
  const [momentOn, setMomentOn] = useMomentOn();
  const at = open && ready ? momentNow() : null;
  // 复制配方链接:网址(种子 + 参数 + 画风……)+ #share=整份存档(带上这一刻);没有修改、也不带这一刻就是普通网址。
  // 剪贴板用不了:菜单留着,里面多一行选中了链接的输入框(不另开窗口)
  const [manual, setManual] = useState<string | null>(null);
  const shareLink = async () => {
    const m = momentOn ? momentNow() : null;
    const r = await copyShareLink(m?.moment ?? null);
    if (!r) return setOpen(false);
    if (!r.copied) return setManual(r.url);
    setOpen(false);
    shareCopiedToast(r, m);
  };
  useEffect(() => {
    if (!open) setManual(null);
  }, [open]);

  const title = cur?.title;
  const nTerrain = edits.terrain.length;
  // 存没存住:浏览器不让存 / 存不下 / 已经在"我的世界"里 / 打开的链接还没动过
  const status: { cls: string; text: string; icon?: 'cloudok' | 'cloudup' | 'cloudoff' } = !keep
    ? { cls: 'warn', text: '浏览器不让网页存数据，关掉前请存成文件' }
    : full
      ? { cls: 'warn', text: `${storageFullWhy()}，没能自动存` }
      : curStored && synced
        ? synced.state === 'synced'
          ? { cls: 'ok', icon: 'cloudok', text: `已同步到你的账号${synced.at ? `，${when(synced.at)}` : ''}` }
          : synced.state === 'busy'
            ? { cls: 'ok', icon: 'cloudup', text: '正在同步到你的账号' }
            : { cls: 'warn', icon: 'cloudoff', text: '还没同步上，联网后会自动同步' }
        : curStored
          ? { cls: 'ok', text: '已自动存在这个浏览器里' }
          : { cls: '', text: '还没存进我的世界；改了名字或历史就会自动存' };
  // 旧版本建的世界:能到那一版的旧网站里看原样(菜单开着才找)
  const frozen = cur?.frozen !== undefined;
  const orig = open && cur && !frozen ? currentOriginal() : null;
  const site = orig ? oldSiteFor(orig.generator) : null;
  const seeOriginal = () => {
    if (!orig || !site) return;
    setOpen(false);
    void openOriginal(orig).then((ok) => ok || openFailed(site.href, orig));
  };
  const share = () => {
    if (!cur) return;
    setOpen(false);
    openShareDialog(cur.id, title ?? '');
  };
  return (
    <div className="save" ref={rootRef}>
      <button className={`save-btn${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} data-tip="存档" data-tip-key="save">
        {icon}
        存档
      </button>
      {open && (
        <div className="save-menu" role="menu">
          {cur ? (
            <div className="save-cur">
              <Thumb src={curStored?.thumb ?? null} />
              <div className="save-info">
                <b className="save-cur-name">{title || '未命名世界'}</b>
                <small>
                  种子 {cur.params.seed}
                  {nTerrain ? `，地形改过 ${nTerrain} 处` : ''}
                </small>
                <small className={`save-status ${status.cls}`} data-testid="save-status">
                  {status.icon && <Icon name={status.icon} size={14} />}
                  {status.text}
                </small>
                {curStored?.fromFile && <small data-testid="save-from-file">{fromFileLine(curStored.fromFile)}</small>}
              </div>
            </div>
          ) : (
            <div className="save-empty">正在生成世界</div>
          )}
          <button className="save-it" data-act="save-file" disabled={!cur} onClick={saveFile}>
            <Icon name="save" size={17} />
            <span>
              <b>存成文件</b>
              <small>{`存下整个世界${sizeNote}。换台设备、发给别人，看到的都一模一样`}</small>
            </span>
          </button>
          {session ? (
            <button className="save-it" data-act="share" disabled={!cur} onClick={share}>
              <Icon name="link" size={17} />
              <span>
                <b>分享…</b>
                <small>生成一个链接，别人打开就能看；随时能停止</small>
              </span>
            </button>
          ) : (
            <>
              <button className="save-it" data-act="share-link" disabled={!cur} onClick={shareLink}>
                <Icon name="link" size={17} />
                <span>
                  <b>复制配方链接</b>
                  <small>对方打开时重新长一遍，可能和你看到的不一样</small>
                </span>
              </button>
              {at && <MomentCheck at={at} on={momentOn} onChange={setMomentOn} />}
            </>
          )}
          {(frozen || cur?.readonly || cur?.oldRecipe) && (
            <button
              className="save-it"
              data-act="save-new"
              onClick={() => {
                setOpen(false);
                saveAsNew();
              }}
            >
              <Icon name="copy" size={17} />
              <span>
                <b>按新版另存一份</b>
                <small>这一份照原样留着，另存的用新版重新推演</small>
              </span>
            </button>
          )}
          {site && (
            <button className="save-it" data-act="see-original" onClick={seeOriginal}>
              <Icon name="history" size={17} />
              <span>
                <b>看原样</b>
                <small>这个世界是旧版建的，在新页面里用当时的版本打开</small>
              </span>
            </button>
          )}
          {manual !== null && <ManualCopy url={manual} />}
        </div>
      )}
    </div>
  );
}
