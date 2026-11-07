/**
 * 「传到账号」这件事:打包、切块、先问服务器、传块、提交、等核对、存存档(账号里还没有的先存存档)。一次传一个。用到才下载,首页不带。
 * 点了才传;世界照样能看能改。传的这一会儿又改了,算之后改过(内容记号在开始时就取了)。
 * 只有配方的世界(旧世界、没建完的)只存存档。AI 写的东西跟着存档和文件走。
 * 提示条盖不到账号窗、分享窗:窗口开着时不出提示条,话说在窗口那一行里(fullWorldView.ts 的 holdFullToasts)。
 */
import { deleteCloud } from '../account/cloud';
import { beginFull, commitFull, fetchOverview, sendBlocks, waitChecked, type BlockPlan, type FullCheck } from '../account/fullWorlds';
import { ServerError } from '../account/server';
import { getSession, isAccountDisabled } from '../account/session';
import { exportNotes, notesKnown, notesReady, type AiNote } from '../ai/library';
import { SESSION_CHANGED, pushWorld, takeWorld } from '../account/sync';
import { closeAccountPanel, openAccount, openShareDialog } from './AccountDialogs';
import { planBlocks } from './fullBlocks';
import { askFull, fullJob, fullMark, fullOverview, fullToastHeld, pairText, refusalOf, setFullJob, setFullNote, setFullOverview, setFullPainter, type FullEntry, type FullNote, type FullOverview, type FullRefusal } from './fullWorldView';
import { actLabel, cancelNote, doneNote, errorNote, recipeDoneNote, refusalNote, removeWords, textNote, NOT_SENT, type NoteAct, type NoteActs } from './fullWorldWords';
import { currentSave, currentUnsaved, currentWorld, isStored, keepWorld, loadWorld, rawWorld, savesChanged, type RawWorld } from './saveStore';
import { clearToast, peekToast, showToast, updateToast, type ToastInput } from './toastStore';
import { saveWorldFile, worldFileBytes, type SaveTrouble } from './worldFiles';
import { saveCurrentToFile, saveWorldToFile } from './worldFileFlow';

const TOAST = 'world-full';
const CANCELLED = new Error('取消了');

/** 打包好的文件留着:断线了「再试一次」不用重打,内容记号变了才不用它 */
const packed = new Map<string, { file: Blob; mark: string; raw: RawWorld; notes: AiNote[] | undefined; plan: BlockPlan; maxBlock: number }>();

let live: { id: string; ac: AbortController } | null = null;

const titleOf = (id: string) => (loadWorld(id)?.save.title ?? (currentWorld()?.id === id ? currentWorld()?.title : undefined)) || '这个世界';

/** 存着的优先:页面里的和存下的同一份(还没存下的只有开着的世界才有) */
const markOf = (id: string): string | null => {
  const save = loadWorld(id)?.save ?? (currentWorld()?.id === id ? currentSave() : null);
  return save ? fullMark(id, save) : null;
};

/** 提示条上的按钮 */
function actsFor(id: string): NoteActs {
  return (act: NoteAct) => {
    const onClick = {
      retry: () => void uploadWorld(id),
      reload: () => location.reload(),
      look: () => {
        clearToast(TOAST);
        openAccount();
      },
      file: () => {
        clearToast(TOAST);
        closeAccountPanel();
        void (currentWorld()?.id === id ? saveCurrentToFile() : saveWorldToFile(id));
      },
      share: () => {
        clearToast(TOAST);
        openShareDialog(id, titleOf(id));
      },
    }[act];
    return { label: actLabel(act), act: `full-${act}`, ...(act === 'share' ? { primary: false } : {}), onClick };
  };
}

// ---------------------------------------------------------------------------
// 提示条

function jobToast(): ToastInput | null {
  const j = fullJob();
  if (!j) return null;
  if (j.phase === 'check') return { kind: 'progress', text: `正在核对「${j.title}」`, more: ['已经传完，服务器在检查里面的内容'], actions: [] };
  return {
    kind: 'progress',
    text: `正在传「${j.title}」`,
    more: [j.total && j.phase === 'send' ? `${pairText(j.done, j.total)}，别关页面` : '别关页面'],
    ...(j.phase === 'send' && j.total ? { progress: j.done / j.total } : {}),
    action: { label: '取消', act: 'full-cancel', onClick: cancelUpload },
  };
}

