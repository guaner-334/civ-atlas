/**
 * 推不下去(Civ.stuck):地图盖一层浅白、中间一张卡说停在哪年、可能是哪两项太极端,和时间轴上顶替「再推」的「推不下去」。
 * 卡和并排试推那张是同一个样子(compare/ComparePage.tsx 的 FailCard),挑可疑项同样用 rules/suspects.ts。
 * 说法按这次怎么推的(stuckStore 的 why)和世界用的规则分:我的规则(能改回官方、另存一份重推)、别人分享的(只能看)、官方规则(程序的毛病);
 * 推演插件出的错(Civ.stuck.plugin)只说是哪个插件。
 */
import { useEffect } from 'react';
import type { Civ } from '../gen/civ/types';
import { YEAR_TICKS } from '../gen/edits';
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
import { simErrorAt } from './sim/simClient';
import { getSimNow } from './world/simNow';
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
  /** 插件报的错(灰框) */
  box?: { label: string; text: string };
  /** 灰框下面那一句 */
  tail?: string;
  buttons: CardButton[];
}

/** 历史停在第几年(逐年推演停在第 N 年年初的历史推到 N − 1/256,也算第 N 年) */
function stopYear(civ: Civ): number {
  return Math.floor(civ.endYear + 1 / YEAR_TICKS);
}

/** 后台线程没撑住的那张:地图上还有历史就说停在哪年 */
function crashCard(civ: Civ | null, retry: () => void): CardText {
  const head = civ ? `这段历史没推完，停在第 ${stopYear(civ)} 年，前面的历史照样能看。` : '这段历史没推完。';
  return {
    title: '后台算不动了',
    text: `可能是这台设备的内存不够，${head}关掉别的网页再推一次，或者换一台内存大的设备打开这个世界。`,
    buttons: [
      { label: '知道了', act: 'stuck-ok', onClick: closeStuck },
      {
        label: '再推一次',
        act: 'stuck-retry',
        primary: true,
        onClick: () => {
          closeStuck();
          retry();
        },
      },
    ],
  };
}

/** 推演插件出的错:说是哪个插件、第几版(世界记着的;没记写编号),不猜规则里哪几项,也不说是程序的毛病 */
function pluginOf(id: string): { name: string; who: string; sum: string } {
  const p = getSimNow()?.list.find((x) => x.id === id);
  const name = p?.name ?? id;
  return { name, who: `推演插件「${name}」${p ? `第 ${p.version.replace(/^(\d+\.\d+)\.0$/, '$1')} 版` : ''}`, sum: p?.sum ?? '' };
}
const byPlugin = (id: string) => `${pluginOf(id).who}在这一年出了错`;

/** 插件出错时推演里抛的那句:去掉网站加的「推演插件 编号:」;慢的两种另说 */
function pluginError(at: number, id: string): { kind: 'moment' | 'total' | 'error'; text: string } | null {
  const raw = simErrorAt(at);
  if (!raw) return null;
  const head = `推演插件 ${id}:`;
  const text = raw.startsWith(head) ? raw.slice(head.length) : raw;
  if (/这一刻用了 [\d.]+ 秒,超过/.test(text)) return { kind: 'moment', text };
  if (/所有推演插件一共用了 [\d.]+ 秒,超过/.test(text)) return { kind: 'total', text };
  return { kind: 'error', text };
}

/** 「复制给作者」:插件名、第几版、文件指纹、种子、哪一年、那句错 */
function copyForAuthor(civ: Civ, id: string): void {
  const p = pluginOf(id);
  const at = civ.stuck!.at;
  const lines = [p.who, p.sum && `文件指纹 ${p.sum}`, `种子 ${currentWorld()?.params.seed ?? ''}`, `第 ${at} 年推不下去`, simErrorAt(at) ?? ''].filter(Boolean);
  void navigator.clipboard?.writeText(lines.join('\n')).then(
    () => showToast({ id: 'stuck-copy', kind: 'ok', text: '已复制', more: ['发给插件的作者'] }),
    () => showToast({ id: 'stuck-copy', kind: 'warn', text: '没能复制', more: ['浏览器不让复制，打开「问题记录」照着抄'] }),
  );
}

