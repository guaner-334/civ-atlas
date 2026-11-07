/**
 * 投到作品墙:世界打包(和存成文件、传到账号同一个)、切块、先问、传块、提交、等核对;地图、新建参数、规则一次交上去。
 * 一次投一件;投稿窗关了照样接着投,话说在提示条上。
 */
import { sendBlocks, type BlockPlan } from '../account/fullWorlds';
import { ServerError } from '../account/server';
import { getSession, isAccountDisabled, onSessionChange } from '../account/session';
import { beginWorldSubmit, commitWorldSubmit, fetchSubmissions, postSubmission, waitSubmission, type SmallWork, type SubmitForm, type SubmitKind } from '../account/submissions';
import { notesReady } from '../ai/library';
import { openAccount } from './AccountDialogs';
import { createListeners } from './createStore';
import { planBlocks } from './fullBlocks';
import { fullMark, fullOverview } from './fullWorldView';
import { currentSave, currentWorld, loadWorld } from './saveStore';
import { SUBMIT_WORLD_MAX, readBan, setSubmitBan, setSubmitJob, submitJob, type SubmitJob } from './submitView';
import { DONE_WORDS, STALE_LINE, bigLine, checkFail, failWords, jobWords, submitFail, type SubmitFail, type ToastWords } from './submitWords';
import { clearToast, peekToast, showToast, updateToast, type ToastInput } from './toastStore';
import { saveWorldFile } from './worldFiles';
import { saveCurrentToFile, saveWorldToFile } from './worldFileFlow';
import { keepAgreed, keepDraft } from './submitDrafts';
import { keepSubmitThumb } from './submitThumbs';

const TOAST = 'submit-world';
const CANCELLED = new Error('取消了');
const BLOCK_BYTES = 16 * 1024 * 1024;
const BLOCKS_PER_FILE = 512;

export type SubmitResult = { kind: 'done'; left: number | null } | { kind: 'fail'; fail: SubmitFail };

const listeners = createListeners();
let results: Readonly<Record<string, SubmitResult>> = {};
export const useSubmitResult = (id: string): SubmitResult | null => listeners.use(() => results[id] ?? null);
export function clearSubmitResult(id: string): void {
  if (!results[id]) return;
  const { [id]: _drop, ...rest } = results;
  results = rest;
  listeners.emit();
}
function setResult(id: string, r: SubmitResult) {
  results = { ...results, [id]: r };
  listeners.emit();
}

/** 打包好的文件留着:断线了接着传不用重打,内容记号变了才不用它 */
const packed = new Map<string, { file: Blob; mark: string; plan: BlockPlan }>();

/** 投一件要的:作品的记号(世界是世界编号)、名字(进度上写)、填的字、停在哪一年 */
export interface SubmitAsk {
  id: string;
  kind: SubmitKind;
  title: string;
  form: SubmitForm;
  moment: number | null;
  /** 地图、新建参数、规则交的东西;世界不给(走传块) */
  small?: SmallWork;
  /** 投好以后「我的投稿」里那一行的小图 */
  thumb?: string | null;
}

let live: (SubmitAsk & { ac: AbortController }) | null = null;
/** 断线以后接着传、太忙以后再投一次:用上次填的字(块传过的不用重传;核对中再交同一份不算第二次)。只给填字时登着的那个账号用 */
let lastAsk: (SubmitAsk & { token: string | undefined }) | null = null;

// 退出、换了账号:上一个账号没投成的那件不能接着投到新账号名下,结果也不再说
onSessionChange(() => {
  if (!lastAsk || lastAsk.token === getSession()?.token) return;
  lastAsk = null;
  results = {};
  listeners.emit();
  if (!submitJob()) clearToast(TOAST);
});

/** 页面里的优先:打包用的就是页面里的(存不进浏览器时存下的那份是旧的) */
const markOf = (id: string): string | null => {
  const save = (currentWorld()?.id === id ? currentSave() : null) ?? loadWorld(id)?.save;
  return save ? fullMark(id, save) : null;
};

// ---------------------------------------------------------------------------
// 投稿窗开着时不出提示条

let holds = 0;
export function holdSubmitToasts(): () => void {
  holds++;
  paint();
  return () => {
    holds--;
    paint();
  };
}

