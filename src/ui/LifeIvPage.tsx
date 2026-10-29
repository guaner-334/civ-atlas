/**
 * 人物卡「一生」一段经历旁点「进推演…」:卡片换成这一页,选一种现成的干预(lifeIv.ts 文件头)。
 *
 *   顶上    这段经历进推演，选一种:那段经历(年份 + 他写的那句话),"只列这一年对他能做的；选了打开那一页，年份、国家照这段经历先填好。"
 *   他本人  即位 / 自立 / 为将(写他那年的国家)/ 出征 / 为臣 / 掌权,一行一种、右边「›」
 *   国家的事，记在他名下  结盟(编年史写"(林小满之议)")、立约、划中立地、迁都、划州、灭国、立国、方针、天灾、大迁徙,一行一种(矮一些)
 *   先不能进推演  议和、称臣、改朝换代、民变 / 联姻 / 他的生死:灰着写原因
 *   底部    "拜师、著书、游历这类纯个人的事不进推演……";返回
 * 那一年对他做不了的(他还没出生、已去世、不满 16 岁、历史还没推到、他那年没有国家)变淡、说明换成原因(同国家干预页的命令行)。
 */
import type { KeyboardEvent } from 'react';
import type { Civ } from '../gen/civ/types';
import type { LifeEntry, AuthorCharacter } from '../gen/characters';
import { heOrShe } from '../gen/civ/gender';
import { spaced, yearAt, yearShort } from '../gen/era';
import { useEra } from './editsStore';
import { nameAt } from './Interventions';
import { LIFE_NATION, LIFE_OFF, LIFE_SELF, type LifeSelfKind } from './lifeIv';
import type { LifeNationKind } from './lifeTag';
import './newIv.css';

/** 当将领、名臣、掌权、出征的人要到这么多岁(同 AuthorIvPages.tsx) */
const AGE = 16;

export function LifeIvPage({
  civ,
  c,
  e,
  polity,
  region,
  onSelf,
  onNation,
  onBack,
}: {
  civ: Civ;
  c: AuthorCharacter;
  e: LifeEntry;
  /** 他那年的国家(lifeIv.ts 的 lifePolity;没有 = −1) */
  polity: number;
  /** 划州、立国用哪一州(这段经历写的在哪,没写 = 他那年的国家的国都所在州;没有 = −1) */
  region: number;
  onSelf: (k: LifeSelfKind) => void;
  onNation: (k: LifeNationKind) => void;
  onBack: () => void;
}) {
  const era = useEra();
  const he = heOrShe(c);
  const y = e.year;
  const P = polity >= 0 ? civ.polities[polity] : undefined;
  // 他本人:那年在世、(将相掌权出征)满 16 岁;历史推到了
  const last = Math.ceil(civ.endYear) - 1;
  const life = (adult: boolean): string | null => {
    if (y > last) return `历史只推到${spaced(yearAt(Math.floor(civ.endYear), era))}`;
    if (y < c.born) return `${he}${yearAt(c.born, era)}才出生`;
    if (c.died !== undefined && y >= c.died) return `${he}${yearAt(c.died, era)}已经去世`;
    if (adult && y - c.born < AGE) return `${he}那一年不满 ${AGE} 岁`;
    return null;
  };
  const noLand = `${he}那年没有国家（人物卡上${he}的国家那年不在）`;
  const selfWhy = (k: LifeSelfKind): string | null => {
    const w = life(k !== 'crown' && k !== 'found');
    if (w) return w;
    if (k === 'found' && region < 0) return '这段经历没写在哪，人物卡上也没有出生地';
    return null;
  };
  const nationWhy = (k: LifeNationKind): string | null => {
    if (y > last) return `历史只推到${spaced(yearAt(Math.floor(civ.endYear), era))}`;
    if (k === 'cede' || k === 'found') return region < 0 ? `这段经历没写在哪，${he}那年也没有国家` : null;
    return P ? null : noLand;
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    onBack();
  };
  const row = (key: string, name: string, desc: string, off: string | null, go: () => void) => (
    <button key={key} className={`cp-cmd${off ? ' off' : ''}`} data-life-kind={key} disabled={!!off} onClick={go}>
      <span className="cp-cmd-main">
        <span className="cp-cmd-name">{name}</span>
        {(off ?? desc) && <span className="cp-cmd-desc">{off ?? desc}</span>}
      </span>
      {!off && <span className="cp-cmd-go">›</span>}
    </button>
  );
  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-life-iv="pick">
        <div className="cp-form">
          <span className="cp-form-title">这段经历进推演，选一种</span>
          <div className="as-entry">
            <span className={`cp-ev-year${era ? ' era' : ''}`}>{yearShort(y, era)}</span>
            <span>{e.text || '（没写经历）'}</span>
          </div>
          <span className="cp-note">只列这一年对{he}能做的；选了打开那一页，年份、国家照这段经历先填好。</span>
        </div>
        <div className="as-cmd-title">{he}本人</div>
        <div className="cp-cmds" data-life-iv="self">
          {LIFE_SELF.map((r) =>
            row(r.k, r.name, r.k === 'general' && P ? `${r.desc(he)}（${he}那年的国家：${nameAt(P, y)}）` : r.desc(he), selfWhy(r.k), () => onSelf(r.k)),
          )}
        </div>
        <div className="as-cmd-title">国家的事，记在{he}名下</div>
        <div className="cp-cmds as-cmds-compact" data-life-iv="nation">
          {LIFE_NATION.map((r) => row(`nation-${r.k}`, r.name, r.k === 'ally' ? `编年史写「（${c.name}之议）」，推演照普通的干预` : '', nationWhy(r.k), () => onNation(r.k)))}
        </div>
        <div className="as-cmd-title">先不能进推演</div>
        <div className="cp-cmds" data-life-iv="off">
          {LIFE_OFF.map((r, i) => (
            <div key={i} className="cp-cmd off">
              <span className="cp-cmd-main">
                <span className="cp-cmd-name">{r.name(he)}</span>
                <span className="cp-cmd-desc">{r.why(he)}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="cp-note cr-pick-note">拜师、著书、游历这类纯个人的事不进推演，照旧能勾推演里的事。</div>
      </div>
      <div className="cp-foot">
        <button className="cp-btn wide" data-act="life-iv-back" onClick={onBack}>
          返回
        </button>
      </div>
    </div>
  );
}