/** 卡上的字和按钮 */
function cardOf(civ: Civ, why: StuckWhy | null): CardText {
  const at = civ.stuck!.at;
  const plugin = civ.stuck!.plugin;
  const stop = stopYear(civ);
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
    const mid = plugin ? byPlugin(plugin) : official ? '世界用的是官方规则，多半是程序的毛病，不是你做错了' : `可能是${who(list)}太极端`;
    const err = plugin ? pluginError(at, plugin) : null;
    return {
      title: `再推到第 ${at} 年推不下去了`,
      text: `${head}${mid}；不要这一段的话，可以撤销这次再推。`,
      ...(err && plugin ? { box: { label: '插件报的错', text: err.text } } : {}),
      buttons: [
        ...(plugin ? [{ label: '复制给作者', act: 'stuck-copy', onClick: () => copyForAuthor(civ, plugin) }] : []),
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
    const text = plugin
      ? `加上刚下的「${why.label}」，${byPlugin(plugin)}。${tail}`
      : official
        ? `加上刚下的「${why.label}」，推到这一年算不下去了。世界用的是官方规则，多半是程序的毛病，不是你做错了。${tail}`
        : `可能是${who(list, false)}太极端，加上刚下的「${why.label}」，这一年算不下去了。${tail}`;
    return { title, text, buttons: [look, undo] };
  }

  const saved = worldId ? '世界已经存好，' : '';
  if (plugin) {
    const err = pluginError(at, plugin);
    const p = pluginOf(plugin);
    const stopped = `世界停在第 ${stop} 年，前面的历史照样能看。`;
    const copy: CardButton = { label: '复制给作者', act: 'stuck-copy', onClick: () => copyForAuthor(civ, plugin) };
    if (err?.kind === 'total')
      return {
        title,
        text: `${p.who}太慢：这一段推演里推演插件一共用了 30 秒，到了上限，网站把它停了。${stopped}`,
        tail: '慢的设备上更容易碰到。换一台快一点的设备打开这个世界再推，或者告诉作者。',
        buttons: [copy, { ...look, primary: true }],
      };
    if (err?.kind === 'moment')
      return {
        title,
        text: `${p.who}在第 ${at} 年出手，2 秒还没算完，网站把它停了，多半是插件里有转不出来的圈。${stopped}`,
        buttons: [copy, { ...look, primary: true }],
      };
    return {
      title,
      text: `${p.who}在第 ${at} 年出了错，${stopped}`,
      ...(err ? { box: { label: '插件报的错', text: err.text } } : {}),
      tail: '这是插件的毛病，不是你做错了，可以把这句发给作者。想接着推，可以等作者出新版，或者以它为底稿另建一个世界、不带这个插件。',
      buttons: [copy, { label: '问题记录', act: 'stuck-diag', onClick: openDiag }, { ...look, primary: true }],
    };
  }
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

/**
 * 盖在地图上的浅白和中间那张卡;刚算出来的那一次等时间轴停在停住那年时自动弹。busy = 还在推(新的历史还没到),先不弹;
 * over = 新建界面里(只有后台算不动的那张):盖在新建界面的面板上面
 */
export function StuckCard({ civ, phone, busy, over }: { civ: Civ | null; phone: boolean; busy: boolean; over?: boolean }) {
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
  const crash = st.why?.kind === 'crash' ? st.why : null;
  if (!st.open || busy || (!crash && (!civ || !stuck))) return null;
  const c = crash ? crashCard(civ, crash.retry) : cardOf(civ!, st.why);
  return (
    <div className={`stuck-layer${phone ? ' ph' : ''}${over ? ' over' : ''}`}>
      <div className="stuck-dim" aria-hidden="true" />
      <div className="stuck-box">
        <div className="stuck-card" role="alert" data-act="stuck-card">
          <h4>
            <Icon name="warn" size={phone ? 18 : 20} />
            {c.title}
          </h4>
          <p>{c.text}</p>
          {c.box && (
            <div className="stuck-err" data-testid="stuck-plugin-error">
              <b>{c.box.label}</b>
              {c.box.text}
            </div>
          )}
          {c.tail && <p className="stuck-tail">{c.tail}</p>}
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
  const tip = `推到第 ${civ.stuck?.at ?? stopYear(civ)} 年推不下去了，点了看为什么`;
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
