/**
 * 打开的世界文件和本机一个世界是同一个、内容不一样时问的窗口(谁来问见 worldFileFlow.ts,挂在哪见 sameWorldAsk.ts)。
 * 两份并排写几样看得到的;不一样的那几行两边都加粗,时间只加粗新的那边,不写「新一些」这类字。
 * 电脑居中、手机从下面升起;按钮排法和「另存一份再推演？」一样(FrozenWorld.tsx)。Esc、点外面、×、取消都是什么都不动。
 */
import { endYearOf } from '../gen/edits';
import { yearFull } from '../gen/era';
import { editCount, type SaveFile } from '../gen/savefile';
import { CloseX, Dialog } from './AccountDialogs';
import { answerSameWorld, type AskLine, type AskSide, type SameAsk } from './sameWorldAsk';
import { playedTo } from './worldParts';

/** 并排的一份要的东西 */
export interface WorldSide {
  save: SaveFile;
  /** 封面(dataURL);没有 = null */
  thumb: string | null;
  /** 结束那一年现存几国;不知道 = undefined */
  alive?: number;
  /** AI 写了几段;读不出来 = undefined */
  notes?: number;
}

/** 11 月 3 日 21:40 改过;今天、昨天的写今天、昨天;往年的只写到日 */
export function changedAt(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (t >= today.getTime()) return `今天 ${hm} 改过`;
  if (t >= today.getTime() - 86400e3) return `昨天 ${hm} 改过`;
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return d.getFullYear() === today.getFullYear() ? `${md} ${hm} 改过` : `${d.getFullYear()} 年 ${md}改过`;
}

const yearLine = (s: SaveFile) => playedTo(s.edits) ?? `推到${yearFull(endYearOf(s.edits), s.edits.era)}`;
const aliveLine = (n: number) => (n ? `现存 ${n} 国` : '没有文明');
const notesLine = (n: number) => (n ? `AI 写了 ${n} 段` : 'AI 没写过');

/** 两列的几行。alike:除了时间,看得到的几项(连名字)都一样 */
export function sideLines(mine: WorldSide, theirs: WorldSide, now = Date.now()): { left: AskLine[]; right: AskLine[]; alike: boolean } {
  const left: AskLine[] = [];
  const right: AskLine[] = [];
  const ta = Date.parse(mine.save.savedAt);
  const tb = Date.parse(theirs.save.savedAt);
  const a = changedAt(mine.save.savedAt, now);
  const b = changedAt(theirs.save.savedAt, now);
  // 写出来一样(同一分钟)就都不加粗
  left.push({ text: a, bold: a !== b && ta > tb });
  right.push({ text: b, bold: a !== b && tb > ta });
  let alike = (mine.save.title ?? '') === (theirs.save.title ?? '');
  const pair = (a: string, b: string) => {
    const bold = a !== b;
    if (bold) alike = false;
    left.push({ text: a, bold });
    right.push({ text: b, bold });
  };
  pair(yearLine(mine.save), yearLine(theirs.save));
  if (mine.alive !== undefined && theirs.alive !== undefined) pair(aliveLine(mine.alive), aliveLine(theirs.alive));
  pair(`${editCount(mine.save.edits)} 处改动`, `${editCount(theirs.save.edits)} 处改动`);
  if (mine.notes !== undefined && theirs.notes !== undefined && mine.notes !== theirs.notes) pair(notesLine(mine.notes), notesLine(theirs.notes));
  return { left, right, alike };
}

function Side({ tag, side }: { tag: string; side: AskSide }) {
  return (
    <div className="dup-col">
      <div className="dup-tag">{tag}</div>
      <div className="dup-th" style={side.thumb ? { backgroundImage: `url("${side.thumb}")` } : undefined} />
      <b className="dup-name">{side.title}</b>
      {side.lines.map((l, i) => (
        <div key={i} className={`dup-line${l.bold ? ' b' : ''}`}>
          {l.text || ' '}
        </div>
      ))}
    </div>
  );
}

export function SameWorldDialog({ phone, ask: a }: { phone: boolean; ask: SameAsk }) {
  const cancel = () => answerSameWorld('cancel');
  const copy = () => answerSameWorld('copy');
  const original = () => answerSameWorld('original');
  // 名字太长时只截名字,后半句留着
  const title = (
    <h2 className="dup-title">
      <span className="dup-title-name">「{a.title}</span>
      <span className="dup-title-rest">」已经有了，内容不一样</span>
    </h2>
  );
  const SAVE = '另存一份并打开';
  return (
    <Dialog
      phone={phone}
      label={`「${a.title}」已经有了，内容不一样`}
      width={560}
      onClose={cancel}
      testId="same-world-ask"
      head={
        <div className="acct-head">
          {title}
          {!phone && <CloseX onClose={cancel} />}
        </div>
      }
    >
      <div className="acct-body">
        <div className="dup-cols">
          <Side tag={a.open ? '正开着的' : '原来的'} side={a.mine} />
          <Side tag="文件里的" side={a.theirs} />
        </div>
        {a.alike && <p className="acct-small dup-alike">这几项都一样，差在世界里的细节</p>}
        <p className="acct-small dup-note">
          {a.open ? '正开着的不会被盖掉。' : '两种都不会盖掉原来的。'}另存的一份叫「{a.copyTitle}」。
        </p>
      </div>
      <div className={`acct-foot${phone ? ' col' : ''}`}>
        {phone ? (
          <>
            <button className="acct-btn full blue" data-act="same-copy" onClick={copy}>
              {SAVE}
            </button>
            {!a.open && (
              <button className="acct-btn full" data-act="same-original" onClick={original}>
                打开原来的
              </button>
            )}
            <button className="acct-btn full" data-act="same-cancel" onClick={cancel}>
              取消
            </button>
          </>
        ) : (
          <>
            {!a.open && (
              <button className="acct-btn" data-act="same-original" onClick={original}>
                打开原来的
              </button>
            )}
            <span className="acct-sp" />
            <button className="acct-btn" data-act="same-cancel" onClick={cancel}>
              取消
            </button>
            <button className="acct-btn blue" data-act="same-copy" onClick={copy}>
              {SAVE}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
