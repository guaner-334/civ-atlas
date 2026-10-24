/**
 * 灭国那一页:国家干预页点「灭国」,卡片换成这一页(和方针页同一种做法,不弹窗;下的令先进待推演的单子,pendingStore.ts;
 * 推演规则见 gen/edits.ts 的干预"灭国")。
 *
 *   哪一年亡国  −100 −10 [年份] +10,默认干预页的生效年份(逐年推演:固定"第 N 年年初(下一步)",不能加减)
 *   国土归谁    并入一国 | 散成无主
 *     并入一国  默认挑接壤的邻国里州最多的;「换一国」列出那年还在的国家(大的在前,州数、接壤),
 *               「在地图上点」和结盟选对象一样(地图压暗、国家浮出名牌;手机上放在列表底部)
 *     散成无主  国土散成无主的部落地带,邻国照规则慢慢扩进去,"这片地方会空几十年"
 *   推完会怎样  打着的仗当即议和、盟约称臣跟着断、编年史里那一句(手机上只写前两样)
 *   底部        返回 / 加入待推演(逐年推演写「加入」)
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Civ } from '../gen/civ/types';
import { capitalAt, polityAlive } from '../gen/civ/growth';
import { polityKey, type Intervention } from '../gen/edits';
import { spaced, yearAt, yearFull, yearSpanAt } from '../gen/era';
import { useEra } from './editsStore';
import { useNarrow } from './device';
import { queueIntervention } from './pendingStore';
import { nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { defaultYear, getPolityPick, nameAt, setPolityPick, usePolityPick } from './Interventions';
import { YearRow, jumpTo, rgb, useYearInput } from './panelParts';
import { closeCmdPage } from './panelStore';
import { alivePolities } from './crownInfo';
import { destroyDefault, destroyQueueText } from './newIvInfo';
import './newIv.css';

type Mode = 'merge' | 'scatter';

export function DestroyPage({ civ, id, year, from }: { civ: Civ; id: number; year: number; from?: number }) {
  const era = useEra();
  const phone = useNarrow();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const p = civ.polities[id];
  const key = polityKey(civ, id);
  // 亡国年份的范围:立国那年 … 亡国前一年(同干预页)
  const lo = Math.ceil(p.founded);
  const last = Math.ceil(civ.endYear) - 1;
  const hi = Math.max(lo, Math.min(last, p.ended !== undefined ? Math.ceil(p.ended) - 1 : last));
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const yi = useYearInput(from ?? defaultYear(p, year), lo, hi, clear);
  const y = step ? nextYear(sw) : yi.y;
  /** 看国土、邻国用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(y, civ.endYear) : y;
  const name = nameAt(p, y);
  /** 面板标题上的名字(单子、提示条写它,和用户点的那个对得上) */
  const shown = nameAt(p, year);
  const d = useMemo(() => destroyDefault(civ, id, yv), [civ, id, yv]);
  const alive = useMemo(() => alivePolities(civ, yv).filter((x) => x.id !== id), [civ, yv, id]);
  const aliveIds = useMemo(() => new Set(alive.map((x) => x.id)), [alive]);
  const [mode, setMode] = useState<Mode>('merge');
  const [chosen, setChosen] = useState<number | null>(null);
  const [view, setView] = useState<'form' | 'list'>('form');
  const bid = chosen !== null && aliveIds.has(chosen) ? chosen : d.b >= 0 ? d.b : null;
  const B = bid !== null ? civ.polities[bid] : undefined;
  const cap = useMemo(() => {
    const c = capitalAt(p, yv);
    return c >= 0 ? civ.settlements[c]?.name || '' : '';
  }, [civ, p, yv]);

  // 在地图上点并入哪一国(地图压暗、国家浮出名牌,Esc 取消);离开这一页时收起
  const source = `destroy:${id}`;
  const pk = usePolityPick();
  const picking = pk?.source === source;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const pickPolity = () => {
    clear();
    jumpTo(step ? Math.min(y, sw.now) : y);
    setPolityPick({
      prompt: `选${name}的国土并入哪一国`,
      sub: `${yearAt(y, era)}亡国，那年还在的国家都能选`,
      source,
      self: id,
      near: d.near,
      eligible: aliveIds,
      year: yv,
      accept: (q) => {
        if (q === id) return '要选另一个国家';
        if (!aliveIds.has(q)) return `${yearAt(y, era)}这个国家不在`;
        setChosen(q);
        setMode('merge');
        setView('form');
        return null;
      },
    });
  };

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!step && !yi.valid) return `亡国年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    if (!polityAlive(p, y)) return y < p.founded ? `${yearAt(y, era)}还没立国` : `${yearAt(y, era)}已亡`;
    if (mode === 'merge' && !B) return '选一国并入，或者散成无主';
    return null;
  })();

  const go = () => {
    if (why) return;
    const merge = mode === 'merge' && bid !== null;
    const v: Intervention = merge ? { kind: 'destroy', a: key, from: y, b: polityKey(civ, bid) } : { kind: 'destroy', a: key, from: y };
    const err = queueIntervention(v, destroyQueueText(shown, d.n, merge ? nameAt(B!, y) : null), {
      self: id,
      target: merge ? { kind: 'polity', id: bid } : null,
      shown,
    });
    if (err) return setMsg(err);
    closeCmdPage();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    if (view === 'list') setView('form');
    else closeCmdPage();
  };

  if (view === 'list') {
    return (
      <div className="cr-page" onKeyDown={onKey}>
        <div className="cp-body">
          <section className="cp-sec" data-destroy="list">
            <div className="cp-sec-head cp-events-head">
              <span>并入哪一国</span>
              <span className="cp-num-note">
                {yearFull(y, era)}还在的 {alive.length} 国
              </span>
            </div>
            <div className="oc-rows oc-people">
              {alive.map((x) => (
                <button
                  key={x.id}
                  className="oc-person cr-polity"
                  data-polity={x.id}
                  onClick={() => {
                    setChosen(x.id);
                    setView('form');
                  }}
                >
                  <i className="cr-dot lg" style={{ background: rgb(civ.polities[x.id].color) }} />
                  <span className="oc-txt">
                    <b>{x.name}</b>
                    <span>
                      {x.regions} 州{d.near.has(x.id) ? '，接壤' : ''}
                    </span>
                  </span>
                  {x.id === bid && <span className="cr-check">✓</span>}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="cp-foot mk-foot">
          <button className="cp-btn" data-act="destroy-list-back" onClick={() => setView('form')}>
            返回
          </button>
          <button className="cp-btn" data-act="destroy-map" onClick={pickPolity}>
            在地图上点
          </button>
        </div>
      </div>
    );
  }

  const bName = B ? nameAt(B, y) : '';
  const n = `${d.n} 州`;
  const nb = d.b >= 0 ? nameAt(civ.polities[d.b], y) : '';
  const story = mode === 'merge' && B ? `【干预】${name}亡，${n}并入${bName}` : `【干预】${name}亡，${n}散为无主之地`;

  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-destroy="form">
        {step ? (
          <StepEffectTime phone={phone} />
        ) : (
          <div className="cp-from">
            <span className="cp-k">哪一年亡国</span>
            <YearRow yi={yi} label="亡国年份" />
            <span className="cp-note">这年之前的历史不变，之后重新推演。</span>
          </div>
        )}
        <div className="cp-form">
          <span className="cp-form-title">国土归谁</span>
          <div className="cp-dur" role="radiogroup" aria-label="国土归谁">
            <button role="radio" aria-checked={mode === 'merge'} className={mode === 'merge' ? 'on' : ''} data-act="destroy-merge" onClick={() => (setMode('merge'), clear())}>
              并入一国
            </button>
            <button
              role="radio"
              aria-checked={mode === 'scatter'}
              className={mode === 'scatter' ? 'on' : ''}
              data-act="destroy-scatter"
              onClick={() => (setMode('scatter'), clear(), picking && setPolityPick(null))}
            >
              散成无主
            </button>
          </div>
          {mode === 'merge' ? (
            picking ? (
              <>
                <div className="oc-pick picking" data-destroy="pick">
                  <span className="oc-pick-empty">在地图上点一国…</span>
                  <span className="oc-pick-acts">
                    <button className="cp-step" onClick={() => setPolityPick(null)}>
                      取消
                    </button>
                  </span>
                </div>
                <span className="cp-note">那年还在的 {alive.length} 国都浮出了名牌，点名牌或国土都行。</span>
              </>
            ) : (
              <>
                <div className="oc-pick cr-pick iv-pick" data-destroy="polity">
                  {B ? (
                    <span className="oc-pick-name">
                      <i className="cr-dot lg" style={{ background: rgb(B.color) }} />
                      <b>{bName}</b>
                      <span className="cr-after">
                        {alive.find((x) => x.id === bid)?.regions ?? 0} 州{d.near.has(bid!) ? '，接壤' : ''}
                      </span>
                    </span>
                  ) : (
                    <span className="oc-pick-empty">那年没有接壤的国家，换一国</span>
                  )}
                  <span className="oc-pick-acts">
                    <button className="cp-step" data-act="destroy-list" onClick={() => (setView('list'), clear())}>
                      换一国
                    </button>
                    {!phone && (
                      <button className="cp-step" data-act="destroy-map" onClick={pickPolity}>
                        在地图上点
                      </button>
                    )}
                  </span>
                </div>
                {B && (
                  <span className="cp-note">
                    {bid === d.b ? '默认挑接壤的邻国里最强的一个。' : ''}
                    {name} {n}
                    {cap ? `连同国都${cap}` : ''}一并归{bName}。
                  </span>
                )}
              </>
            )
          ) : (
            <span className="cp-note">
              {name} {n}散成无主的部落地带，各族照旧住着；{nb ? `${nb}这些接壤的国家` : '周围的国家'}照规则慢慢扩进去，这片地方会空几十年。
            </span>
          )}
        </div>
        <div className="iv-sum" data-destroy="sum">
          <span>打着的仗</span>
          <span>当即议和</span>
          <span>盟约、称臣</span>
          <span>跟着断</span>
          {!phone && (
            <>
              <span>编年史</span>
              <span>{story}</span>
            </>
          )}
        </div>
        {!phone && <span className="cp-note iv-tail">和「保护」撞上时，后下的为准。</span>}
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="destroy-back" onClick={closeCmdPage}>
          返回
        </button>
        <button className="cp-btn primary" data-act="destroy-go" disabled={!!why || picking} onClick={go}>
          {step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}
