/**
 * 概览的「大纲」页(格式见 gen/edits.ts 文件头"大纲";照大纲推演见 gen/outline.ts):作者先有的故事,一条条情节。
 *
 *   没写大纲   一段说明、「加第一条情节」,下面一行灰的例子(按这个世界此刻最大的国家写)
 *   写好了     上面一句说明、「找更合的世界」(照这份大纲去照故事找世界,App 接)「加一条情节」「照大纲推演」(推过了:「再照大纲推演」;
 *              正在推:「停下」);推过了多一排按结果筛。大纲从别的世界搬过来、有对不上的几项:那几项写原来叫什么(橙色),结果一格「要重新指」
 *              一张表:把手(拖动排序)、第几条、时间、谁、发生什么、你写的那句、结果(推过了写明怎么样)、「⋯」(在上面 / 下面加一条、复制、删除)
 *              还没推过:点一行 = 编这一行(右边滑出一栏,OutlineEditor.tsx);推过了:点一行 = 到地图上那一年、那个地方看(「⋯」里改这一条)
 * 手机(OutlinePhone):不要概览的头和页签,整页是大纲 ——「‹ 世界」「大纲 N 条」放大镜(找更合的世界,有大纲才有)「+」,
 *              一条一张卡片,底下「照大纲推演」;编一条换成整页。
 *              推过了点一张卡片到地图上看,卡片右边一支笔改这一条。
 * 在地图上点东西(编一行时)的那一会儿概览收起,点完、取消回到这一页(useOutlinePickReturn)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { polityAlive } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/engine/timeline';
import { yearAt, eraText, yearShort } from '../gen/era';
import type { Intervention, Plot, PlotReview, PlotStatus } from '../gen/edits';
import { useEdits } from './editsStore';
import { getCivHighlight, getCivTime, setCivHighlight } from './civView';
import { dismissOverview, openOverview } from './overviewStore';
import { askOutline, editPlot, findForOutline, setOutlineFilter, stopOutline, useOutlineUi } from './outlineStore';
import { usePolityPick, interventionText, nameAt } from './Interventions';
import { MenuItem, MenuSep, PopMenu } from './PopMenu';
import { Icon } from './icons';
import { rgb } from './panelParts';
import { STATUS_NAMES, countsText, needsFound, resultText, reviewCounts, timeCell, whatCell, whoCell, whoLine, type OutlineCtx } from './outlineInfo';
import { PlotStatusTag, goToPlot, plotLine, useOutlineCtx } from './OutlineSide';
import { OUTLINE_PICK, OutlineEditor, copyPlot, deletePlot, movePlot, newDraft } from './OutlineEditor';
import './outline.css';

/** 在地图上点完、取消了(提示条收起):回到「大纲」页接着编 */
export function useOutlinePickReturn() {
  const pk = usePolityPick();
  const was = useRef(pk);
  useEffect(() => {
    const prev = was.current;
    was.current = pk;
    if (prev?.source !== OUTLINE_PICK || pk?.source === OUTLINE_PICK) return;
    // 圈州时涂着的州(一直亮着的那种):「好了」、取消、按 Esc 都收掉
    if (getCivHighlight()?.steady) setCivHighlight(null);
    openOverview('outline');
  }, [pk]);
}

const STATUS_ORDER: PlotStatus[] = ['natural', 'guided', 'forced', 'failed', 'story'];

/** 干预的说法(硬改结果里用) */
const ivBase = (civ: Civ) => (v: Intervention, i: number) => interventionText(civ, v, i);

/** 大纲搬过来以后对不上、要重新指的章 */
function RedoTag() {
  return (
    <span className="ol-st redo" data-status="redo">
      <Icon name="warn" size={13} />
      要重新指
    </span>
  );
}