/** 进度写到提示条上。窗口开着时不出,关了接着出 */
function paint() {
  const j = fullJob();
  if (!j || fullToastHeld(j.id)) return void clearToast(TOAST);
  const t = jobToast()!;
  if (peekToast(TOAST)) updateToast(TOAST, t);
  else showToast({ ...t, id: TOAST });
}

setFullPainter(paint);

/** 做完了说一句:窗口开着写在那一行(传好了、取消了那一行自己就变回去,不用说),不然提示条 */
function say(id: string, note: FullNote) {
  clearToast(TOAST);
  if (fullToastHeld(id)) return setFullNote(id, note.kind === 'ok' ? null : note);
  showToast({
    id: TOAST,
    kind: note.kind,
    text: note.text,
    ...(note.more ? { more: [note.more] } : {}),
    ...(note.action ? { action: note.action } : {}),
    ...(note.kind === 'ok' && note.action ? { dot: true, dismissible: true } : {}),
  });
}

// ---------------------------------------------------------------------------
// 传

function packNote(kind: SaveTrouble | 'stale', acts: NoteActs): FullNote {
  if (kind === 'memory') return { kind: 'error', text: NOT_SENT, more: '内存不够。关掉别的页面再试', action: acts('retry') };
  if (kind === 'stale') return { kind: 'warn', text: NOT_SENT, more: '还在推演，推完再传' };
  return { kind: 'error', text: NOT_SENT, more: '内容没存下来。「再存一次」以后能传' };
}

/** 账号里的清单上换成这一份,用量跟着算(再问一次服务器之前先这样) */
function placed(o: FullOverview, w: FullEntry, mark: string): FullOverview {
  const old = o.worlds.find((x) => x.id === w.id);
  return {
    ...o,
    used: { worlds: o.used.worlds + (old ? 0 : 1), bytes: o.used.bytes - (old?.bytes ?? 0) + w.bytes, today: o.used.today + 1 },
    worlds: [{ ...w, mark }, ...o.worlds.filter((x) => x.id !== w.id)],
  };
}

