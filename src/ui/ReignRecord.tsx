/**
 * 人物卡「治绩」一段(君主才有,放在「倾向」和「在位时」之间):他在位这些年本国的疆域、人口、战事、钱粮,
 * 另有国号、迁都、城、时代、首创、物产、天灾的才列;一行一项,和「概况」同一种排法,一件一行。
 * 在位不满 3 年的缩成一句。打开卡片时现算(gen/civ/reignRecord.ts),只读推演的结果。
 */
import { Fragment, useMemo } from 'react';
import type { Civ, Person } from '../gen/civ/types';
import type { Era } from '../gen/era';
import { reignRecord } from '../gen/civ/story/reignRecord';
import { Row } from './panelParts';

export function ReignRecord({ civ, x, era }: { civ: Civ; x: Person; era: Era | undefined }) {
  const r = useMemo(() => reignRecord(civ, x, era), [civ, x, era]);
  if (!r) return null;
  return (
    <section className="cp-sec" data-sec="reign-record">
      <div className="cp-sec-head">治绩</div>
      {r.short !== null ? (
        <div className="oc-note">{r.short}</div>
      ) : (
        <div className="cp-grid cp-stats">
          {r.rows.map((row) => (
            <Row key={row.k} k={row.k}>
              {row.lines.map((l, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {l}
                </Fragment>
              ))}
              {row.note && <em className="cp-num-note">{row.note}</em>}
            </Row>
          ))}
        </div>
      )}
    </section>
  );
}
