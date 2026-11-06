/**
 * 推不下去(Civ.stuck):地图盖一层浅白、中间一张卡说停在哪年、可能是哪两项太极端,和时间轴上顶替「再推」的「推不下去」。
 * 卡和并排试推那张是同一个样子(compare/ComparePage.tsx 的 FailCard),挑可疑项同样用 rules/suspects.ts。
 * 说法按这次怎么推的(stuckStore 的 why)和世界用的规则分:我的规则(能改回官方、另存一份重推)、别人分享的(只能看)、官方规则(程序的毛病)。
 */
import { useEffect } from 'react';
import type { Civ } from '../gen/civ/types';
import { useCivTime } from './civView';
import { getEdits, removeIntervention, useEdits } from './editsStore';
import { Icon } from './icons';
import { redoWithRules } from './newCivAction';
import { findMyRules, myRulesFor, setRuleValue, useMyRules } from './rulesStore';
import { openRulesSheet } from './rules/sheetStore';
import { suspectItems, type Suspect } from './rules/suspects';
import { currentWorld, useSavesVersion } from './saveStore';
import { showToast } from './Toast';
import { openDiag } from './DiagDialog';
import { closeStuck, openStuck, useStuck, type StuckWhy } from './stuckStore';
import './stuck.css';

interface CardButton {
  label: string;
  act: string;
  primary?: boolean;
  onClick: () => void;
}

interface CardText {
  title: string;
  text: string;
  buttons: CardButton[];
}

/** 卡上的字和按钮 */
function cardOf(civ: Civ, why: StuckWhy | null): CardText {
  const at = civ.stuck!.at;
  const stop = Math.floor(civ.endYear);
  const e = getEdits();
  const rules = e.rules;
  const cur = currentWorld();
  const worldId = cur?.kind === 'created' ? cur.id : undefined;
  const list: Suspect[] = rules ? suspectItems(rules.values, 2) : [];
  const both = list.length > 1;
  const official = !list.length;
  const mine = rules && worldId ? myRulesFor(rules)?.mine : undefined;
  const look: CardButton = { label: why?.kind === 'extend' ? '先看推出来的' : '先看前面的历史', act: 'stuck-look', onClick: closeStuck };

  if (why?.kind === 'extend') {
    const head = `第 ${why.from} 年以前的历史不变，新推出来的 ${stop - why.from} 年照样能看。`;
    const mid = official ? '世界用的是官方规则，多半是程序的毛病，不是你做错了' : `可能是${who(list)}太极端`;
    return {
      title: `再推到第 ${at} 年推不下去了`,
      text: `${head}${mid}；不要这一段的话，可以撤销这次再推。`,
      buttons: [
        {
          label: '撤销这次再推',
          act: 'stuck-undo-extend',
          onClick: () => {
            closeStuck();
            why.undo();
          },
        },
        { ...look, primary: true },
      ],
    };
  }

  const title = `推到第 ${at} 年推不下去了`;
  if (why?.kind === 'iv') {
    const undo: CardButton = {
      label: '撤销这条干预',
      act: 'stuck-undo-iv',
      primary: true,
      onClick: () => {
        closeStuck();
        const i = getEdits().interventions.findIndex((x) => JSON.stringify(x) === JSON.stringify(why.iv));
        if (i >= 0) removeIntervention(i);
      },
    };
    const tail = '前面的历史照样能看；撤销这条干预，就回到原来那段历史。';
    const text = official
      ? `加上刚下的「${why.label}」，推到这一年算不下去了。世界用的是官方规则，多半是程序的毛病，不是你做错了。${tail}`
      : `可能是${who(list, false)}太极端，加上刚下的「${why.label}」，这一年算不下去了。${tail}`;
    return { title, text, buttons: [look, undo] };
  }

  const saved = worldId ? '世界已经存好，' : '';
  if (official) {
    return {
      title,
      text: `世界用的是官方规则，这是程序的毛病，不是你做错了。世界停在第 ${stop} 年，前面的历史照样能看。出错的经过记在「更多 › 问题记录」里，下载下来发给我们，能帮着修好。`,
      buttons: [{ label: '问题记录', act: 'stuck-diag', onClick: openDiag }, { ...look, primary: true }],
    };
  }
  const first = `可能是${who(list)}太极端，这一年算不下去了。${saved}停在第 ${stop} 年，前面的历史照样能看`;
  if (mine && worldId) {
    const n = both ? '两' : '一';
    return {
      title,
      text: `${first}；把这${n}项改回官方，另存一份重推，这个世界不变。`,
      buttons: [look, { label: `这${n}项改回官方，另存一份重推`, act: 'stuck-revert', primary: true, onClick: () => revert(mine.rules.id, worldId, list, stop) }],
    };
  }
  return {
    title,
    text: `${first}。`,
    buttons: [{ label: '看规则', act: 'stuck-rules', onClick: () => rules && openRulesSheet({ kind: 'world', rules, ...(worldId ? { worldId } : {}) }) }, { ...look, primary: true }],
  };
}

