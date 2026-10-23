/**
 * 推演里的人物卡换上的两张填写页(和让作者的人物即位那一页同一种做法,不弹窗;下的令先进待推演的单子,pendingStore.ts;
 * 推演规则见 gen/edits.ts 的干预"让人物去世""改君主倾向"):
 *
 *   让他去世  君主卡、将领卡、名臣卡「更多」里点开。
 *             哪一年去世(−100 −10 [年份] +10,只能是他在台上的那几年;逐年推演:固定"第 N 年年初(下一步)")、下面一句他原定怎么下台;
 *             君主:一块灰底写"去世 / 继位 / 之后"(下一位照常继位,之后的君主全换一批);
 *             将领、名臣:黄底一句"只改人物卡和编年史里的名字，不改历史",灰底写人物卡、编年史怎么变
 *   改他的倾向  只有那年在位的君主卡上有(「更多」里、倾向右上「改」)。
 *             从哪一年起(到他下台为止)、四条滑条(拖着不算,点「加入」才算;每条下面写原来的数,国家定了方针的写加上方针以后的实际数);
 *             国家定了方针:黄底一句"在他的倾向上再加减"
 *   底部      返回 / 加入待推演(逐年推演写「加入」)
 */
import { Fragment, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Civ, Person, RulerLeanings } from '../gen/civ/types';
import { LEANING_KEYS, LEANING_TEXT } from '../gen/civ/peopleText';
import { personKey, polityKey, type Intervention } from '../gen/edits';
import { eraText, spaced, yearFull, yearShort, yearSpanAt } from '../gen/era';
import { useEra } from './editsStore';
import { useNarrow } from './device';
import { queueIntervention } from './pendingStore';
import { nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { interventionText, nameAt } from './Interventions';
import { YearRow, useYearInput } from './panelParts';
import { leanRows, policyLabel, rulerPolicy } from './policyInfo';
import { deathNote, leaningsThen, personIvRange, personIvWhy, rulerEndText } from './newIvInfo';
import './newIv.css';

export type PersonIvKind = 'death' | 'temper';

export function PersonIvPage({ civ, x, year, kind, onBack }: { civ: Civ; x: Person; year: number; kind: PersonIvKind; onBack: () => void }) {
  const era = useEra();
  const phone = useNarrow();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const { lo, hi } = personIvRange(civ, x);
  const yi = useYearInput(Math.min(Math.max(year, lo), Math.max(lo, hi)), lo, Math.max(lo, hi), clear);
  const y = step ? nextYear(sw) : yi.y;
  const ruler = x.role === 'ruler';
  const P = civ.polities[x.polity];
  // 改倾向:原来的(那一年照的,改过的照改后的)、拖到的;国家那时定的方针
  const base = leaningsThen(x, Math.min(y, civ.endYear)) ?? { expand: 50, war: 50, develop: 50, trade: 50 };
  const [lean, setLean] = useState<RulerLeanings>(() => ({ ...base }));
  const pol = ruler ? rulerPolicy(civ, x, Math.min(y, civ.endYear)) : null;
  const pkey = personKey(civ, x.id);

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!pkey) return '推演里认不出这个人，改不了';
    if (!step && lo > hi) return eraText(personIvWhy(civ, x, Math.ceil(civ.endYear)) ?? '没有能下的年份', era);
    if (!step && !yi.valid) return `${kind === 'death' ? '去世' : '改倾向'}的年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    const w = personIvWhy(civ, x, y);
    return w ? eraText(w, era) : null;
  })();
  const same = kind === 'temper' && LEANING_KEYS.every((k) => lean[k] === base[k]);

  const go = () => {
    if (why || same) return;
    const a = polityKey(civ, x.polity);
    const v: Intervention = kind === 'death' ? { kind: 'death', a, person: pkey, from: y } : { kind: 'temper', a, person: pkey, from: y, leanings: { ...lean } };
    const err = queueIntervention(v, interventionText(civ, v), { self: x.polity, target: null, shown: nameAt(P, y) });
    if (err) return setMsg(err);
    onBack();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onBack();
  };

  const yearBlock = (label: string, note: string) =>
    step ? (
      <StepEffectTime phone={phone} />
    ) : (
      <div className="cp-from">
        <span className="cp-k">{label}</span>
        <YearRow yi={yi} label={label} />
        <span className="cp-note">{note}</span>
      </div>
    );

  let body;
  if (kind === 'death' && ruler) {
    body = (
      <>
        {yearBlock('哪一年去世', deathNote(civ, x, era))}
        <div className="iv-sum" data-iv="death-sum">
          <span>去世</span>
          <span>
            {x.name}，{yearFull(y, era)}，{Math.max(0, Math.floor(y - x.born))} 岁
          </span>
          <span>继位</span>
          <span>下一位照常继位：年纪、在位多久、倾向照常随机</span>
          <span>之后</span>
          <span>他以后的君主全换一批；这年以前的一个不变</span>
        </div>
        {!step && <span className="cp-note iv-tail">逐年推演里固定「下一步年初」去世。</span>}
      </>
    );
  } else if (kind === 'death') {
    const general = x.role === 'general';
    body = (
      <>
        {yearBlock('哪一年去世', deathNote(civ, x, era))}
        <div className="iv-warn" data-iv="history-same">
          只改人物卡和编年史里的名字，不改历史：
          {general ? '这年以后他该领的仗换别的将领出面，打赢打输、国土照旧。' : '这年以后他经手的事换别人去办，国家照旧。'}
        </div>
        <div className="iv-sum" data-iv="death-sum">
          <span>人物卡</span>
          <span>卒年改成 {yearShort(y, era)}，结局写「卒」</span>
          <span>编年史</span>
          <span>{general ? '他以后领兵的几场仗换成别的将领' : '他以后经手的事换成别人'}</span>
        </div>
      </>
    );
  } else {
    const rows = leanRows(lean, pol);
    const warAdd = rows.find((r) => r.k === 'war')?.add ?? 0;
    body = (
      <>
        {yearBlock('从哪一年起', `到他下台为止（${rulerEndText(civ, x, era)}）；下一位照常随机。`)}
        <div className="cp-form" data-iv="temper">
          <span className="cp-form-title cr-ttl">
            他的倾向<em>拖滑条，松手不算，点「加入」才算</em>
          </span>
          <div className="cr-leans">
            {LEANING_KEYS.map((k) => {
              const r = rows.find((q) => q.k === k)!;
              return (
                <Fragment key={k}>
                  <div className="cr-lean" data-leaning={k}>
                    <span className="cr-lean-k">{LEANING_TEXT[k].name}</span>
                    <span className="cr-range">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={lean[k]}
                        aria-label={LEANING_TEXT[k].name}
                        style={{ '--fill': `${lean[k]}%` } as CSSProperties}
                        onChange={(e) => (clear(), setLean({ ...lean, [k]: Number(e.target.value) }))}
                      />
                    </span>
                    <span className="cr-lean-num">{lean[k]}</span>
                  </div>
                  <div className="cr-lean-note">
                    原来 {base[k]}
                    {r.add ? `；加上方针 ${r.add > 0 ? '＋' : '−'}${Math.abs(r.add)} ＝ 实际 ${r.actual}` : ''}
                    {k === 'develop' ? '；推演里暂不起作用' : ''}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
        {pol && (
          <div className="iv-warn" data-iv="temper-policy">
            {nameAt(P, y)}定了方针「{policyLabel(pol)}」，在他的倾向上再加减；{warAdd > 0 ? '想让他少打仗' : warAdd < 0 ? '想让他多打仗' : '想整国换个走向'}，也可以改方针。
          </div>
        )}
      </>
    );
  }

  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-iv-page={kind}>
        {body}
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="person-iv-back" onClick={onBack}>
          返回
        </button>
        <button className="cp-btn primary" data-act="person-iv-go" disabled={!!why || same} onClick={go}>
          {step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}
