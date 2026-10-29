/**
 * 世界概览的「之最」页(在「人物」后面):15 条"到这一年为止"的纪录(gen/civ/records.ts 算),跟着时间轴 ——
 * 拨到哪年就是到那年为止的纪录,回放时看得到纪录一条条被刷新。分「人物」「王朝和国家」「战争和地方」三组。
 *
 *   电脑  表格一行一条:纪录 | 保持者(头像或国旗、名字、身份)| 多少 | 年份 | 保持自 | 历来 N 任
 *   手机  一条三行:纪录名;头像、名字、多少;身份和年份;下面一行小字"保持自 … 历来 N 任 ›"
 *
 * 并列(在位最久、最长寿常顶着人物的寿数上限):先到的保持,写"另有 N 位同为 51 年"。
 * 30 年内换了保持者的那行淡蓝、标「新纪录」,写破了谁的多少。「历来 N 任」点了在这一行下面就地展开,新的在上,点名字看他。
 * 还没有的(早年还没打过仗……)照列,灰字写"还没打过仗",数写"—"。
 *
 * 点一行:人 → 人物卡;国 → 国家卡片;州、城 → 州卡片、城卡片(都先收起概览,和人物页、国家页点一行一样);
 * 一朝 → 人物页的世系图,停在那一朝;一场仗 → 编年史只看攻方,跳到开战那年(这两样没有卡片,留在概览里换一页)。
 * 「复制全文」复制成纯文字。
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import { polityAlive, polityName, populationLabel } from '../gen/civ/growth';
import { personRoleShort } from '../gen/civ/peopleText';
import { ownersAt } from '../gen/civ/timeline';
import {
  RECORD_GROUPS,
  RECORD_NONE,
  RECORD_TITLE,
  RECORD_UNIT,
  recordBook,
  recordHistory,
  recordName,
  recordsAt,
  type RecordAt,
  type RecordKey,
  type RecordRef,
} from '../gen/civ/records';
import { spaced, yearAt, yearShort, yearShortAt, type Era } from '../gen/era';
import { closeOverview, openLineage, openOverview } from './overviewStore';
import { seedTag, useEdits } from './editsStore';
import { setSelection } from './civView';
import { copyText, selectPerson } from './panelParts';
import { useYear } from './WorldOverviewMarks';
import { locate } from './WorldOverviewCountries';
import { useNarrow } from './device';
import { PolityFlag } from './Flag';
import { PersonFace } from './Portrait';

/** 换了保持者这么多年以内,那一行标「新纪录」 */
const FRESH = 30;

/** 一条纪录写成字 */
interface Line {
  name: string;
  /** 名字后面的灰字:身份、哪国、"今某某" */
  sub: string;
  value: string;
  /** 年份那一列:"1223–1274 在位""2121 年鼎盛" */
  when: string;
  /** 保持自:"1275 年起";最大的城 = "按这一年的人口" */
  since: string;
  /** 保持自下面一行:"另有 14 位同为 51 年" / "破了某某的 16 州" */
  note: string;
  fresh: boolean;
}

function valueText(key: RecordKey, v: number): string {
  return key === 'city' ? populationLabel(v) : `${v} ${RECORD_UNIT[key]}`;
}

/** 某一刻的国名(已亡的按亡国前) */
function polName(civ: Civ, id: number, at: number): string {
  const p = civ.polities[id];
  return p ? polityName(p, Math.max(p.founded, Math.min(p.ended ?? Infinity, at) - 1 / 512)) : '';
}

