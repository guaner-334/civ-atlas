/**
 * 侧栏顶上「照故事找的」一组(照故事找世界「用这个世界」建好的世界才有;记在 foundStore.ts):
 *
 *   照故事找的                                         再找
 *   [帝国] 大月王朝    都霞都，和 4 国接壤              107 州
 *   [山国] 东萨富斯坦汗国 都卡杜沙赫尔，边界两成是翻山    29 州
 *   ⌃ 隘口            米里亚一带，口子 173 米…          标记
 *   ⅄ 三国交界        金霞域，无主                      标记
 *   第 1755 年开场，两国都撑过 130 年。点一行到地图上看；「再找」带着这次的条件回去接着找。
 *
 * 点国家一行选中那国(地图飞过去);点隘口、交界一行选中那个标记(标记删了就只是飞过去看)。
 */
import { setSelection } from './civView';
import { useEdits } from './editsStore';
import { findAgain, useFound } from './foundStore';
import { PlaceGlyph } from './FinderResults';
import { roleClass } from './FinderConds';
import './finder.css';

export function FoundSide({ id }: { id: string | null | undefined }) {
  const pick = useFound(id);
  const edits = useEdits();
  if (!pick) return null;
  const marks = new Set((edits.marks ?? []).map((m) => m.id));
  const who = pick.roles.length === 2 ? '两国都' : pick.roles.length === 3 ? '三国都' : pick.roles.length === 1 ? pick.roles[0].role : '';
  return (
    <section className="sb-sec fd-side-sec" data-testid="found-side">
      <div className="sb-sec-head">
        <span>照故事找的</span>
        <button className="sb-link" data-act="find-again" onClick={() => findAgain(pick)}>
          再找
        </button>
      </div>
      <div className="sb-group">
        {pick.roles.map((r, i) => (
          <button key={`r${i}`} className="sb-row two" data-polity={r.polity} onClick={() => setSelection({ kind: 'polity', id: r.polity })}>
            <span className={`${roleClass(i)} fd-side-tag`}>{r.role}</span>
            <span className="sb-row-main">
              <b>{r.name}</b>
              {r.note && <small>{r.note}</small>}
            </span>
            <span className="sb-row-side">{r.size} 州</span>
          </button>
        ))}
        {pick.places.map((p, k) => {
          const marked = p.mark !== undefined && marks.has(p.mark);
          return (
            <button key={`p${k}`} className="sb-row two" data-act={`found-${p.kind}`} disabled={!marked} onClick={() => marked && setSelection({ kind: 'mark', id: p.mark! })}>
              <span className="fd-side-ic">
                <PlaceGlyph kind={p.kind} size={15} />
              </span>
              <span className="sb-row-main">
                <b>{p.title}</b>
                {p.note && <small>{p.note}</small>}
              </span>
              {marked && <span className="sb-row-side">标记</span>}
            </button>
          );
        })}
        <p className="fd-side-note">
          第 {pick.year} 年开场{pick.span && who ? `，${who}撑过 ${pick.span} 年` : ''}。点一行到地图上看；「再找」带着这次的条件回去接着找。
        </p>
      </div>
    </section>
  );
}
