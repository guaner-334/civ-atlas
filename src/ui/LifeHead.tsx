/**
 * 照人物卡上一段经历先填好的那一页,页顶一块「照这段经历填好了」:那段经历(年份 + 他写的那句话),下面一句"年份、国家照这段经历和他那年的国家先填好，能改。
 * 他写的这句话不改，也不拿去当历史。"(人物卡「一生」每段旁「进推演…」选了一种以后打开的那一页;lifeIv.ts)
 *   LifeHead        人物卡上换的那几页(即位、任将、任臣、掌权):照经历打开的给 t
 *   NationLifeHead  国家的事那几页(国家、州卡片上的;lifeTag.ts):开着的是照经历开的那一页才有,开着时下的令记在他名下(一条),
 *                   加进单子了、关掉这一页就收起
 */
import { useEffect, useState } from 'react';
import { yearShort } from '../gen/era';
import { useEra } from './editsStore';
import { getLifeTag, holdLifeTag, lifeTagFor, useLifeTag, type LifeNationKind, type LifeTag } from './lifeTag';
import './newIv.css';

export function LifeHead({ t }: { t: LifeTag }) {
  const era = useEra();
  return (
    <div className="cp-form" data-life-iv="head">
      <span className="cp-form-title">照这段经历填好了</span>
      <div className="as-entry">
        <span className={`cp-ev-year${era ? ' era' : ''}`}>{yearShort(t.year, era)}</span>
        <span>{t.text || '（没写经历）'}</span>
      </div>
      <span className="cp-note">
        年份、国家照这段经历和{t.he}那年的国家先填好，能改。{t.he}写的这句话不改，也不拿去当历史。
      </span>
    </div>
  );
}

/** 国家的事那一页的页顶:照经历开的(种类、国家 / 州对得上)才写;开着时记着,关掉就收起 */
export function NationLifeHead({ kinds, polity, region }: { kinds: readonly LifeNationKind[]; polity?: number; region?: number }) {
  // 打开那一刻对上的那一份(之后不跟着变;开着时一直是它)
  const [t] = useState(() => lifeTagFor(getLifeTag(), kinds, { polity, region }));
  useEffect(() => (t ? holdLifeTag(t) : undefined), [t]);
  // 记在他名下的那一条加进单子以后收起(lifeTag.ts 的 lifeTagUsed)
  const now = useLifeTag();
  return t && now === t ? <LifeHead t={t} /> : null;
}
