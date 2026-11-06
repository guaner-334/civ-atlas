/** 「存成预设」「复制分享链接」两个小窗,点了才下载(「连规则一起」要读「我的规则」,首页不多下载) */
import { useState } from 'react';
import type { WorldParams } from '../gen/world';
import type { RuleSet } from '../gen/civ/ruleSet';
import { sameRuleContent } from '../gen/civ/ruleSetEdit';
import { Icon } from './icons';
import { copyText } from './clipboard';
import { notify } from './saveStore';
import { SHARE_WARN_LENGTH } from '../gen/savefile';
import { cleanPresetName, presetHash } from './presetLink';
import { keptGroups, savePreset, strip, usePresets } from './presetStore';
import { adoptSharedRules, findMyRules, useMyRules, type MyRules } from './rulesStore';
import { useEscape } from './PresetPicker';
import { rulesUiOn } from './rules/flag';

/** key = 「我的规则」里的本机编号;不在「我的规则」里的那一套是 '' */
interface RulesOpt {
  key: string;
  label: string;
  rules: RuleSet;
}

/** 现在用的那一套不在「我的规则」里(链接、作品墙带来的,已经删了的)另列在最前面;没有现在用的,先选最近改过的那套 */
function rulesOptions(mine: readonly MyRules[], cur: RuleSet | undefined, note: string | null): { opts: RulesOpt[]; pick: string } {
  const opts: RulesOpt[] = mine.map((e) => ({ key: e.rules.id, label: e.rules.name, rules: e.rules }));
  const inMine = cur?.id ? mine.find((e) => e.rules.id === cur.id) : undefined;
  if (cur && !inMine) opts.unshift({ key: '', label: note ? `${cur.name}（${note}）` : cur.name, rules: cur });
  const recent = mine.reduce<MyRules | undefined>((a, e) => (!a || e.at > a.at ? e : a), undefined);
  return { opts, pick: cur ? (inMine ? inMine.rules.id : '') : (recent?.rules.id ?? '') };
}

function sharedNote(cur: RuleSet | undefined, shared: { rules?: RuleSet; gallery?: unknown } | null): string | null {
  if (!cur || cur.id || !shared?.rules || !sameRuleContent(shared.rules, cur)) return null;
  return shared.gallery ? '作品墙上的' : '链接带来的';
}

const changedN = (r: RuleSet) => Object.keys(r.values).length + Object.keys(r.biomes ?? {}).length;

const updown = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5 6.2L8 3.5l3 2.7M5 9.8L8 12.5l3-2.7" />
  </svg>
);

