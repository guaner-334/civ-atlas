/**
 * 民族的面板(和宗教卡片同一套样子,零件见 panelParts.tsx),按时间轴当前那一年:
 *
 *   顶部  颜色块(这一族的颜色)、族名(可改)、"湖泽民族，271 年出现"(分化出来的:"湖泽民族，1372 年从奥利亚族分出";
 *         已消亡的再加"2899 年消亡")、关闭
 *   按钮  出现那年(主操作:时间轴跳到出现那年)/ 设为中心(转到这一年人最多的州)/ 改名 /
 *         更多(看发源的州、看支族;分隔线下面让 AI 讲族名由来、讲讲风俗)
 *   概况  生计(民族类型和一句说明)、人口(历年小柱图 + 这一年多少人)、住在哪(各国几州,无主另写)、信什么(各教几州)
 *   特质  两三个词,各带一句来由;节头写"据哪些年的历史"(时间轴那一年往前三百年,见 gen/civ/cultureTraits.ts)
 *   族系  来历(自然兴起,发源某州 / 从某族分出)、支族(可点)、迁徙(几次、最近一次)
 *   大事  迁徙、同化、分化、消亡:最近 5 条(可点),"全部 N 件"展开
 *   最下面  AI 写的族名由来(和州卡片里的是同一份)、风俗(CustomsAi.tsx);写好的存在本地,下次打开还在
 * 卡片开着、又开着民族填色时,别的民族变淡(faithSelection.ts 的 cultureFocusOf)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CultureKind } from '../gen/civ/types';
import { KIND_INFO, cultureLabel, regionLabel } from '../gen/civ/display';
import { polityName, populationLabel } from '../gen/civ/growth';
import { cultureTraits } from '../gen/civ/cultureTraits';
import { cultureKey } from '../gen/edits';
import { spaced, yearAt, yearShortAt, yearSpanAt } from '../gen/era';
import { useAiOn } from '../ai/client';
import { setSelection } from './civView';
import { NameEdit } from './NameEdit';
import { entriesUpTo } from './panelData';
import { Act, Acts, AiBox, AiSuggestLink, CenterAct, EventList, Link, MoreAct, PanelHead, Row, Spark, Stats, SubLine, jumpTo, rgb, useRevealAi, type DetailProps } from './panelParts';
import { cultureBranches, cultureEntries, cultureNow, cultureSpark, cultureWaves, waveText } from './cultureInfo';
import { useCustomsAi } from './CustomsAi';
import { useEra } from './editsStore';
import { AiMenuItem, MenuItem, MenuSep } from './PopMenu';
import { AiTag } from './aiTag';
import { Icon } from './icons';

/** 生计后面的一句(民族类型的说明 KIND_INFO.hint 缩到卡片一行放得下) */
const LIVING: Record<CultureKind, string> = {
  farm: '哪里都能种地，不偏不倚',
  nomad: '草原荒漠上来去如风，几乎不渡海',
  sea: '沿海岸扩张，能跨海走远洋航线',
  highland: '在高原山地如履平地，很少下平原',
  river: '顺着大河走得快，离了河就慢',
  lake: '依大湖而居，沿湖岸扩张',
  forest: '密林、苔原里的猎人，出了林子就慢',
};

/** 住在哪、信什么最多列几个(多的在前) */
const LIST_MAX = 3;