function lineOf(civ: Civ, r: RecordAt, y: number, era: Era | undefined, owner: (region: number) => number): Line {
  const ys = (t: number) => yearShort(t, era);
  const upTo = (t: number | undefined) => (t !== undefined && t <= y ? ys(t) : '今');
  const value = valueText(r.key, r.value);
  const ref = r.ref;
  let name = recordName(civ, ref, y);
  let sub = '';
  let when = '';
  switch (ref.kind) {
    case 'person': {
      const x = civ.people![ref.id];
      sub = personRoleShort(civ, x);
      if (r.key === 'old') when = `${ys(x.born)}–${upTo(x.died)}`;
      else if (r.key === 'took' || r.key === 'held') {
        const cs = (x.commands ?? []).filter((c) => c.from <= y);
        if (cs.length) when = `${ys(cs[0].from)}–${ys(Math.min(cs[cs.length - 1].until, y))} 领兵`;
      } else if (r.key === 'serve') when = `${ys(x.from!)}–${upTo(x.until)} 在朝`;
      else if (r.key === 'regent') {
        const gs = (x.regencies ?? []).filter((g) => g.from <= y);
        if (gs.length) when = `${ys(gs[0].from)}–${upTo(gs[gs.length - 1].until)} 掌权`;
      } else when = `${ys(x.from!)}–${upTo(x.until)} 在位`;
      break;
    }
    case 'dynasty': {
      const pn = polName(civ, ref.polity, Math.min(ref.to, y));
      if (pn !== name) sub = pn;
      when = `${ys(ref.from)}–${ys(Math.min(ref.to, y))}`;
      break;
    }
    case 'polity': {
      const p = civ.polities[ref.id];
      if (r.key === 'big') {
        name = polName(civ, ref.id, r.at + 1 / 512);
        const now = polName(civ, ref.id, y);
        if (polityAlive(p, y) && now !== name) sub = `今${now}`;
        when = `${yearShortAt(r.at, era)}鼎盛`;
      } else if (r.key === 'capitals') when = `末次 ${yearShortAt(r.at, era)}`;
      else when = `${yearShortAt(p.founded, era)}立国，${p.ended !== undefined && p.ended <= y ? `${yearShortAt(p.ended, era)}亡` : '至今'}`;
      break;
    }
    case 'war':
      when = `${ys(ref.from)}–${upTo(ref.to)}`;
      break;
    case 'region': {
      const o = owner(ref.id);
      if (o >= 0) sub = `今属${polName(civ, o, y)}`;
      when = `末次 ${yearShortAt(r.at, era)}`;
      break;
    }
    case 'settlement': {
      const o = owner(civ.settlements[ref.id].region);
      if (o >= 0) sub = polName(civ, o, y);
      when = yearShortAt(y, era);
      break;
    }
  }
  const fresh = r.key !== 'city' && r.count > 1 && y - r.since <= FRESH;
  let note = '';
  if (r.ties > 0) note = `另有 ${r.ties} 位同为 ${value}`;
  else if (fresh && r.prev) note = `破了${recordName(civ, r.prev.ref, r.since)}的 ${valueText(r.key, r.prev.value)}`;
  const since = r.key === 'city' ? '按这一年的人口' : `${yearShortAt(r.since, era)}起`;
  return { name, sub, value, when, since, note, fresh };
}

/** 点一个保持者:人 → 人物卡,国 → 国家卡片,州、城 → 卡片;一朝 → 世系图;一场仗 → 编年史只看攻方、跳到开战那年 */
function go(civ: Civ, ref: RecordRef, y: number) {
  switch (ref.kind) {
    case 'person':
      selectPerson(ref.id);
      return;
    case 'polity':
      locate(civ.polities[ref.id], y);
      return;
    case 'region':
      closeOverview();
      setSelection({ kind: 'region', id: ref.id });
      return;
    case 'settlement':
      closeOverview();
      setSelection({ kind: 'settlement', id: ref.id });
      return;
    case 'dynasty':
      openLineage(ref.polity, { dynasty: ref.dynasty });
      return;
    case 'war':
      openOverview('chronicle', { polity: ref.a >= 0 ? ref.a : null, at: Math.floor(ref.from) });
      return;
  }
}

/** 点一行的提示 */
function goTitle(ref: RecordRef): string {
  switch (ref.kind) {
    case 'person':
      return '看这个人';
    case 'polity':
      return '在地图上看这国';
    case 'region':
      return '看这个州';
    case 'settlement':
      return '看这座城';
    case 'dynasty':
      return '看这一朝的世系图';
    case 'war':
      return '在编年史里看这场仗';
  }
}

