/**
 * 逐年推演里演一国(roleStore.ts):顶上常驻的一条 ——
 *   电脑  [旗] 演 大澜王朝 | 方针 扩张 [改方针] [切回造物主]   (工具栏下面正中)
 *   手机  [旗] 演 大澜王朝 | 扩张 [改方针] [造物主]            (屏幕顶上,右边那竖排按钮左边)
 * 方针写单子里的(还没生效)或者"现在"照的;「改方针」= 选中这国、卡片换成方针页;「切回造物主」= 不演了(导播关注的是它就放开)。
 * 提示条、选目标、正在推演时让开(都在顶上正中)。开始演绎时挑好的那一国,逐年推演的世界打开以后在这里认上去、导播关注它。
 */
import { useEffect } from 'react';
import type { Civ } from '../gen/civ/types';
import { polityKey } from '../gen/edits';
import { FlagIcon } from './Flag';
import { flagOf, useFlags } from './flagStore';
import { nameAt, usePolityPick } from './Interventions';
import { usePanel } from './panelStore';
import { usePending } from './pendingStore';
import { useStepwise } from './stepwiseStore';
import { useToast } from './toastStore';
import { getDirector, setDirectorFocus } from './directorStore';
import { pendingPolicy, policyAt, policyLabel, rolePolity } from './policyInfo';
import { bindArmedRole, setRole, useRole } from './roleStore';
import { openPolicyPage } from './PolicyPage';
import './policy.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** 切回造物主(导播关注的是演的那国就放开) */
export function roleOff(id: number) {
  setRole(null);
  if (id >= 0 && getDirector().focus === id) setDirectorFocus(null);
}

export function RoleBar({ civ, phone }: { civ: Civ; phone: boolean }) {
  const s = useStepwise();
  const role = useRole();
  const toast = useToast();
  const pick = usePolityPick();
  const { run } = usePanel();
  const pending = usePending();
  const flags = useFlags();
  // 开始演绎时挑好的那一国:逐年推演的世界打开了就认上去,导播关注它
  useEffect(() => {
    if (!s.on) return;
    const k = bindArmedRole();
    const id = k ? rolePolity(civ, k) : -1;
    if (id >= 0) setDirectorFocus(id);
  }, [s.on, civ]);
  const id = rolePolity(civ, role);
  if (!s.on || id < 0 || toast || pick || run) return null;
  const y = Math.min(civ.endYear, s.now);
  const p = civ.polities[id];
  const flag = flagOf(flags, id, y);
  const label = policyLabel(pendingPolicy(pending, polityKey(civ, id)) ?? policyAt(civ, id, y));
  return (
    <div className={`role-bar${phone ? ' phone' : ''}`} data-role={id} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      {flag && (
        <span className="role-flag">
          <FlagIcon spec={flag.spec} w={24} />
        </span>
      )}
      <span>
        演 <b>{nameAt(p, y)}</b>
      </span>
      <span className="role-sep" />
      {!phone && <span className="role-k">方针</span>}
      <span data-role-policy>{label}</span>
      <button className="pri" data-act="role-policy" onClick={() => openPolicyPage(civ, id)}>
        改方针
      </button>
      <button data-act="role-off" onClick={() => roleOff(id)}>
        {phone ? '造物主' : '切回造物主'}
      </button>
    </div>
  );
}