async function doUpload(id: string, me: { id: string; ac: AbortController }): Promise<void> {
  const token = getSession()?.token;
  const still = () => {
    if (live !== me) throw CANCELLED;
    // 等的工夫退出、换了账号:后面的请求会带上新账号的令牌,不能传到别人名下
    if (getSession()?.token !== token) {
      live = null;
      me.ac.abort();
      setFullJob(null);
      clearToast(TOAST);
      throw CANCELLED;
    }
  };
  const acts = actsFor(id);
  const update = (patch: Partial<NonNullable<ReturnType<typeof fullJob>>>) => {
    const j = fullJob();
    if (live === me && j) {
      setFullJob({ ...j, ...patch });
      paint();
    }
  };
  const session = getSession();
  if (!session) throw new ServerError(401, 'auth', '还没登录');
  const end = (note: FullNote) => {
    live = null;
    setFullJob(null);
    say(id, note);
  };
  // 别人分享的、还没存进我的世界:先存进来
  if (!isStored(id)) keepWorld(id);
  if (currentWorld()?.id === id && currentUnsaved()) return end({ kind: 'error', text: NOT_SENT, more: '最新的改动没能存进浏览器。先删掉几个世界腾出地方' });
  const ov = await fetchOverview();
  still();
  if (!ov) {
    setFullOverview(null);
    return end({ kind: 'error', text: NOT_SENT, more: '连不上服务器，联网后再试', action: acts('retry') });
  }
  setFullOverview(ov);
  await notesReady([id]);
  still();
  const mark = markOf(id);
  const raw = rawWorld(id);
  // AI 写的东西和打包的文件同一刻取:传完再存存档时用这一份,不用之后又改过的
  const notes = notesKnown(id) ? exportNotes(id) : undefined;
  if (!mark || !raw) return end({ kind: 'error', text: NOT_SENT, more: '可能已在别的页面里删掉了' });
  let pk = packed.get(id);
  if (!pk || pk.mark !== mark || pk.maxBlock !== ov.limits.blockBytes) {
    const r = await saveWorldFile(id);
    still();
    if (!r.ok && (r.kind === 'draft' || r.kind === 'old')) {
      // 只有配方的世界:传的也是配方
      await pushWorld(id, { raw, notes, token });
      still();
      end(recipeDoneNote);
      void askFull();
      return;
    }
    if (!r.ok) return end(packNote(r.kind, acts));
    // 落后的文件不是现在的样子,传上去「和现在一样」就是假的
    if (r.stale) return end(packNote(r.behind === 'memory' ? 'memory' : 'stale', acts));
    if (r.file.size > ov.limits.worldBytes) return end(refusalNote('big', ov.limits, { bytes: r.file.size }, acts));
    const plan = await planBlocks(r.file, ov.limits.blockBytes, ov.limits.blocksPerFile);
    still();
    pk = { file: r.file, mark, raw, notes, plan, maxBlock: ov.limits.blockBytes };
    packed.set(id, pk);
  }
  const { file, plan } = pk;
  let baseRev = ov.worlds.find((w) => w.id === id)?.rev ?? 0;
  // 账号里已有的存档和它的整个世界是一对:新的核对过了才换存档,中途停下两样都还是原来的。还没有的要先存,服务器才收整个世界
  const recipeFirst = !ov.account.some((w) => w.id === id);
  let sending = false;
  try {
    if (recipeFirst) {
      await pushWorld(id, { alsoFile: true, raw: pk.raw, notes: pk.notes, token });
      still();
    }
    let ans: Awaited<ReturnType<typeof beginFull>>;
    try {
      ans = await beginFull(id, plan, baseRev);
    } catch (e) {
      // 别的设备传过:用它的版本号接着传。用的人点的就是换成现在这份
      if (!(e instanceof ServerError) || e.code !== 'conflict') throw e;
      baseRev = Number(e.data.rev) || 0;
      ans = await beginFull(id, plan, baseRev);
    }
    still();
    const needBytes = (need: readonly string[]) => [...new Set(need)].reduce((n, s) => n + (plan.blocks.find((b) => b.sum === s)?.bytes ?? 0), 0);
    let check: FullCheck;
    if (ans.current) check = { state: 'done', world: ans.current };
    else {
      sending = true;
      const send = async (need: readonly string[]) => {
        const base = plan.bytes - needBytes(need);
        update({ phase: 'send', done: base, total: plan.bytes });
        await sendBlocks(file, plan, need, { signal: me.ac.signal, token, onSent: (n) => update({ done: base + n }) });
        still();
      };
      await send(ans.need);
      let tries = 0;
      for (;;) {
        // 提交了就取消不了:先把「取消」收起来
        update({ phase: 'check', done: plan.bytes, total: plan.bytes });
        try {
          check = await commitFull(id, plan, baseRev, mark);
        } catch (e) {
          if (!(e instanceof ServerError) || e.code !== 'blocks-missing' || ++tries > 2) throw e;
          await send(Array.isArray(e.data.missing) ? (e.data.missing as string[]) : plan.blocks.map((b) => b.sum));
          continue;
        }
        still();
        if (check.state === 'checking') check = await waitChecked(id, { signal: me.ac.signal });
        still();
        // 服务器重启过:看清单里是不是这一份,不是就再提交一次(块还在)
        if (check.state === 'none') {
          const now = await fetchOverview();
          const w = now?.worlds.find((x) => x.id === id);
          if (w?.sum === plan.sum) check = { state: 'done', world: w };
          else if (++tries <= 2) continue;
        }
        break;
      }
    }
    if (check.state === 'failed') {
      const err = check.error;
      if (err.code === 'world-text') return end(textNote(err.hits ?? [], err.hitCount ?? 0, acts));
      return end(errorNote(new ServerError(0, err.code, err.message ?? '', err as unknown as Record<string, unknown>), ov.limits, false, acts));
    }
    if (check.state !== 'done') return end({ kind: 'error', text: NOT_SENT, more: '服务器这会儿太忙，没核对完。等一会儿再试', action: acts('retry') });
    if (!recipeFirst) {
      await pushWorld(id, { alsoFile: true, raw: pk.raw, notes: pk.notes, token });
      still();
    }
    packed.delete(id);
    const next = placed(ov, check.world, mark);
    setFullOverview(next);
    end(doneNote(next, acts));
    // 账号里的数字以服务器为准
    const fresh = await fetchOverview().catch(() => null);
    if (fresh && getSession()?.token === token) setFullOverview(fresh);
    savesChanged();
  } catch (e) {
    if (e === CANCELLED || (e as { name?: string } | null)?.name === 'AbortError') {
      if (live === me) throw e;
      return;
    }
    // 这一件已经取消、又开始了新的一件:它的错不碰新的那件
    if (live !== me) return;
    if ((e instanceof ServerError && e.code === SESSION_CHANGED) || isAccountDisabled(e)) {
      live = null;
      setFullJob(null);
      clearToast(TOAST);
      return;
    }
    if (e instanceof ServerError && e.code === 'conflict') {
      const again = await fetchOverview().catch(() => null);
      if (live !== me) return;
      if (again && getSession()?.token === token) setFullOverview(again);
    }
    end(errorNote(e, ov.limits, sending, acts));
  }
}