function RulesRow({
  act,
  label,
  note,
  empty,
  opts,
  on,
  pick,
  onOn,
  onPick,
}: {
  act: string;
  label: string;
  note: string;
  empty: string;
  opts: RulesOpt[];
  on: boolean;
  pick: string;
  onOn: (on: boolean) => void;
  onPick: (key: string) => void;
}) {
  const none = !opts.length;
  if (!rulesUiOn()) return null;
  return (
    <label className={`psd-cbx psd-rules${none ? ' off' : on ? ' on' : ''}`}>
      <input type="checkbox" checked={on && !none} disabled={none} data-act={act} onChange={(e) => onOn(e.target.checked)} />
      <span>
        <span className="psd-rl">
          {label}
          {on && !none && (
            <span className="psd-sel">
              <select value={pick} aria-label="哪一套规则" data-act={`${act}-pick`} onChange={(e) => onPick(e.target.value)}>
                {opts.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              {updown}
            </span>
          )}
        </span>
        <small>{none ? empty : note}</small>
      </span>
    </label>
  );
}

function useRulesPick(cur: RuleSet | undefined, startOn: boolean, note: string | null) {
  const mine = useMyRules();
  const { opts, pick: first } = rulesOptions(mine, cur, note);
  const [on, setOn] = useState(startOn && rulesUiOn());
  const [pick, setPick] = useState(first);
  const opt = opts.find((o) => o.key === pick) ?? opts.find((o) => o.key === first) ?? opts[0];
  return { opts, on: on && !!opt, pick: opt?.key ?? '', setOn, setPick, rules: on ? opt?.rules : undefined };
}

export interface SavePresetProps {
  theme?: string;
  params: WorldParams;
  endYear: number | undefined;
  /** 现在用的那一套规则(官方 = 不给) */
  rules?: RuleSet;
  /** 打开朋友的预设链接后点「存进我的预设…」:名字、连不连种子、带的规则照分享来的那一套 */
  initial?: { name: string; withSeed: boolean; rules?: RuleSet };
  onClose: () => void;
  onSaved?: () => void;
}

/** 存的是链接、作品墙带来的那一套:先加进「我的规则」,预设记着加进来的那一套(之后在「我的规则」里调了,用预设时跟着用调好的) */
export function SavePresetDialog({ theme, params, endYear, rules, initial, onClose, onSaved }: SavePresetProps) {
  const st = usePresets();
  const own = st.list.find((p) => p.id === st.chosen);
  const [name, setName] = useState(() => initial?.name ?? own?.name ?? `我的预设 ${st.list.length + 1}`);
  const [withSeed, setWithSeed] = useState(initial?.withSeed ?? !!own?.seed);
  const cur = initial ? initial.rules : (rules ?? own?.rules);
  const rp = useRulesPick(cur, !!cur, sharedNote(cur, st.shared));
  useEscape(true, onClose);
  const clean = name.trim().slice(0, 24);
  const same = st.list.find((p) => p.name === clean);
  const save = () => {
    if (!clean) return;
    let r = rp.rules;
    if (r && !r.id) {
      const got = adoptSharedRules(r);
      r = (got && findMyRules(got.id)?.rules) || r;
    }
    savePreset(clean, params, withSeed, endYear, r);
    onSaved?.();
    onClose();
  };
  const kept = keptGroups(params);
  return (
    <div className="psd-scrim" data-theme={theme} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="psd" role="dialog" aria-modal="true" aria-labelledby="psd-save-title" data-act="preset-save-dlg" onClick={(e) => e.stopPropagation()}>
        <h3 id="psd-save-title">存成预设</h3>
        <p>以后新建世界，在「预设」里一选就是这一套。只存在这个浏览器里。</p>
        <div className="psd-name">
          <span>名字</span>
          <input
            className="psd-fld"
            aria-label="预设的名字"
            data-act="preset-name"
            value={name}
            maxLength={24}
            autoFocus
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        {same && <div className="psd-warn">已经有叫「{same.name}」的预设，存好会替换它</div>}
        <label className="psd-cbx">
          <input type="checkbox" checked={withSeed} data-act="preset-seed" onChange={(e) => setWithSeed(e.target.checked)} />
          <span>
            连种子一起存
            <small>
              勾上以后，用这个预设新建总是这颗星球（种子 {params.seed}
              ）；不勾，种子照旧随机给。
            </small>
          </span>
        </label>
        <RulesRow
          act="preset-rules"
          label="连规则一起存"
          note="勾上以后，用这个预设新建，打造文明时先选好这套规则，到那一步还能换；不勾，照旧是官方规则。"
          empty="「我的规则」里还没有规则。在「我的世界 › 规则」里调一套，就能连规则一起存"
          opts={rp.opts}
          on={rp.on}
          pick={rp.pick}
          onOn={rp.setOn}
          onPick={rp.setPick}
        />
        <div className="psd-kept">
          会存下：
          {kept.map((g, i) => (
            <span key={g.name}>
              {i > 0 && '，'}
              <b>{g.name}</b>
              {g.detail && `（${g.detail}）`}
            </span>
          ))}
          {withSeed && (
            <span>
              ，<b>种子</b>（{params.seed}）
            </span>
          )}
          {rp.rules && (
            <span>
              ，<b>规则</b>（{rp.rules.name}）
            </span>
          )}
          。
        </div>
        <div className="psd-btns">
          <button onClick={onClose}>取消</button>
          <button className="b1" data-act="preset-save-ok" disabled={!clean} onClick={save}>
            {same ? '替换' : '存好'}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface SharePresetProps {
  theme?: string;
  params: WorldParams;
  endYear: number | undefined;
  /** 现在用的那一套规则(官方 = 不给) */
  rules?: RuleSet;
  onClose: () => void;
}

/** 剪贴板用不了:小窗留着,下面一格选中了链接让人自己复制 */
export function SharePresetDialog({ theme, params, endYear, rules, onClose }: SharePresetProps) {
  const st = usePresets();
  const picked = st.chosen === 'shared' ? st.shared : st.list.find((p) => p.id === st.chosen);
  const [name, setName] = useState(() => picked?.name ?? '我的预设');
  const [withSeed, setWithSeed] = useState(picked?.seed !== undefined);
  const cur = picked?.rules ?? rules;
  const rp = useRulesPick(cur, !!picked?.rules, sharedNote(cur, st.shared));
  const [manual, setManual] = useState(false);
  useEscape(true, onClose);
  const clean = cleanPresetName(name);
  const url = `${location.origin}${location.pathname}${presetHash({
    name: clean,
    params: strip(params),
    ...(withSeed ? { seed: params.seed } : {}),
    ...(endYear ? { endYear } : {}),
    ...(rp.rules ? { rules: rp.rules } : {}),
  })}`;
  const copy = async () => {
    if (!clean) return;
    const ok = await copyText(url);
    (window as unknown as { __wfPresetShare?: { url: string; copied: boolean } }).__wfPresetShare = { url, copied: ok };
    if (!ok) return setManual(true);
    onClose();
    const long = url.length > SHARE_WARN_LENGTH;
    notify({ kind: long ? 'warn' : 'ok', text: `已复制预设链接「${clean}」`, more: long ? [`链接较长，可能打不开（${url.length} 字）`] : undefined });
  };
  const kept = keptGroups(params);
  const n = rp.rules ? changedN(rp.rules) : 0;
  return (
    <div className="psd-scrim" data-theme={theme} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="psd share" role="dialog" aria-modal="true" aria-labelledby="psd-share-title" data-act="preset-share-dlg" onClick={(e) => e.stopPropagation()}>
        <h3 id="psd-share-title">复制分享链接</h3>
        <p>朋友打开这个链接，新建世界的窗口里就照这一套填好参数，也能存进他自己的预设。参数都写在链接里，不经过服务器。</p>
        <div className="psd-name">
          <span>名字</span>
          <input
            className="psd-fld"
            aria-label="预设的名字"
            data-act="preset-share-name"
            value={name}
            maxLength={24}
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setName(e.target.value);
              setManual(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void copy()}
          />
        </div>
        <label className="psd-cbx">
          <input
            type="checkbox"
            checked={withSeed}
            data-act="preset-share-seed"
            onChange={(e) => {
              setWithSeed(e.target.checked);
              setManual(false);
            }}
          />
          <span>
            连种子一起分享
            <small>
              勾上以后，朋友建出来的是同一颗星球（种子 {params.seed}
              ）；不勾，朋友那边种子照旧随机给。
            </small>
          </span>
        </label>
        <RulesRow
          act="preset-share-rules"
          label="连规则一起分享"
          note="勾上以后，朋友打开就选好这套规则，打造文明时还能换；不勾，朋友那边照旧是官方规则。"
          empty="「我的规则」里还没有规则。在「我的世界 › 规则」里调一套，就能连规则一起分享"
          opts={rp.opts}
          on={rp.on}
          pick={rp.pick}
          onOn={(v) => {
            rp.setOn(v);
            setManual(false);
          }}
          onPick={(k) => {
            rp.setPick(k);
            setManual(false);
          }}
        />
        <div className="psd-kept">
          链接里有：
          {kept.map((g, i) => (
            <span key={g.name}>
              {i > 0 && '，'}
              <b>{g.name}</b>
              {g.detail && `（${g.detail}）`}
            </span>
          ))}
          {withSeed && (
            <span>
              ，<b>种子</b>（{params.seed}）
            </span>
          )}
          {rp.rules && (
            <span>
              ，<b>规则</b>（{rp.rules.name}
              {n ? `，改了 ${n} 项` : ''}）
            </span>
          )}
          。
        </div>
        {manual && (
          <div className="psd-manual" data-testid="preset-share-manual">
            <span>没能自动复制，请手动复制</span>
            <input readOnly value={url} spellCheck={false} aria-label="预设的分享链接" autoFocus onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
        <div className="psd-btns">
          <span className="psd-note" data-testid="preset-share-len">
            链接 {url.length} 字
          </span>
          <span className="psd-sp" />
          <button onClick={onClose}>取消</button>
          <button className="b1" data-act="preset-share-ok" disabled={!clean} onClick={() => void copy()}>
            <Icon name="link" size={16} />
            复制链接
          </button>
        </div>
      </div>
    </div>
  );
}
