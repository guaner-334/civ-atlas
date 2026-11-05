/** 放在「我的世界」那一页里面、不放到页面最外层:顶上的提示条才盖得住窗口,撤销、取消、「存到手机」才点得到。 */
import { useEffect, useMemo, useReducer, useState } from 'react';
import { Dialog } from './AccountDialogs';
import { useSession } from '../account/session';
import { Icon } from './icons';
import { currentUnsaved, currentWorld, listWorlds, storageFullByQuota, useSavesVersion, type StoredWorld } from './saveStore';
import { sizeText } from './sizeWords';
import { appleDevice, askPersisted, askRoom, fileRecords, fileStatus, firefoxAsked, isNearFull, onSpaceChange, saveMark, vaultFullSeen, type FileStatus, type RoomFacts } from './spaceFacts';
import { UNSAVED_CONTENT, UNSAVED_NOW, fileLine, meterOf, saveAllBlue, sumLine, trashLine, windowNotes, type FullKind, type WindowFacts } from './spaceWords';
import { withFileFlow } from './worldFileLazy';
import { clearTrashNow, fullWorldIds, spaceBoard, trashInfo, type SpaceBoard, type TrashInfo } from './worldStore';
import './spaceWindow.css';

interface Quick {
  room: RoomFacts | null;
  persisted: boolean;
  fullIds: readonly string[];
}

interface Row {
  id: string;
  name: string;
  thumb: string | null;
  bytes: number | null;
  sub: string;
  warn: boolean;
  file: boolean;
  del: boolean;
  status: FileStatus | null;
}

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => Number(b.warn) - Number(a.warn) || (b.bytes ?? 0) - (a.bytes ?? 0));
}

function rowsOf(list: readonly StoredWorld[], fullIds: readonly string[], board: SpaceBoard | null, now: number): Row[] {
  const records = fileRecords();
  const full = new Set(fullIds);
  const cur = currentWorld();
  const pageOnly = currentUnsaved() ? cur?.id : undefined;
  const rows = list.map((w): Row => {
    const status = w.draft ? null : fileStatus(records[w.id], saveMark(w.save));
    const warn = pageOnly === w.id ? UNSAVED_NOW : full.has(w.id) ? UNSAVED_CONTENT : null;
    return {
      id: w.id,
      name: w.save.title || '未命名世界',
      thumb: w.thumb,
      bytes: board ? (board.worlds[w.id] ?? 0) : null,
      sub: warn ?? (w.draft ? '还没建完' : w.map ? '只存了地图' : fileLine(status!, now)),
      warn: !!warn,
      file: !w.draft && !w.map,
      del: true,
      status,
    };
  });
  if (cur && pageOnly && !list.some((w) => w.id === cur.id)) rows.unshift({ id: cur.id, name: cur.title || '未命名世界', thumb: null, bytes: board ? 0 : null, sub: UNSAVED_NOW, warn: true, file: true, del: false, status: null });
  return sortRows(rows);
}

