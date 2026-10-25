/**
 * 逐年推演里演一国(roleStore.ts):顶上常驻的一条 ——
 *   电脑  [旗] 演 大澜王朝 | 方针 扩张 [改方针] [切回造物主]   (工具栏下面正中)
 *   手机  [旗] 演 大澜王朝 | 扩张 [改方针] [造物主]            (屏幕顶上,右边那竖排按钮左边)
 * 方针写单子里的(还没生效)或者"现在"照的;「改方针」= 选中这国、卡片换成方针页;「切回造物主」= 不演了(导播关注的是它就放开)。
 * 提示条、选目标、正在推演时让开(都在顶上正中)。开始演绎时挑好的那一国,逐年推演的世界打开以后在这里认上去、导播关注它;
 * 打开一个演着某国的世界(刷新也算)时,导播还没跟着谁(存档里记着的)就先关注它。正跟着一个人(自己挑的)时都不动。
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
import { getDirectorFollow, setDirectorFollow } from './directorStore';
import { pendingPolicy, policyAt, policyLabel, rolePolity } from './policyInfo';
import { bindArmedRole, getRole, setRole, useRole } from './roleStore';
import { currentWorld } from './saveStore';
import { openPolicyPage } from './PolicyPage';
import './policy.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** 导播已经按演的那国关注过的世界(每个世界打开时只设一次) */
let focusedWorld: string | null = null;

/** 演一国时别国的干预入口变灰,悬停 / 菜单里写的那一句 */
export const ROLE_LOCK_NOTE = '切回造物主才能改别国';

/** 演一国时别国的国家 / 州 / 城卡片上那一句(me = 演的那国,who = 卡片上的这国) */
export function RoleLockNote({ civ, me, who, year }: { civ: Civ; me: number; who: string; year: number }) {
  return (
    <div className="pol-lock" data-role-lock={me}>
      你在演{nameAt(civ.polities[me], year)}，只管自己的国家。要改{who}，
      <button data-act="role-off" onClick={() => roleOff(me)}>
        切回造物主
      </button>
      。
    </div>
  );
}

/** 切回造物主(导播关注的是演的那国就放开) */
export function roleOff(id: number) {
  const k = getRole();
  setRole(null);
  const f = getDirectorFollow();
  if (id >= 0 && k && f?.kind === 'polity' && f.key === k) setDirectorFollow(null);
}

/**
 * 演一国时导播跟着它(key = 那国的 polityKey)。正跟着一个人(自己挑的)不动;
 * onlyIfUnset:导播已经跟着别的(存档里记着的)也不动 —— 打开一个世界时用
 */
export function followRolePolity(key: string, onlyIfUnset = false) {
  const f = getDirectorFollow();
  if (f?.kind === 'person' || (onlyIfUnset && f)) return;
  setDirectorFollow({ kind: 'polity', key });
}

export function RoleBar({ civ, phone }: { civ: Civ; phone: boolean }) {
  const s = useStepwise();
  const role = useRole();
  const toast = useToast();
  const pick = usePolityPick();
  const { run } = usePanel();
  const pending = usePending();
  const flags = useFlags();
  // 开始演绎时挑好的那一国:逐年推演的世界打开了就认上去;打开一个演着某国的世界(刷新、从我的世界打开):
  // 导播还没跟着谁就先关注它(每个世界打开时一次,之后换成看全世界的照用户的)
  useEffect(() => {
    if (!s.on) return;
    const bound = bindArmedRole();
    const w = currentWorld()?.id ?? null;
    if (bound === undefined && w === focusedWorld) return;
    focusedWorld = w;
    const k = bound === undefined ? getRole() : bound;
    const id = k ? rolePolity(civ, k) : -1;
    if (id >= 0) followRolePolity(polityKey(civ, id), bound === undefined);
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