/** 结果那一格 */
function ResultCell({ o, p, r, list, era, onFound }: { o: OutlineCtx; p: Plot; r: PlotReview | undefined; list: readonly Intervention[]; era: ReturnType<typeof useEdits>['era']; onFound: () => void }) {
  if (!r && p.redo)
    return (
      <>
        <RedoTag />
        <small>点这一条重新指</small>
      </>
    );
  if (!r) return <PlotStatusTag s="todo" />;
  return (
    <>
      <PlotStatusTag s={r.status} />
      <small>
        {eraText(resultText(o, p, r, list, ivBase(o.civ)), era)}
        {needsFound(r, p) && (
          <>
            {' '}
            <button
              className="ol-link"
              data-act="outline-found"
              onClick={(e) => {
                e.stopPropagation();
                onFound();
              }}
            >
              想要它在：{o.plots.indexOf(p) > 0 ? `在第 ${o.plots.indexOf(p)} 条后面` : '在前面'}加一条「立国」
            </button>
          </>
        )}
      </small>
    </>
  );
}

/** 谁那一格 */
function WhoCell({ o, p }: { o: OutlineCtx; p: Plot }) {
  const w = whoCell(o, p);
  if (!w.parts.length) return <span style={{ color: 'var(--ink-3)' }}>—</span>;
  return (
    <>
      {w.parts.map((x, i) => (
        <span key={i}>
          {i > 0 && <span className="ar">{w.sep}</span>}
          {i === 0 && x.color && <i className="ol-sw" style={{ background: rgb(x.color) }} />}
          {x.redo ? (
            <span className="ol-redo" title="原来那个世界里的名字：大纲搬过来以后对不上，要重新指">
              {x.text}
            </span>
          ) : (
            x.text
          )}
        </span>
      ))}
      {w.small && <small className={w.smallRedo ? 'ol-redo' : undefined}>{w.small}</small>}
    </>
  );
}

/** 没写大纲时表下面那一行灰的例子:按这个世界此刻最大的国家写 */
function useExample(civ: Civ | null): { year: number; who: string; short: string } | null {
  return useMemo(() => {
    if (!civ || !civ.viable) return null;
    const y = Math.floor(getCivTime().year ?? civ.endYear / 2);
    const owners = ownersAt(civ, y);
    const n = new Map<number, number>();
    for (let r = 0; r < civ.regions.count; r++) if (owners.polity[r] >= 0) n.set(owners.polity[r], (n.get(owners.polity[r]) ?? 0) + 1);
    let best = -1;
    for (const [q, k] of n) if (polityAlive(civ.polities[q], y) && (best < 0 || k > (n.get(best) ?? 0))) best = q;
    if (best < 0) return null;
    const who = nameAt(civ.polities[best], y);
    const short = who.replace(/(王朝|帝国|王国|汗国|皇朝|公国|共和国|联邦|部落|部|国)$/, '') || who;
    return { year: y, who, short };
  }, [civ]);
}

/** 「⋯」菜单 */
function RowMenu({ plots, i, reviewed, onEdit }: { plots: readonly Plot[]; i: number; reviewed: boolean; onEdit: () => void }) {
  const civYear = () => plots[i].year;
  return (
    <PopMenu className="ol-more" icon={<Icon name="more" size={16} />} title="更多" act="outline-row-more" align="right">
      {reviewed && (
        <>
          <MenuItem act="outline-edit" onClick={onEdit}>
            改这一条
          </MenuItem>
          <MenuSep />
        </>
      )}
      <MenuItem act="outline-add-above" onClick={() => editPlot({ id: newId(plots), year: civYear() }, i)}>
        在上面加一条
      </MenuItem>
      <MenuItem act="outline-add-below" onClick={() => editPlot({ id: newId(plots), year: civYear() }, i + 1)}>
        在下面加一条
      </MenuItem>
      <MenuItem act="outline-copy" onClick={() => copyPlot(plots, i)}>
        复制这一条
      </MenuItem>
      <MenuSep />
      <MenuItem act="outline-delete-row" onClick={() => deletePlot(plots, i)}>
        删除这一条
      </MenuItem>
    </PopMenu>
  );
}
const newId = (plots: readonly Plot[]) => Math.max(0, ...plots.map((p) => p.id)) + 1;