/** 名字前面的头像 / 国旗(州、城:这一年归哪国的旗) */
function Mark({ civ, r, y, owner }: { civ: Civ; r: RecordAt; y: number; owner: (region: number) => number }) {
  const ref = r.ref;
  if (ref.kind === 'person') {
    const x = civ.people![ref.id];
    return <PersonFace civ={civ} x={x} year={y} size="row" />;
  }
  let pid = -1;
  let at = y;
  if (ref.kind === 'polity') {
    pid = ref.id;
    if (r.key === 'big') at = r.at + 1 / 512;
  } else if (ref.kind === 'dynasty') {
    pid = ref.polity;
    at = Math.min(ref.to, y) - 1 / 512;
  } else if (ref.kind === 'war') {
    pid = ref.a;
    at = ref.from;
  } else if (ref.kind === 'region') pid = owner(ref.id);
  else if (ref.kind === 'settlement') pid = owner(civ.settlements[ref.id].region);
  const p = civ.polities[pid];
  const sw = <i className="ov-sw rec-sw" style={{ background: p ? `rgb(${p.color.join(',')})` : 'var(--line)' }} />;
  if (!p) return sw;
  return <PolityFlag id={pid} year={at} w={21} className="ov-flag rec-flag" fallback={sw} />;
}

/** 「历来 N 任」展开的那一块:新的在上 */
function History({ civ, k, y, era, book }: { civ: Civ; k: RecordKey; y: number; era: Era | undefined; book: ReturnType<typeof recordBook> }) {
  const rows = recordHistory(book, k, y);
  const nameAt = (ref: RecordRef, at: number, peak: number) => (k === 'big' && ref.kind === 'polity' ? polName(civ, ref.id, peak + 1 / 512) : recordName(civ, ref, at));
  return (
    <div className="rec-chain" data-chain={k}>
      <div className="rec-chain-h">「{RECORD_TITLE[k]}」历来的保持者（新的在上，点名字看他）</div>
      {rows.map((e) => (
        <div key={e.from} className="rec-ch">
          <span className="y">
            {yearShort(e.from, era)}–{e.to !== undefined ? yearShort(e.to, era) : ''}
          </span>
          <b>
            <button className="ov-link" type="button" data-act="record-holder" onClick={() => go(civ, e.ref, y)}>
              {nameAt(e.ref, e.to ?? y, e.at)}
            </button>
          </b>
          <span className="v">{valueText(k, e.value)}</span>
          <span className="n">
            {e.to === undefined ? '保持至今' : `${yearAt(e.to, era)}被${nameAt(e.by!, e.to, e.at)}${k === 'city' ? '超过' : '刷新'}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RecordsPage({ civ }: { civ: Civ | null }) {
  const year = useYear(civ);
  const { era } = useEdits();
  const narrow = useNarrow();
  const [open, setOpen] = useState<RecordKey | null>(null);
  const [copied, setCopied] = useState(false);
  const ok = !!civ && civ.viable && civ.polities.length > 0;
  const book = useMemo(() => (ok ? recordBook(civ!) : null), [ok, civ]);
  const recs = useMemo(() => (book ? recordsAt(book, year) : null), [book, year]);
  const own = useMemo(() => (ok ? ownersAt(civ!, year) : null), [ok, civ, year]);
  if (!civ) return <div className="ov-empty">正在生成世界</div>;
  if (!ok || !book || !recs || !own) return <div className="ov-empty">这颗星球上还没有文明</div>;
  const owner = (r: number) => own.polity[r] ?? -1;
  const lines = new Map<RecordKey, Line>();
  for (const [k, r] of recs) if (r) lines.set(k, lineOf(civ, r, year, era, owner));

  const copy = async () => {
    const out = [`世界之最 · 到${spaced(yearAt(year, era))}为止 · ${seedTag(civ.seed)}`, ''];
    for (const g of RECORD_GROUPS) {
      out.push(g.name);
      for (const k of g.keys) {
        const l = lines.get(k);
        const r = recs.get(k);
        if (!l || !r) {
          out.push(`${RECORD_TITLE[k]}：${RECORD_NONE[k]}`);
          continue;
        }
        const tail = [l.since + (l.fresh ? '（新纪录）' : ''), l.note, r.count > 1 ? `历来 ${r.count} 任` : ''].filter(Boolean).join('，');
        out.push(`${RECORD_TITLE[k]}：${l.name}${l.sub ? `（${l.sub}）` : ''}，${l.value}${l.when ? `，${l.when}` : ''}；${tail}`);
      }
      out.push('');
    }
    const text = out.join('\n').trim();
    (window as unknown as { __wfRecordsText: string }).__wfRecordsText = text;
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const toggle = (k: RecordKey) => setOpen((o) => (o === k ? null : k));
  const keyGo = (f: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      f();
    }
  };
  const histLink = (k: RecordKey, r: RecordAt): ReactNode =>
    r.count > 1 ? (
      <button
        className="ov-link rec-hist-btn"
        type="button"
        data-act="record-history"
        aria-expanded={open === k}
        onClick={(e) => {
          e.stopPropagation();
          toggle(k);
        }}
      >
        历来 {r.count} 任 {open === k ? '⌃' : '›'}
      </button>
    ) : null;
  const pill = <i className="rec-pill">新纪录</i>;

  const row = (k: RecordKey): ReactNode => {
    const r = recs.get(k);
    const l = lines.get(k);
    if (!r || !l)
      return narrow ? (
        <div key={k} className="rec-item rec-none" data-key={k}>
          <div className="rec-t">{RECORD_TITLE[k]}</div>
          <div className="rec-l">
            <b className="ov-name">{RECORD_NONE[k]}</b>
          </div>
        </div>
      ) : (
        <div key={k} className="ov-tr ov-row rec-row rec-none" data-key={k}>
          <span className="rec-title">{RECORD_TITLE[k]}</span>
          <span className="rec-who">
            <b className="ov-name">{RECORD_NONE[k]}</b>
          </span>
          <span className="num rec-val">—</span>
          <span />
          <span />
          <span />
        </div>
      );
    const act = () => go(civ, r.ref, year);
    const mark = <Mark civ={civ} r={r} y={year} owner={owner} />;
    const cls = `${l.fresh ? ' rec-new' : ''}${open === k ? ' open' : ''}`;
    const common = { 'data-key': k, role: 'button', tabIndex: 0, title: goTitle(r.ref), onClick: act, onKeyDown: keyGo(act) };
    if (narrow)
      return (
        <div key={k}>
          <div className={`rec-item${cls}`} {...common}>
            <div className="rec-t">{RECORD_TITLE[k]}</div>
            <div className="rec-l">
              {mark}
              <b className="ov-name">{l.name}</b>
              <span className="rec-val">{l.value}</span>
            </div>
            <div className="rec-s">{[l.sub, l.when].filter(Boolean).join('，')}</div>
            <div className="rec-s">
              {l.since}
              {l.fresh && pill}
              {l.note && `，${l.note}`} {histLink(k, r)}
            </div>
          </div>
          {open === k && <History civ={civ} k={k} y={year} era={era} book={book} />}
        </div>
      );
    return (
      <div key={k}>
        <div className={`ov-tr ov-row rec-row${cls}`} {...common}>
          <span className="rec-title">{RECORD_TITLE[k]}</span>
          <span className="rec-who">
            {mark}
            <b className="ov-name">{l.name}</b>
            {l.sub && <span className="ov-sub rec-sub">{l.sub}</span>}
          </span>
          <span className="num rec-val">{l.value}</span>
          <span className="ov-years rec-when">{l.when}</span>
          <span className="rec-since">
            {l.since}
            {l.fresh && pill}
            {l.note && <em>{l.note}</em>}
          </span>
          <span className="rec-hist">{histLink(k, r)}</span>
        </div>
        {open === k && <History civ={civ} k={k} y={year} era={era} book={book} />}
      </div>
    );
  };

  return (
    <section className={`chronicle rec${narrow ? ' ph' : ''}`}>
      <div className="chron-filters">
        <span className="rec-at">
          到{/^\d/.test(yearAt(year, era)) ? ' ' : ''}
          <b>{yearAt(year, era)}</b>为止的纪录；拨时间轴，纪录跟着变
        </span>
        <span className="chron-acts">
          <button className="ov-btn chron-copy" data-act="records-copy" onClick={() => void copy()} title="把这一页的纪录复制成纯文本">
            {copied ? '已复制' : '复制全文'}
          </button>
        </span>
      </div>
      <div className="rec-list">
        {!narrow && (
          <div className="ov-tr ov-th">
            <span>纪录</span>
            <span>保持者</span>
            <span className="num">多少</span>
            <span>年份</span>
            <span>保持自</span>
            <span />
          </div>
        )}
        {RECORD_GROUPS.map((g) => {
          const n = g.keys.filter((k) => recs.get(k)).length;
          const total = g.keys.length;
          return (
            <div key={g.name} className="pp-sect">
              <div className="pp-group">
                <b>{g.name}</b>
                <span>{n === total ? `${n} 条` : n === 0 ? `${total} 条都还没有` : `${n} 条，${total - n} 条还没有`}</span>
              </div>
              {g.keys.map(row)}
            </div>
          );
        })}
      </div>
    </section>
  );
}