function toastOf(w: ToastWords, id: string): ToastInput {
  const acts = {
    cancel: { label: '取消', act: 'submit-cancel', onClick: cancelSubmit },
    look: { label: '看我的投稿', act: 'submit-look', onClick: () => (clearToast(TOAST), openAccount('submissions')) },
    resume: { label: '接着传', act: 'submit-resume', onClick: () => resumeSubmit(id) },
    retry: { label: '再投一次', act: 'submit-retry', onClick: () => resumeSubmit(id) },
    reload: { label: '刷新页面', act: 'submit-reload', onClick: () => location.reload() },
    file: { label: '存成文件', act: 'submit-file', onClick: () => (clearToast(TOAST), saveToFile(id)) },
  };
  return {
    kind: w.kind,
    text: w.text,
    ...(w.more ? { more: [w.more] } : {}),
    ...(w.progress !== undefined ? { progress: w.progress } : {}),
    ...(w.act ? { action: acts[w.act] } : {}),
    ...(w.kind === 'ok' ? { dot: true, dismissible: true } : {}),
  };
}

function paint() {
  const j = submitJob();
  if (holds > 0) return clearToast(TOAST);
  if (!j) return;
  const t = toastOf(jobWords(j), j.id);
  if (peekToast(TOAST)) updateToast(TOAST, t);
  else showToast({ ...t, id: TOAST });
}

/** 做完了:窗口开着就留给窗口说;关着出提示条,没投成的留着,打开窗口时说全 */
function end(me: Pick<SubmitAsk, 'id' | 'kind'>, r: SubmitResult) {
  live = null;
  setSubmitJob(null);
  clearToast(TOAST);
  if (holds > 0 || r.kind === 'fail') setResult(me.id, r);
  if (holds > 0) return;
  showToast({ ...toastOf(r.kind === 'done' ? DONE_WORDS : failWords(r.fail, me.kind), me.id), id: TOAST });
}

/** 收下了:填的字不用留,记下看过的须知、小图,问一次今天还剩几次 */
async function accepted(me: SubmitAsk, subId: number): Promise<void> {
  keepDraft(me.id, null);
  keepAgreed(me.form.terms);
  keepSubmitThumb(subId, me.thumb ?? null);
  const after = await fetchSubmissions().catch(() => null);
  const l = after?.limits;
  end(me, { kind: 'done', left: l ? Math.max(0, l.perDay - l.usedToday) : null });
}

export function saveToFile(id: string): void {
  void (currentWorld()?.id === id ? saveCurrentToFile() : saveWorldToFile(id));
}

// ---------------------------------------------------------------------------
// 投

