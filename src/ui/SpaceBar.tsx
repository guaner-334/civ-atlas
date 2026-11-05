/** 跟首页一起下载,所以世界仓库的代码过一会儿才下载,窗口(SpaceDialog.tsx)点开才下载。 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Icon } from './icons';
import { MAX_WORLDS, currentUnsaved, currentWorld, storageFullByQuota, storedCount, useSavesVersion, type StoredWorld } from './saveStore';
import { sizeText } from './sizeWords';
import {
  appleDevice,
  askPersisted,
  askRoom,
  closeLose,
  closeNear,
  fileRecords,
  fileStatus,
  inSmallWindow,
  isNearFull,
  loseBar,
  loseOffAt,
  nearBar,
  nearOffAt,
  nearOver,
  onSpaceChange,
  pickBar,
  saveMark,
  spaceChanged,
  vaultFullSeen,
  type RoomFacts,
  type SpaceBarState,
} from './spaceFacts';
import { clearToast, showToast } from './toastStore';
import type { SpaceBarProps } from './SpaceBarView';

const VAULT_LOOK_DELAY = 1200;

/** 满了、到上限关掉只算这次打开,下次打开还说 */
const offNow = { full: false, count: false };

export interface SpaceView {
  /** null = 还不知道 */
  used: number | null;
  bar: SpaceBarState | null;
  closeBar: () => void;
}

export function useSpace(list: readonly StoredWorld[], loggedIn: boolean, keep: boolean): SpaceView {
  const v = useSavesVersion();
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onSpaceChange(bump), []);
  const [room, setRoom] = useState<RoomFacts | null>(null);
  const [own, setOwn] = useState<number | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [fullIds, setFullIds] = useState<readonly string[]>([]);
  const looked = useRef(false);
  const on = keep && list.length > 0;
  useEffect(() => {
    if (!on) return;
    let live = true;
    void askPersisted().then((p) => live && setPersisted(p));
    const asked = askRoom();
    void asked.then((r) => live && setRoom(r));
    const t = setTimeout(
      () => {
        looked.current = true;
        void import('./worldStore')
          .then(async (m) => {
            const ids = await m.fullWorldIds();
            if (live) setFullIds(ids);
            if (await asked) return;
            const board = await m.spaceBoard();
            if (live && board) setOwn(board.total);
          })
          .catch(() => {});
      },
      looked.current || vaultFullSeen() || storageFullByQuota() ? 0 : VAULT_LOOK_DELAY,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [on, v, tick]);

  const marks = useMemo(() => list.filter((w) => !w.draft).map((w) => ({ id: w.id, mark: saveMark(w.save) })), [list]);
  const near = room && isNearFull(room);
  useEffect(() => {
    if (room && !near) nearOver();
  }, [room, near]);

  const bar = useMemo((): SpaceBarState | null => {
    if (!on) return null;
    const cur = currentWorld();
    const pageOnly = currentUnsaved() && cur && !fullIds.includes(cur.id) ? 1 : 0;
    // 上次打开写不下过、现在地方够了:世界重新存上之前只是没存上,不算满了
    const roomy = !!room && !isNearFull(room);
    const full = vaultFullSeen() || storageFullByQuota() || (fullIds.length > 0 && !roomy);
    const records = fileRecords();
    return pickBar({
      full: full ? { unsaved: fullIds.length + pageOnly } : null,
      atCount: storedCount() >= MAX_WORLDS,
      near: nearBar(room, nearOffAt()),
      lose: loseBar({ device: appleDevice(), small: inSmallWindow(), loggedIn, persisted, files: marks.map((m) => fileStatus(records[m.id], m.mark)), offAt: loseOffAt(), now: Date.now() }),
      off: offNow,
    });
  }, [on, room, persisted, fullIds, marks, loggedIn, tick, v]); // eslint-disable-line react-hooks/exhaustive-deps

  // 不同时说两句
  const stuck = bar?.kind === 'full' || bar?.kind === 'count';
  useEffect(() => {
    if (stuck) clearToast('storage');
  }, [stuck]);

  const closeBar = useCallback(() => {
    if (!bar) return;
    if (bar.kind === 'full') offNow.full = true;
    else if (bar.kind === 'count') offNow.count = true;
    else if (bar.kind === 'near') return closeNear(bar.left);
    else return closeLose();
    spaceChanged();
  }, [bar]);

  return { used: on ? (room?.usage ?? own) : null, bar, closeBar };
}

export function loadSpaceDialog(): Promise<typeof import('./SpaceDialog')> {
  return import('./SpaceDialog').catch((e: unknown) => {
    showToast({
      id: 'world-file',
      kind: 'error',
      text: '打不开占了多少地方',
      more: ['网络断了，或者网站刚更新过，重新加载试试'],
      action: { label: '重新加载', act: 'world-file-reload', onClick: () => location.reload() },
    });
    throw e;
  });
}

/** 那一条难得出现,它的字和样式不进首页 */
let BarView: typeof import('./SpaceBarView').SpaceBarView | null = null;

export function SpaceBar(p: SpaceBarProps) {
  const [, loaded] = useState(0);
  useEffect(() => {
    if (BarView) return;
    void import('./SpaceBarView')
      .then((m) => {
        BarView = m.SpaceBarView;
        loaded(1);
      })
      .catch(() => {});
  }, []);
  return BarView ? <BarView {...p} /> : null;
}

export function SpaceEntry({ used, phone, onClick }: { used: number; phone: boolean; onClick: () => void }) {
  return (
    <button className={phone ? 'mwf-phone' : 'mwf-size'} data-act="space-open" onClick={onClick}>
      占了 {sizeText(used)}
      {phone && <Icon name="chevron" size={12} />}
    </button>
  );
}