/** 传这个世界。已经在传了就露出正在传的那一条,不另开一件 */
export async function uploadWorld(id: string): Promise<void> {
  if (fullJob()) {
    const t = peekToast(TOAST);
    if (t) showToast(t);
    return;
  }
  const me = { id, ac: new AbortController() };
  live = me;
  setFullNote(id, null);
  setFullJob({ id, title: titleOf(id), phase: 'pack', done: 0, total: 0 });
  paint();
  try {
    await doUpload(id, me);
  } catch (e) {
    if (e === CANCELLED || live !== me) return;
    live = null;
    setFullJob(null);
    if ((e instanceof ServerError && e.code === SESSION_CHANGED) || isAccountDisabled(e)) return void clearToast(TOAST);
    say(id, errorNote(e, fullOverview()?.limits ?? null, false, actsFor(id)));
  }
}

/** 取消:提交之前才能取消;已经传上去的块留在服务器上,下次不用重传 */
export function cancelUpload(): void {
  const me = live;
  const j = fullJob();
  if (!me || !j || j.phase === 'check') return;
  live = null;
  me.ac.abort();
  setFullJob(null);
  say(me.id, cancelNote(!!fullOverview()?.worlds.some((w) => w.id === me.id)));
}

/** 灰着的点了:说为什么、下一步能做什么 */
export async function refuseUpload(id: string, r: FullRefusal): Promise<void> {
  const o = fullOverview();
  if (!o) return;
  const bytes = await worldFileBytes(id);
  const had = o.worlds.find((w) => w.id === id);
  say(id, refusalNote(r, o.limits, { bytes, left: Math.max(0, o.limits.bytes - o.used.bytes), ...(had ? {} : {}) }, actsFor(id)));
}

/** 卡片菜单点了:已经传过、没再改的开账号窗;灰的说原因;别的传 */
export async function uploadFromCard(id: string): Promise<void> {
  const o = fullOverview();
  if (o) {
    const r = refusalOf(o, id, await worldFileBytes(id));
    if (r) return refuseUpload(id, r);
  }
  return uploadWorld(id);
}

// ---------------------------------------------------------------------------
// 账号窗里

/** 确认那一行要说什么 */
export const removeLine = (id: string, shared: boolean): string => removeWords({ here: isStored(id), shared });

/** 从账号里删:进最近删除,整个世界一起,额度马上腾出来。这台设备上的世界不动 */
export async function removeFromAccount(id: string): Promise<void> {
  await deleteCloud(id);
  const o = fullOverview();
  if (o) {
    const old = o.worlds.find((w) => w.id === id);
    setFullOverview({ ...o, used: { ...o.used, worlds: o.used.worlds - (old ? 1 : 0), bytes: o.used.bytes - (old?.bytes ?? 0) }, worlds: o.worlds.filter((w) => w.id !== id), account: o.account.filter((w) => w.id !== id) });
  }
  await askFull();
}

/** 取回这台设备:存档先回来(卡片有了),传过整个世界的接着取那一份,取不到的话打开时再试 */
export async function takeFromAccount(id: string): Promise<void> {
  await takeWorld(id);
  const m = await import('./fullWorldPull');
  await m.pullNow(id);
}