export function CulturePanel({ civ, raw, raster, world, id, year, names }: DetailProps) {
  const cu = civ.cultures[id];
  const era = useEra();
  const aiOn = useAiOn();
  const [renaming, setRenaming] = useState(false);
  const [allEvents, setAllEvents] = useState(false);
  const born = Math.floor(cu.born);
  const ended = cu.ended !== undefined && cu.ended <= year;
  const parent = cu.parent !== undefined ? civ.cultures[cu.parent] : undefined;
  const now = useMemo(() => cultureNow(civ, id, year), [civ, id, year]);
  const spark = useMemo(() => cultureSpark(civ, id, year, now.pop), [civ, id, year, now.pop]);
  const traits = useMemo(() => cultureTraits(civ, id, year), [civ, id, year]);
  const kids = useMemo(() => cultureBranches(civ, id, year), [civ, id, year]);
  const waves = useMemo(() => cultureWaves(civ, id, year), [civ, id, year]);
  const upTo = entriesUpTo(cultureEntries(civ, id), year);
  // 族名由来、AI 起族名(和州卡片民族那一行的是同一份);写好的留在卡片最下面、全文显示
  const name = useRevealAi({ civ, raw, raster, target: { kind: 'culture', id }, what: '族名', open: true });
  const customs = useCustomsAi(civ, id, year);
  const customsRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (reveal) customsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [reveal]);
  // 边写边出字:卡片跟着划到最下面(停止 / 写完的按钮露在外面)
  useEffect(() => {
    if (customs.live) customsRef.current?.scrollIntoView({ block: 'nearest' });
  }, [customs.live]);
  const kindName = KIND_INFO[cu.kind].name;
  const later = year < cu.born ? '才' : '';
  const top = Math.max(1e-9, ...spark.map((b) => b.pop));
  const peopled = now.regions.length > 0;

  return (
    <div className="cp" data-culture={id}>
      <PanelHead color={rgb(cu.color)}>
        <NameEdit
          k={cultureKey(civ, id)}
          kind="culture"
          shown={cultureLabel(cu)}
          current={cu.name}
          fallback={raw.cultures[id]?.name ?? cu.name}
          names={names}
          preview={(v) => `${v}族`}
          hint="族名(不带“族”字)"
          big
          editing={renaming}
          onEditing={setRenaming}
          extra={<AiSuggestLink ai={name.ai} />}
        />
        <SubLine
          className="ins-status"
          parts={[
            `${kindName}民族`,
            parent ? `${yearAt(born, era)}${later}从${cultureLabel(parent)}分出` : `${yearAt(born, era)}${later}出现`,
            ended ? `${yearAt(cu.ended!, era)}消亡` : null,
          ]}
        />
      </PanelHead>
      <Acts>
        <Act icon="history" primary act="born-year" title={`跳到${spaced(yearAt(Math.ceil(cu.born), era))}`} onClick={() => jumpTo(Math.ceil(cu.born))}>
          出现那年
        </Act>
        <CenterAct world={world} civ={civ} sel={{ kind: 'culture', id }} year={year} />
        <Act icon="rename" act="rename" onClick={() => setRenaming(true)}>
          改名
        </Act>
        <MoreAct>
          <MenuItem icon={<Icon name="map" size={16} />} act="hearth" disabled={cu.hearth < 0} onClick={() => setSelection({ kind: 'region', id: cu.hearth })}>
            看发源的州
          </MenuItem>
          {kids.map((k) => (
            <MenuItem key={k.id} icon={<Icon name="branch" size={16} />} act="branch" onClick={() => setSelection({ kind: 'culture', id: k.id })}>
              看支族：{cultureLabel(k)}
            </MenuItem>
          ))}
          {aiOn && <MenuSep />}
          <AiMenuItem icon={<Icon name="sparkle" size={16} />} act="culture-explain" disabled={name.ai.busy} onClick={name.ai.ask}>
            族名由来
            <AiTag />
          </AiMenuItem>
          <AiMenuItem
            icon={<Icon name="scroll" size={16} />}
            act="culture-customs"
            disabled={customs.busy}
            onClick={() => {
              customs.ask();
              setReveal((n) => n + 1);
            }}
          >
            讲讲风俗
            <AiTag />
          </AiMenuItem>
        </MoreAct>
      </Acts>
      <div className="cp-body">
        <Stats items={[]}>
          <Row k="生计">
            {kindName}
            <em className="cp-num-note">{LIVING[cu.kind]}</em>
          </Row>
          <Row k="人口" className="cp-terr">
            {spark.length > 1 && (
              <Spark
                title="历年人口"
                bars={spark.map((b, i) => ({
                  h: Math.max(1, Math.round((16 * b.pop) / top)),
                  background: rgb(cu.color),
                  opacity: i === spark.length - 1 ? 1 : 0.55,
                  title: `${yearAt(b.year, era)}:${b.pop > 0 ? populationLabel(b.pop) : '没有'}`,
                }))}
              />
            )}
            <span data-stat="人口">{peopled ? populationLabel(now.pop) : '—'}</span>
          </Row>
          <Row k="住在哪" className="cp-links">
            {peopled ? (
              <>
                {now.polities.slice(0, LIST_MAX).map((p) => (
                  <span key={p.id}>
                    <Link to={{ kind: 'polity', id: p.id }}>{polityName(civ.polities[p.id], year)}</Link>
                    <em>{p.id === now.polities[0].id ? `${p.n} 州` : p.n}</em>
                  </span>
                ))}
                {now.wild > 0 && (
                  <span>
                    无主<em>{now.polities.length ? now.wild : `${now.wild} 州`}</em>
                  </span>
                )}
              </>
            ) : (
              <span className="cp-none">{ended ? '已消亡' : '尚未出现'}</span>
            )}
          </Row>
          {civ.religion && (
            <Row k="信什么" className="cp-links">
              {now.faiths.length ? (
                now.faiths.slice(0, LIST_MAX).map((f) => (
                  <span key={f.id}>
                    <Link to={{ kind: 'faith', id: f.id }}>{civ.religion!.faiths[f.id].name}</Link>
                    <em>{f.id === now.faiths[0].id ? `${f.n} 州` : f.n}</em>
                  </span>
                ))
              ) : (
                <span className="cp-none">—</span>
              )}
            </Row>
          )}
        </Stats>
        {traits && (
          <Stats
            title="特质"
            items={[]}
            more={
              <span className="cp-count" data-stat="特质年份">
                据{spaced(yearSpanAt(traits.window.from, traits.window.to, era))}的历史
              </span>
            }
          >
            {traits.traits.length ? (
              traits.traits.map((t) => (
                <Row key={t.key} k={t.word} className="cp-trait">
                  {t.why}
                </Row>
              ))
            ) : (
              <Row k="—">
                <span className="cp-none">这段历史里看不出突出的特质</span>
              </Row>
            )}
          </Stats>
        )}
        <Stats title="族系" items={[]}>
          <Row k="来历">
            {parent ? (
              <>
                从{parent.unborn ? cultureLabel(parent) : <Link to={{ kind: 'culture', id: parent.id }}>{cultureLabel(parent)}</Link>}分出，发源
                <Link to={{ kind: 'region', id: cu.hearth }}>{regionLabel(civ, cu.hearth)}</Link>
              </>
            ) : (
              <>
                自然兴起，发源<Link to={{ kind: 'region', id: cu.hearth }}>{regionLabel(civ, cu.hearth)}</Link>
              </>
            )}
          </Row>
          <Row k="支族" className="cp-links">
            {kids.length ? (
              kids.map((k) => {
                const n = cultureNow(civ, k.id, year).regions.length;
                const gone = k.ended !== undefined && k.ended <= year;
                return (
                  <span key={k.id} className="cp-now">
                    <Link to={{ kind: 'culture', id: k.id }}>{cultureLabel(k)}</Link>
                    <em>
                      {yearShortAt(k.born, era)}分出，{gone ? '已消亡' : `今 ${n} 州`}
                    </em>
                  </span>
                );
              })
            ) : (
              <span>没有</span>
            )}
          </Row>
          <Row k="迁徙">
            {waves.length ? (
              <>
                {waves.length} 次
                <em className="cp-num-note">
                  最近 {yearShortAt(waves[waves.length - 1].year, era)}
                  {waveText(civ, waves[waves.length - 1])}
                </em>
              </>
            ) : (
              '没有成规模的迁徙'
            )}
          </Row>
        </Stats>
        <EventList
          upTo={upTo}
          civ={civ}
          limit={allEvents ? upTo.length : 5}
          empty={year < cu.born ? '尚未出现' : '还没有'}
          more={
            upTo.length > 5 && (
              <button className="ins-link cp-more" data-act="all-events" onClick={() => setAllEvents((v) => !v)}>
                {allEvents ? '收起' : `全部 ${upTo.length} 件`}
              </button>
            )
          }
        />
        <AiBox ai={name.ai} aiRef={name.aiRef} />
        {customs.panel && (
          <div className="cp-ai" ref={customsRef}>
            {customs.panel}
          </div>
        )}
      </div>
    </div>
  );
}