export function SpaceDialog({ phone, onClose, onDelete }: { phone: boolean; onClose: () => void; onDelete: (id: string, name: string) => void }) {
  const v = useSavesVersion();
  const session = useSession();
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onSpaceChange(bump), []);
  const [quick, setQuick] = useState<Quick | null>(null);
  const [board, setBoard] = useState<SpaceBoard | null>(null);
  const [trash, setTrash] = useState<TrashInfo | null>(null);
  const [trashAt, setTrashAt] = useState(-1);
  const [stuck, setStuck] = useState(0);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    let live = true;
    // 撤销提示刚收起时放开记号要一小会儿。分开问:硬盘满了时 WebKit 读仓库要等很久,别的先出来
    const t = setTimeout(() => {
      void Promise.all([askRoom(), askPersisted(), fullWorldIds()]).then(([room, persisted, fullIds]) => {
        if (live) setQuick({ room, persisted, fullIds });
      });
      void spaceBoard().then((b) => {
        if (live) setBoard(b);
      });
      void trashInfo().then((x) => {
        if (!live) return;
        setTrash(x);
        setTrashAt(v);
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [v, tick]);

  const list = useMemo(() => listWorlds(), [v]);
  const now = Date.now();
  const rows = rowsOf(list, quick?.fullIds ?? [], board, now);
  const gone = !!trash && trash.count > 0 && trash.clearBy !== null;

  // 刚删掉最后一个世界时要等新问到的:它的内容还占着地方,窗口关了这一页就没有入口了
  useEffect(() => {
    if (trashAt === v && !rows.length && !gone) onClose();
  }, [trashAt, v, rows.length, gone, onClose]);

  const device = appleDevice();
  const vaultFull = vaultFullSeen() || (!!quick?.fullIds.length && !(quick.room && !isNearFull(quick.room)));
  const full: FullKind = vaultFull ? 'vault' : storageFullByQuota() ? 'cabinet' : null;
  const statuses = rows.flatMap((r) => (r.status ? [r.status] : []));
  const facts: WindowFacts = {
    used: quick?.room?.usage ?? board?.total ?? null,
    room: quick?.room ?? null,
    full,
    near: !!quick?.room && isNearFull(quick.room),
    unsaved: rows.filter((r) => r.warn).length,
    device,
    firefoxNo: firefoxAsked(),
    loggedIn: !!session,
    persisted: quick?.persisted ?? null,
    allSaved: statuses.length > 0 && statuses.every((s) => s.kind === 'same'),
    bigger: !!board?.bigger,
    gone,
  };
  const meter = meterOf(facts);
  const warnSum = full === 'vault' || (facts.near && !full);
  const notes = quick ? windowNotes(facts) : [];

  const clearNow = () => {
    if (clearing) return;
    setClearing(true);
    void clearTrashNow().then(async (r) => {
      const left = await trashInfo();
      setClearing(false);
      setTrash(left);
      // 等着认回来的世界也在 kept 里,不算清不掉
      setStuck(r.kept.filter((id) => left.ids.includes(id)).length);
      bump();
    });
  };
  const saveAll = () => withFileFlow('没能存成文件', (m) => m.saveAllToFile());
  const held = trash ? trash.held : 0;
  const stuckNow = Math.min(trash?.count ?? 0, Math.max(stuck, held));

  const saveAllBtn = (
    <button className={`acct-btn${saveAllBlue(facts, phone) ? ' blue' : ''}${phone ? ' full' : ''}`} data-act="space-save-all" onClick={saveAll}>
      全部存成文件
    </button>
  );
  return (
    <Dialog phone={phone} label="占了多少地方" width={520} onClose={onClose} className="sz" testId="space-dialog" inPlace>
      <div className="acct-body">
        <div>
          <div className={`sz-sum${warnSum ? ' warn' : ''}`} data-testid="space-sum">
            {sumLine(facts) || ' '}
          </div>
          {meter !== null && (
            <div className="sz-meter" aria-hidden="true">
              <i style={{ width: `${meter}%` }} />
            </div>
          )}
        </div>
        {rows.length > 0 && (
          <div className="sz-list" role="list">
            {rows.map((r) => (
              <div className="sz-row" role="listitem" key={r.id} data-id={r.id}>
                <span className="sz-th" style={r.thumb ? { backgroundImage: `url(${r.thumb})` } : undefined} />
                <span className="sz-main">
                  <span className="sz-name">{r.name}</span>
                  <span className={`sz-sub${r.warn ? ' warn' : ''}`}>{r.sub}</span>
                </span>
                <span className="sz-size">{r.bytes === null ? '' : r.bytes > 0 ? sizeText(r.bytes) : '不到 1 MB'}</span>
                <button className={`sz-ic${r.file ? '' : ' none'}`} data-act="space-save" aria-label="存成文件" title="存成文件" tabIndex={r.file ? 0 : -1} onClick={() => r.file && withFileFlow('没能存成文件', (m) => m.saveWorldToFile(r.id))}>
                  <Icon name="save" size={16} />
                </button>
                <button className={`sz-ic${r.del ? '' : ' none'}`} data-act="space-delete" aria-label="删除" title="删除" tabIndex={r.del ? 0 : -1} onClick={() => r.del && onDelete(r.id, r.name)}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {gone && (
          <div className="sz-list" data-testid="space-gone">
            <div className="sz-row">
              <span className="sz-main">
                <span className="sz-name">删掉的世界</span>
                <span className="sz-sub">{trashLine(trash!.count, trash!.clearBy!, !!session, stuckNow, now)}</span>
              </span>
              <span className="sz-size">{sizeText(trash!.bytes)}</span>
              <button className="acct-btn" data-act="space-clear" disabled={clearing || held >= trash!.count} onClick={clearNow}>
                现在清掉
              </button>
            </div>
          </div>
        )}
        {notes.map((t) => (
          <p className="acct-small" key={t}>
            {t}
          </p>
        ))}
      </div>
      {rows.length > 0 &&
        (phone ? (
          <div className="acct-foot col">{saveAllBtn}</div>
        ) : (
          <div className="acct-foot">
            <span className="acct-sp" />
            {saveAllBtn}
          </div>
        ))}
    </Dialog>
  );
}