export function OutlinePage({ civ }: { civ: Civ | null }) {
  const edits = useEdits();
  const era = edits.era;
  const { run, edit, filter } = useOutlineUi();
  const o = useOutlineCtx(civ);
  const plots = edits.outline?.plots ?? [];
  const ex = useExample(civ);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  if (!civ) return <div className="ol-page ov-empty">正在生成世界</div>;
  const addFirst = () => editPlot(newDraft(civ, plots), plots.length);
  if (!plots.length || !o)
    return (
      <>
        <div className="ol-page" data-testid="outline-page">
          <div className="ol-empty-page" data-empty="outline">
            <h3>还没有大纲</h3>
            <p>
              先有故事、想让世界照着它走？一条条写下故事里的大事：哪一年、谁、发生什么，再写一句你想让观众看到的话。
              <br />
              点「照大纲推演」，世界照常往下推，推完逐条看有没有发生；没发生的在那一年直接改过来，并标出来。
            </p>
            <div className="ol-acts">
              <button className="ol-btn small primary" data-act="outline-add-first" onClick={addFirst}>
                <Icon name="plus" size={15} />
                加第一条情节
              </button>
            </div>
          </div>
          {ex && (
            <table className="ol-tbl" style={{ marginTop: 26 }}>
              <colgroup>
                <col style={{ width: 22 }} />
                <col style={{ width: 26 }} />
                <col style={{ width: 118 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 158 }} />
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 34 }} />
              </colgroup>
              <thead>
                <tr>
                  <th />
                  <th />
                  <th>时间</th>
                  <th>谁</th>
                  <th>发生什么</th>
                  <th>你写的那句（导播字幕）</th>
                  <th>结果</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr className="ex">
                  <td />
                  <td className="n">例</td>
                  <td className="yr">
                    {yearAt(ex.year, era)}前后<small>前后 10 年</small>
                  </td>
                  <td className="who">{ex.who}</td>
                  <td className="what">
                    占据一片地方<small>北方</small>
                  </td>
                  <td className="quote">{ex.short}挥师北上，尽有北方。</td>
                  <td />
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </div>
        {edit && <OutlineEditor civ={civ} />}
      </>
    );
  const review = o.review;
  const byId = new Map((review ?? []).map((r) => [r.id, r]));
  const reviewed = !run && !!review?.length;
  const n = reviewCounts(review);
  const list = edits.interventions;
  const rows = plots.map((p, i) => ({ p, i, r: byId.get(p.id) })).filter((x) => !reviewed || filter === 'all' || x.r?.status === filter);
  const redo = plots.filter((p) => p.redo).length;
  const lead = run ? (
    <>
      <b>正在照大纲推演。</b>第 {Math.min(run.total, run.done + 1)} / {run.total} 条，查完的标在结果里。算的时候地图照样能拖、能点。
    </>
  ) : reviewed ? (
    <>
      <b>照大纲推演过了。</b>
      {countsText(n, true)}。点一条，到地图上那一年、那个地方看。
    </>
  ) : redo ? (
    <>
      <b>大纲从原来的世界搬过来了。</b>
      故事里的国家换成了找到的那几国；{redo} 条有对不上的国家、地方或人物，标着「要重新指」，点一条重新指。
    </>
  ) : (
    '一条条写下故事里的大事：哪一年、谁、发生什么。点「照大纲推演」，世界照常往下推，推完逐条看有没有发生；没发生的在那一年直接改过来，并标出来。大纲没写到的地方照常发生。'
  );
  const add = () => editPlot(newDraft(civ, plots), plots.length);
  const foundAfter = (i: number) => editPlot({ id: newId(plots), year: plots[i].year, kind: 'found' }, i);
  return (
    <>
      <div className="ol-page" data-testid="outline-page">
        <div className="ol-top">
          <div className="ol-lead">{lead}</div>
          <button className="ol-btn small" data-act="outline-find-world" disabled={!!run} onClick={findForOutline}>
            <Icon name="search" size={15} />
            找更合的世界
          </button>
          <button className="ol-btn small" data-act="outline-add" onClick={add}>
            <Icon name="plus" size={15} />
            加一条情节
          </button>
          {run ? (
            <button className="ol-btn small" data-act="outline-stop" onClick={stopOutline}>
              停下
            </button>
          ) : (
            <button className="ol-btn small primary" data-act="outline-run" onClick={askOutline}>
              {review?.length ? '再照大纲推演' : '照大纲推演'}
            </button>
          )}
        </div>
        {reviewed && (
          <div className="ol-chips" role="tablist">
            <button className={`ol-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setOutlineFilter('all')}>
              全部<em>{plots.length}</em>
            </button>
            {STATUS_ORDER.filter((s) => n[s]).map((s) => (
              <button key={s} className={`ol-chip${filter === s ? ' on' : ''}`} data-status={s} onClick={() => setOutlineFilter(s)}>
                {STATUS_NAMES[s]}
                <em>{n[s]}</em>
              </button>
            ))}
          </div>
        )}
        <table className="ol-tbl" data-testid="outline-table">
          <colgroup>
            <col style={{ width: 22 }} />
            <col style={{ width: 26 }} />
            <col style={{ width: 112 }} />
            <col style={{ width: 176 }} />
            <col style={{ width: 150 }} />
            <col />
            <col style={{ width: review?.length ? 450 : 120 }} />
            <col style={{ width: 34 }} />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th />
              <th>时间</th>
              <th>谁</th>
              <th>发生什么</th>
              <th>你写的那句（导播字幕）</th>
              <th>{review?.length ? '推完的结果' : '结果'}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, i, r }) => {
              const [t1, t2] = timeCell(o, p, era);
              const [w1, w2, wr] = whatCell(o, p);
              const on = edit?.draft.id === p.id;
              const dz = drag && drag.to === i && drag.from !== i ? (drag.to < drag.from ? ' drop-before' : ' drop-after') : '';
              return (
                <tr
                  key={p.id}
                  className={`ol-tr${on ? ' on' : ''}${drag?.from === i ? ' dragging' : ''}${dz}`}
                  data-plot={p.id}
                  draggable={!reviewed || filter === 'all'}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(p.id));
                    setDrag({ from: i, to: i });
                  }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    if (drag.to !== i) setDrag({ ...drag, to: i });
                  }}
                  onDragEnd={() => setDrag(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag) movePlot(plots, drag.from, drag.to);
                    setDrag(null);
                  }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('.more, button, a')) return;
                    if (reviewed) goToPlot(o, p, r);
                    else editPlot({ ...p });
                  }}
                >
                  <td className="grip" title="拖动排序">
                    <Icon name="grip" size={14} />
                  </td>
                  <td className="n">{i + 1}</td>
                  <td className="yr">
                    {t1}
                    <small>{t2}</small>
                  </td>
                  <td className="who">
                    <WhoCell o={o} p={p} />
                  </td>
                  <td className="what">
                    <b>{w1}</b>
                    {w2 && <small className={wr ? 'ol-redo' : undefined}>{w2}</small>}
                  </td>
                  <td className={`quote${p.text ? '' : ' none'}`}>{p.text || '（没写）'}</td>
                  <td className="res">{run && !r ? run.at === p.id ? <span className="ol-st run"><i className="ol-spin" />正在查</span> : <span className="ol-st wait">等着</span> : <ResultCell o={o} p={p} r={r} list={list} era={era} onFound={() => foundAfter(i)} />}</td>
                  <td className="more">
                    <RowMenu plots={plots} i={i} reviewed={reviewed} onEdit={() => editPlot({ ...p })} />
                  </td>
                </tr>
              );
            })}
            <tr className="add">
              <td />
              <td />
              <td colSpan={6}>
                <button className="ol-link ol-add" data-act="outline-add-row" onClick={add}>
                  <Icon name="plus" size={15} />
                  加一条情节
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {edit && <OutlineEditor civ={civ} />}
    </>
  );
}

/** 手机:整页的大纲 */
export function OutlinePhone({ civ }: { civ: Civ | null }) {
  const edits = useEdits();
  const era = edits.era;
  const { run, edit } = useOutlineUi();
  const o = useOutlineCtx(civ);
  const plots = edits.outline?.plots ?? [];
  if (civ && edit)
    return (
      <div className="ol-ph" role="dialog" aria-label="大纲" data-testid="outline-phone">
        <div className="grab" />
        <OutlineEditor civ={civ} phone />
      </div>
    );
  const review = o?.review;
  const byId = new Map((review ?? []).map((r) => [r.id, r]));
  const reviewed = !run && !!review?.length;
  const n = reviewCounts(review);
  const add = () => civ && editPlot(newDraft(civ, plots), plots.length);
  return (
    <div className="ol-ph" role="dialog" aria-label="大纲" data-testid="outline-phone">
      <div className="grab" />
      <div className="ol-ph-hd">
        <button className="back" data-act="outline-back" onClick={dismissOverview}>
          <Icon name="back" size={16} />
          世界
        </button>
        <b>大纲 {plots.length} 条</b>
        {/* 找更合的世界(电脑大纲页右上那个):大纲至少一条才有,照大纲推演的时候按不了 */}
        {plots.length > 0 && o && (
          <button className="ol-link find" data-act="outline-find-world" aria-label="找更合的世界" title="找更合的世界" disabled={!!run} onClick={findForOutline}>
            <Icon name="search" size={18} />
          </button>
        )}
        <button className="ol-link" data-act="outline-add" aria-label="加一条情节" disabled={!civ} onClick={add}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      <div className="ol-ph-body">
        {!plots.length || !o ? (
          <div className="ol-empty-page" data-empty="outline" style={{ paddingTop: 12 }}>
            <h3>还没有大纲</h3>
            <p>先有故事、想让世界照着它走？一条条写下故事里的大事：哪一年、谁、发生什么。点「照大纲推演」，世界照常往下推，推完逐条看有没有发生；没发生的在那一年直接改过来，并标出来。</p>
            <div className="ol-acts">
              <button className="ol-btn small primary" data-act="outline-add-first" disabled={!civ} onClick={add}>
                <Icon name="plus" size={15} />
                加第一条情节
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="ol-note">
              {run
                ? `正在照大纲推演：第 ${Math.min(run.total, run.done + 1)} / ${run.total} 条。`
                : reviewed
                  ? `${countsText(n)}。点一条到地图上看。`
                  : plots.some((p) => p.redo)
                    ? `大纲从原来的世界搬过来了，${plots.filter((p) => p.redo).length} 条有对不上的，标着「要重新指」。点一条改。`
                    : '点一条改。'}
            </div>
            <div className="ol-card">
              {plots.map((p) => {
                const r = byId.get(p.id);
                const [w1, w2] = whatCell(o, p);
                const y = r && r.status !== 'failed' && r.status !== 'story' ? r.year : p.year;
                const open = () => (reviewed ? goToPlot(o, p, r) : editPlot({ ...p }));
                return (
                  <div
                    key={p.id}
                    className="ol-crow"
                    role="button"
                    tabIndex={0}
                    data-plot={p.id}
                    onClick={open}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
                  >
                    <span className="y">{yearShort(y, era)}</span>
                    <span className="m">
                      <b>{p.text || plotLine(p)}</b>
                      <small>
                        {w1}
                        {w2 ? `，${w2}` : ''}　{whoLine(o, p)}
                      </small>
                      {r ? (
                        <>
                          <PlotStatusTag s={r.status} />
                          {r.status !== 'natural' && <small>{eraText(resultText(o, p, r, edits.interventions, ivBase(o.civ)), era)}</small>}
                        </>
                      ) : (
                        p.redo && <RedoTag />
                      )}
                    </span>
                    {/* 推过了点一条是到地图上看;改这一条(删也在里面)点右边的笔 */}
                    {reviewed && (
                      <button
                        className="ol-ic ed"
                        data-act="outline-card-edit"
                        aria-label="改这一条"
                        title="改这一条"
                        onClick={(e) => {
                          e.stopPropagation();
                          editPlot({ ...p });
                        }}
                      >
                        <Icon name="pen" size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {plots.length > 0 && (
        <div className="ol-ph-ft">
          {run ? (
            <button className="ol-btn" data-act="outline-stop" onClick={stopOutline}>
              停下
            </button>
          ) : (
            <button className={`ol-btn${review?.length ? '' : ' primary'}`} data-act="outline-run" disabled={!civ} onClick={askOutline}>
              {review?.length ? '再照大纲推演' : '照大纲推演'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