/** 「A」和「B」放在一起(together = false:不带"放在一起");只有一项 =「A」 */
function who(list: readonly Suspect[], together = true): string {
  if (list.length < 2) return `「${list[0]?.text ?? ''}」`;
  return `「${list[0].text}」和「${list[1].text}」${together ? '放在一起' : ''}`;
}

/** 我的规则里那一套这几项改回官方(用过的再改,版本加一),照它进「打造文明」另存一份重推;停住的这个世界不动 */
function revert(rulesId: string, worldId: string, list: readonly Suspect[], stop: number) {
  closeStuck();
  for (const s of list) setRuleValue(rulesId, s.id, undefined);
  const now = findMyRules(rulesId);
  if (!now) return;
  redoWithRules(worldId, now.rules);
  showToast({
    id: 'stuck-redo',
    kind: 'ok',
    dot: true,
    text: `「${now.rules.name}」这${list.length > 1 ? '两' : '一'}项改回了官方，存成第 ${now.rules.version} 版`,
    more: [`点「开始推演」另存一份重推；停在第 ${stop} 年的那个世界不变。`],
    ttl: 8000,
  });
}

/** 盖在地图上的浅白和中间那张卡;刚算出来的那一次等时间轴停在停住那年时自动弹。busy = 还在推(新的历史还没到),先不弹 */
export function StuckCard({ civ, phone, busy }: { civ: Civ | null; phone: boolean; busy: boolean }) {
  const st = useStuck();
  const t = useCivTime();
  // 规则、世界、我的规则变了,卡上的说法跟着变
  useEdits();
  useMyRules();
  useSavesVersion();
  const stuck = civ?.stuck;
  const end = civ?.endYear ?? 0;
  useEffect(() => {
    if (st.pending && stuck && !busy && !t.playing && (t.year === null || t.year >= end)) openStuck();
  }, [st.pending, stuck, busy, end, t.playing, t.year]);
  useEffect(() => {
    if (!st.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeStuck();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st.open]);
  if (!st.open || !civ || !stuck || busy) return null;
  const c = cardOf(civ, st.why);
  return (
    <div className={`stuck-layer${phone ? ' ph' : ''}`}>
      <div className="stuck-dim" aria-hidden="true" />
      <div className="stuck-box">
        <div className="stuck-card" role="alert" data-act="stuck-card">
          <h4>
            <Icon name="warn" size={phone ? 18 : 20} />
            {c.title}
          </h4>
          <p>{c.text}</p>
          <div className="stuck-bs">
            {c.buttons.map((b) => (
              <button key={b.act} className={`stuck-btn${b.primary ? ' pri' : ''}`} data-act={b.act} onClick={b.onClick}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 时间轴尽头顶替「再推」的「推不下去」(手机上是警示的圆按钮):点了再看那张卡 */
export function StuckButton({ civ, phone }: { civ: Civ; phone: boolean }) {
  const tip = `推到第 ${civ.stuck?.at ?? Math.floor(civ.endYear)} 年推不下去了，点了看为什么`;
  return (
    <button
      className={`xt-btn stuck${phone ? ' phone' : ''}`}
      data-act="stuck"
      aria-label={phone ? tip : undefined}
      data-tip={phone ? undefined : tip}
      data-tip-side="above"
      onClick={openStuck}
    >
      <Icon name="warn" size={phone ? 16 : 14} />
      {!phone && '推不下去'}
    </button>
  );
}