async function doSubmit(me: NonNullable<typeof live>): Promise<void> {
  const { id } = me;
  const token = getSession()?.token;
  const still = () => {
    if (live !== me) throw CANCELLED;
    // 等的工夫退出、换了账号:后面的请求会带上新账号的令牌,不能投到别人名下
    if (getSession()?.token !== token) {
      live = null;
      me.ac.abort();
      setSubmitJob(null);
      clearToast(TOAST);
      throw CANCELLED;
    }
  };
  const update = (patch: Partial<SubmitJob>) => {
    const j = submitJob();
    if (live === me && j) {
      setSubmitJob({ ...j, ...patch });
      paint();
    }
  };
  const fail = (f: SubmitFail) => end(me, { kind: 'fail', fail: f });
  await notesReady([id]);
  still();
  const mark = markOf(id);
  if (!mark) return fail({ kind: 'line', text: '可能已在别的页面里删掉了' });
  const lim = fullOverview()?.limits;
  const max = lim?.worldBytes ?? SUBMIT_WORLD_MAX;
  let pk = packed.get(id);
  if (!pk || pk.mark !== mark) {
    const r = await saveWorldFile(id);
    still();
    if (!r.ok) return fail({ kind: 'line', text: r.message });
    if (r.stale) return fail({ kind: 'line', text: STALE_LINE });
    if (r.file.size > max) return fail({ kind: 'line', text: bigLine(r.file.size, max) });
    const plan = await planBlocks(r.file, lim?.blockBytes ?? BLOCK_BYTES, lim?.blocksPerFile ?? BLOCKS_PER_FILE);
    still();
    pk = { file: r.file, mark, plan };
    packed.set(id, pk);
  }
  const { file, plan } = pk;
  let sending = false;
  try {
    const ans = await beginWorldSubmit(plan);
    still();
    sending = true;
    const send = async (need: readonly string[]) => {
      const base = plan.bytes - [...new Set(need)].reduce((n, s) => n + (plan.blocks.find((b) => b.sum === s)?.bytes ?? 0), 0);
      update({ phase: 'send', done: base, total: plan.bytes });
      await sendBlocks(file, plan, need, { signal: me.ac.signal, token, onSent: (n) => update({ done: base + n }) });
      still();
    };
    await send(ans.need);
    let made: { id: number };
    for (let tries = 0; ; tries++) {
      // 提交了就取消不了:先把「取消」收起来
      update({ phase: 'check', done: plan.bytes, total: plan.bytes });
      try {
        made = await commitWorldSubmit(plan, me.form, me.moment);
        break;
      } catch (e) {
        if (!(e instanceof ServerError) || e.code !== 'blocks-missing' || tries >= 2) throw e;
        await send(Array.isArray(e.data.missing) ? (e.data.missing as string[]) : plan.blocks.map((b) => b.sum));
      }
    }
    still();
    const sub = await waitSubmission(made.id, { signal: me.ac.signal });
    still();
    if (sub.status === 'failed') return fail(checkFail(sub.error, sub.reason));
    packed.delete(id);
    await accepted(me, made.id);
  } catch (e) {
    if (e === CANCELLED || (e as { name?: string } | null)?.name === 'AbortError') {
      if (live === me) throw e;
      return;
    }
    if (live !== me) return;
    if (isAccountDisabled(e)) {
      live = null;
      setSubmitJob(null);
      return clearToast(TOAST);
    }
    const f = submitFail(e, sending);
    if (f.kind === 'notice' && f.which === 'ban') setSubmitBan(f.ban ?? null);
    fail(f);
  }
}

/** 地图、新建参数、规则:交一次就完 */
async function doSmall(me: NonNullable<typeof live>, work: SmallWork): Promise<void> {
  const token = getSession()?.token;
  // 等的工夫退出、换了账号:回话是原来那个账号的,这边不再说(停没停投稿也不能记到新账号上)
  const gone = () => {
    if (live !== me) return true;
    if (getSession()?.token === token) return false;
    live = null;
    setSubmitJob(null);
    clearToast(TOAST);
    return true;
  };
  let made: { id: number };
  try {
    made = await postSubmission(work, me.form);
  } catch (e) {
    if (gone()) return;
    const f = submitFail(e, false, me.kind);
    if (f.kind === 'notice' && f.which === 'ban') setSubmitBan(f.ban ?? null);
    return end(me, { kind: 'fail', fail: f });
  }
  if (gone()) return;
  await accepted(me, made.id);
}

/** 投这一件;已经在投了就什么都不做(窗里、提示条上看得到正在投的那一件) */
export async function startSubmit(ask: SubmitAsk): Promise<void> {
  if (submitJob()) return;
  const { id, kind, title } = ask;
  const me = { ...ask, ac: new AbortController() };
  live = me;
  lastAsk = { ...ask, token: getSession()?.token };
  clearSubmitResult(id);
  setSubmitJob({ id, kind, title, phase: ask.small ? 'post' : 'pack', done: 0, total: 0 });
  paint();
  try {
    await (ask.small ? doSmall(me, ask.small) : doSubmit(me));
  } catch (e) {
    if (e === CANCELLED || live !== me) return;
    end(me, { kind: 'fail', fail: submitFail(e, false, kind) });
  }
}

export function resumeSubmit(id: string): void {
  clearToast(TOAST);
  if (lastAsk?.id === id && lastAsk.token === getSession()?.token) void startSubmit(lastAsk);
}

/** 取消:提交之前才能取消;已经传上去的块留在服务器上,下次不用重传 */
export function cancelSubmit(): void {
  const me = live;
  const j = submitJob();
  if (!me || !j || j.phase === 'check' || j.phase === 'post') return;
  live = null;
  me.ac.abort();
  setSubmitJob(null);
  clearToast(TOAST);
}

/** 打开投稿窗时问一次:今天还能投几次、须知第几版、停没停投稿 */
export async function askLimits() {
  const r = await fetchSubmissions();
  setSubmitBan(readBan(r.ban));
  return r;
}
