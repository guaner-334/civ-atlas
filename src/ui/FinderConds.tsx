/**
 * 照故事找世界的条件页(FinderPage.tsx 的第一页):
 *
 *   从例子改    山国守隘口 / 几国交界 / 海上强国 / 大国分崩(点了条件换成例子的,再改)
 *   故事里的国家  每国一组(1–3 国):组头是叫法(点了改名)和「＋ 加一条」;一条一行,写成一句话,能改的值是白色的小块
 *               (下拉 = 分几档的,数字框 = 年数、个数、米)。「＋ 再加一国」最多 3 国;一国的条件都去掉了,这一国也去掉
 *               (从大纲页来的几国留着:没有条件的找的时候不管它,一行灰字说明搬过去以后它要重新指)
 *   一起        交界、故事讲多少年、开场年份
 *   底下        搜几个(种子 1–N)、大约多久;地图每个世界换一张 / 都用这张(电脑上);「开始找」
 *
 * 「＋ 加一条」弹出一张菜单(电脑在卡片右边,手机从底下升起):按地形、国家、和别国、交界分组,已经加了的打勾,点打勾的去掉。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ERAS } from '../gen/civ/development';
import { FINDER_PRESETS, ROLE_NAME_MAX, roleFree, type FateKind, type FinderQuery, type FinderRole, type RoleCond, type TogetherCond } from '../gen/finder/query';
import { pickPreset, setFinderCount, setFinderMap, setQuery, startFinder, type FinderUi } from './finderStore';
import { sizeHint, spanWho, togetherLabel } from './finderText';
import { Icon } from './icons';

/** 故事里最多几国 */
export const MAX_ROLES = 3;
/** 新加的一国默认的叫法(和已有的重名就往后挑) */
const ROLE_NAMES = ['甲国', '乙国', '丙国', '丁国'];
/** 叫法最多几个字 */
const NAME_MAX = ROLE_NAME_MAX;

/** 角色的颜色下标(帝国蓝、山国橙、第三国紫):条件页、结果、地图上的小牌子同一套 */
export const roleClass = (i: number) => `fd-role r${i % 3}`;

export function RoleTag({ q, i, small }: { q: FinderQuery; i: number; small?: boolean }) {
  return <span className={`${roleClass(i)}${small ? ' sm' : ''}`}>{q.roles[i]?.name || `第 ${i + 1} 国`}</span>;
}

// ---------------------------------------------------------------------------
// 能改的值

/** 数字框(白色小块):打字时先记着,离开 / 回车再交;不是数就换回原来的 */
function Num({ value, onChange, min = 0, max = 99999, scale = 1, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; scale?: number; label: string }) {
  const shown = Math.round(value * scale * 100) / 100;
  const [text, setText] = useState(String(shown));
  useEffect(() => setText(String(shown)), [shown]);
  const commit = () => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n)) return setText(String(shown));
    const v = Math.max(min, Math.min(max, n));
    setText(String(v));
    if (v !== shown) onChange(v / scale);
  };
  return (
    <input
      className="fd-val num"
      aria-label={label}
      value={text}
      inputMode="numeric"
      size={Math.max(2, text.length)}
      onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, '').slice(0, 6))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

/** 下拉(白色小块带小箭头) */
function Pick<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  const cur = options.find((o) => o[0] === value);
  return (
    <span className="fd-val pick">
      {cur?.[1] ?? ''}
      <Icon name="down" size={12} />
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x[0]) === e.target.value);
          if (o) onChange(o[0]);
        }}
      >
        {options.map(([v, t]) => (
          <option key={String(v)} value={String(v)}>
            {t}
          </option>
        ))}
      </select>
    </span>
  );
}

function Check({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="fd-chk" role="checkbox" aria-checked="true" aria-label={label} onClick={onClick}>
      <Icon name="check" size={13} />
    </button>
  );
}

const ERA_OPTS = ERAS.slice(0, 7).map((n, i) => [i, n] as const);
const SIZE_OPTS = [
  ['small', '小国'],
  ['medium', '中等'],
  ['large', '大国'],
  ['top', '附近最大'],
  ['n', '按州数'],
] as const;
const FATE_OPTS = [
  ['split,fall', '分裂或亡'],
  ['fall', '亡国'],
  ['split', '分裂'],
  ['dynasty', '改朝'],
  ['split,fall,dynasty', '亡、分裂或改朝'],
] as const;

// ---------------------------------------------------------------------------
// 一条条件一行

function Row({ k, children, top, act }: { k: ReactNode; children: ReactNode; top?: boolean; act: string }) {
  return (
    <div className={`fd-row${top ? ' top' : ''}`} data-cond={act}>
      <span className="fd-k">{k}</span>
      <span className="fd-v">{children}</span>
    </div>
  );
}

/** 别的那一国是谁(条件里的 other) */
const otherName = (q: FinderQuery, i: number) => q.roles[i]?.name || '另一国';

function RoleCondRow({ q, role, c, put }: { q: FinderQuery; role: number; c: RoleCond; put: (c: RoleCond | null) => void }) {
  const hint = (s: string) => <span className="fd-hint">{s}</span>;
  switch (c.kind) {
    case 'size': {
      const v = c.size ?? 'n';
      return (
        <Row k="大小" act="size">
          <Pick label="大小" value={v} options={SIZE_OPTS} onChange={(x) => put(x === 'n' ? { kind: 'size', min: 10 } : { kind: 'size', size: x })} />
          {c.size ? (
            hint(sizeHint(q, role, c))
          ) : (
            <>
              {' '}至少 <Num label="至少几州" value={c.min ?? 1} min={1} onChange={(n) => put({ ...c, min: n })} /> 州
            </>
          )}
        </Row>
      );
    }
    case 'neighbors':
      return (
        <Row k="邻国" act="neighbors">
          {c.max !== undefined && c.min === undefined ? (
            <>
              不超过 <Num label="邻国不超过几个" value={c.max} onChange={(n) => put({ ...c, max: n })} /> 个
            </>
          ) : (
            <>
              至少 <Num label="邻国至少几个" value={c.min ?? 1} min={1} max={20} onChange={(n) => put({ ...c, min: n })} /> 个
            </>
          )}
        </Row>
      );
    case 'ports':
      return (
        <Row k="港口" act="ports">
          {c.min <= 1 ? (
            <span className="fd-checkline">
              <Check label="有通航线的港口" onClick={() => put(null)} />
              有通航线的港口
            </span>
          ) : (
            <>
              至少 <Num label="至少几个港口" value={c.min} min={1} max={50} onChange={(n) => put({ ...c, min: n })} /> 个通航线的港口
            </>
          )}
        </Row>
      );
    case 'age':
      return (
        <Row k="立国" act="age">
          开场时已立国 <Num label="立国几年" value={c.max ?? c.min ?? 0} onChange={(n) => put(c.max !== undefined ? { kind: 'age', max: n } : { kind: 'age', min: n })} /> 年
          <Pick
            label="以上还是以内"
            value={c.max !== undefined ? 'max' : 'min'}
            options={[
              ['min', '以上'],
              ['max', '以内'],
            ]}
            onChange={(x) => put(x === 'max' ? { kind: 'age', max: c.max ?? c.min ?? 100 } : { kind: 'age', min: c.min ?? c.max ?? 100 })}
          />
        </Row>
      );
    case 'era':
      return (
        <Row k="时代" act="era">
          开场时在 <Pick label="哪个时代" value={c.era} options={ERA_OPTS} onChange={(x) => put({ ...c, era: x })} /> 时代
        </Row>
      );
    case 'eraEnter':
      return (
        <Row k="进时代" act="eraEnter">
          开场后 <Num label="最早几年后" value={c.min} onChange={(n) => put({ ...c, min: n })} />–<Num label="最晚几年后" value={c.max} onChange={(n) => put({ ...c, max: n })} /> 年进{' '}
          <Pick label="进哪个时代" value={c.era} options={ERA_OPTS} onChange={(x) => put({ ...c, era: x })} />
        </Row>
      );
    case 'fate':
      return (
        <Row k="后来" act="fate">
          开场后 <Num label="几年内" value={c.within} min={1} onChange={(n) => put({ ...c, within: n })} /> 年内{' '}
          <Pick label="亡、分裂还是改朝" value={c.what.join(',')} options={FATE_OPTS} onChange={(x) => put({ ...c, what: x.split(',') as FateKind[] })} />
        </Row>
      );
    case 'mountain':
      return (
        <Row k="地势" act="mountain">
          边界至少 <Num label="几成是翻山" value={c.min} scale={10} max={10} onChange={(n) => put({ ...c, min: n })} /> 成是翻山
        </Row>
      );
    case 'elevation':
      return (
        <Row k="海拔" act="elevation">
          平均海拔高过 <Num label="高过几米" value={c.min} max={9000} onChange={(n) => put({ ...c, min: n })} /> 米
        </Row>
      );
    case 'higher':
      return (
        <Row k="海拔" act="higher">
          比{otherName(q, c.other)}高 <Num label="高几米" value={c.by} max={9000} onChange={(n) => put({ ...c, by: n })} /> 米以上
        </Row>
      );
    case 'border':
    case 'pass': {
      const kind = (
        <Pick
          label={`和${otherName(q, c.other)}`}
          value={c.kind}
          options={[
            ['border', '接壤'],
            ['pass', '接壤，隔山有隘口'],
          ]}
          onChange={(x) => put(x === 'pass' ? { kind: 'pass', other: c.other, gap: 800, narrow: 2 } : { kind: 'border', other: c.other })}
        />
      );
      return (
        <Row k={`和${otherName(q, c.other)}`} act={c.kind} top={c.kind === 'pass'}>
          {kind}
          {c.kind === 'pass' && (
            <small className="fd-sub fd-lines">
              口子比山脊低 <Num label="口子比山脊低几米" value={c.gap} max={5000} onChange={(n) => put({ ...c, gap: n })} /> 米以上
              <br />
              能过的地方不超过 <Num label="能过的地方不超过几处" value={c.narrow} min={1} max={20} onChange={(n) => put({ ...c, narrow: n })} /> 处
            </small>
          )}
        </Row>
      );
    }
    case 'war':
      return (
        <Row k={`和${otherName(q, c.other)}`} act="war">
          开场后 <Num label="几年内" value={c.within} min={1} onChange={(n) => put({ ...c, within: n })} /> 年内打过仗
        </Row>
      );
    case 'conquer':
      return (
        <Row k={`和${otherName(q, c.other)}`} act="conquer">
          开场后 <Num label="几年内" value={c.within} min={1} onChange={(n) => put({ ...c, within: n })} /> 年内{' '}
          <Pick
            label="占过还是被占"
            value={c.dir}
            options={[
              ['took', '占过对方'],
              ['lost', '被对方占过'],
            ]}
            onChange={(x) => put({ ...c, dir: x })}
          />{' '}
          至少 <Num label="至少几州" value={c.min} min={1} onChange={(n) => put({ ...c, min: n })} /> 州
        </Row>
      );
    case 'junction':
      return (
        <Row k="交界" act="role-junction">
          它的一州同时挨着 <Num label="挨着几国" value={c.min} min={2} max={8} onChange={(n) => put({ ...c, min: n })} /> 国
        </Row>
      );
  }
}

function TogetherRow({ q, c, put, phone }: { q: FinderQuery; c: TogetherCond; put: (c: TogetherCond | null) => void; phone: boolean }) {
  const k = togetherLabel(c);
  switch (c.kind) {
    case 'junction':
      return (
        <Row k={k} act="junction">
          有一州同时挨着 <Num label="挨着几国" value={c.min} min={2} max={8} onChange={(n) => put({ ...c, min: n })} /> 国{c.unowned ? '，无主' : ''}
          {c.lasting ? (
            <small className="fd-sub">
              这几国都撑过 <Num label="撑过几年" value={c.lasting} onChange={(n) => put({ ...c, lasting: n })} /> 年
            </small>
          ) : (
            !phone && <small className="fd-sub">能当几国之间的中立地</small>
          )}
        </Row>
      );
    case 'span': {
      const who = spanWho(q);
      return (
        <Row k={k} act="span">
          故事讲 <Num label="故事讲几年" value={c.years} min={1} max={2000} onChange={(n) => put({ ...c, years: n })} /> 年{who ? `，${who}得撑下来` : ''}
        </Row>
      );
    }
    case 'start': {
      if ('from' in c)
        return (
          <Row k={k} act="start-years">
            第 <Num label="最早第几年" value={c.from} onChange={(n) => put({ ...c, from: n })} />–<Num label="最晚第几年" value={c.to} onChange={(n) => put({ ...c, to: n })} /> 年开场
            {q.roles.length > 0 && (
              <small className="fd-sub">
                也可以跟着时代走：
                <button className="fd-link sm" data-act="start-follow" onClick={() => put({ kind: 'start', role: 0, era: 1, enter: 2, min: 15, max: 50 })}>
                  改成跟着{q.roles[0].name}的时代
                </button>
              </small>
            )}
          </Row>
        );
      return (
        <Row k={k} act="start-follow">
          {otherName(q, c.role)}在{' '}
          <Pick
            label="开场时在哪个时代"
            value={c.era ?? -1}
            options={[[-1, '不管'] as const, ...ERA_OPTS]}
            onChange={(x) => put(x < 0 ? { kind: 'start', role: c.role, enter: c.enter, min: c.min, max: c.max } : { ...c, era: x, enter: Math.min(ERAS.length - 1, x + 1) })}
          />
          {phone ? '' : ' 时代'}，<Num label="最早几年后" value={c.min} onChange={(n) => put({ ...c, min: n })} />–<Num label="最晚几年后" value={c.max} onChange={(n) => put({ ...c, max: n })} /> 年后进
          {c.era !== undefined ? ERAS[c.enter] : <Pick label="进哪个时代" value={c.enter} options={ERA_OPTS} onChange={(x) => put({ ...c, enter: x })} />}
          {!phone && (
            <small className="fd-sub">
              也可以直接写年份：
              <button className="fd-link sm" data-act="start-years" onClick={() => put({ kind: 'start', from: 500, to: 2500 })}>
                改成第几年到第几年
              </button>
            </small>
          )}
        </Row>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 改条件:换一条、去掉一条、去掉一国(别的国家条件里指着它的跟着改)

export function withRole(q: FinderQuery, i: number, conds: RoleCond[]): FinderQuery {
  // 从大纲页来的那几国(ref)条件都去掉了也留着:大纲搬过去时按它认
  if (conds.length || q.roles[i]?.ref !== undefined) return { ...q, roles: q.roles.map((r, k) => (k === i ? { ...r, conds } : r)) };
  return dropRole(q, i);
}

/** 去掉第 i 国:指着它的条件去掉,指着后面几国的下标往前挪 */
export function dropRole(q: FinderQuery, i: number): FinderQuery {
  const shift = (o: number) => (o > i ? o - 1 : o);
  const roles: FinderRole[] = q.roles
    .filter((_, k) => k !== i)
    .map((r) => ({
      ...r,
      conds: r.conds.filter((c) => !('other' in c) || c.other !== i).map((c) => ('other' in c ? { ...c, other: shift(c.other) } : c)),
    }));
  const together: TogetherCond[] = q.together
    .filter((c) => !(c.kind === 'start' && 'role' in c && c.role === i))
    .map((c) => (c.kind === 'start' && 'role' in c ? { ...c, role: shift(c.role) } : c));
  // 因为去掉它、条件都没了的国家也去掉(一层就够:指着它的条件已经去掉);本来就没有条件的(从大纲页来的)、从大纲页来的留着
  const was = q.roles.filter((_, k) => k !== i);
  const empty = roles.findIndex((r, k) => !r.conds.length && was[k].conds.length > 0 && r.ref === undefined);
  const out = { roles, together };
  return empty >= 0 ? dropRole(out, empty) : out;
}

/** 新加的一国:叫法挑没用过的;和第一国接壤(还没有国家时:中等大小) */
export function addRole(q: FinderQuery): FinderQuery {
  if (q.roles.length >= MAX_ROLES) return q;
  const name = ROLE_NAMES.find((n) => !q.roles.some((r) => r.name === n)) ?? `第 ${q.roles.length + 1} 国`;
  const conds: RoleCond[] = q.roles.length ? [{ kind: 'border', other: 0 }] : [{ kind: 'size', size: 'medium' }];
  return { ...q, roles: [...q.roles, { name, conds }] };
}

// ---------------------------------------------------------------------------
// 「＋ 加一条」的菜单

interface MenuItem {
  /** 菜单上的字 */
  text: string;
  /** 已经加了(打勾) */
  has: (conds: readonly AnyCond[]) => boolean;
  /** 点了以后这一组的条件:没打勾的加上,打勾的去掉 */
  apply: (conds: readonly AnyCond[], on: boolean) => AnyCond[];
}
type AnyCond = RoleCond | TogetherCond;
interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const kindIs =
  (...ks: string[]) =>
  (c: { kind: string }) =>
    ks.includes(c.kind);
const item = (text: string, kinds: string[], add: () => AnyCond): MenuItem => ({
  text,
  has: (cs) => cs.some(kindIs(...kinds)),
  apply: (cs, on) => (on ? cs.filter((c) => !kindIs(...kinds)(c)) : [...cs, add()]),
});

function roleMenu(q: FinderQuery, role: number): MenuGroup[] {
  const other = q.roles.findIndex((_, i) => i !== role);
  const on = other >= 0;
  const o = on ? otherName(q, other) : '';
  return [
    {
      title: '地形',
      items: [
        item('边界几成是翻山', ['mountain'], () => ({ kind: 'mountain', min: 0.2 })),
        item('平均海拔高过多少米', ['elevation'], () => ({ kind: 'elevation', min: 1000 })),
        ...(on ? [item(`比「${o}」高`, ['higher'], () => ({ kind: 'higher', other, by: 300 }))] : []),
      ],
    },
    {
      title: '国家',
      items: [
        item('大小', ['size'], () => ({ kind: 'size', size: 'medium' })),
        item('邻国至少几个', ['neighbors'], () => ({ kind: 'neighbors', min: 3 })),
        item('有通航线的港口', ['ports'], () => ({ kind: 'ports', min: 1 })),
        item('开场那年已经立国多少年', ['age'], () => ({ kind: 'age', min: 100 })),
        item('在什么时代 / 多少年后进什么时代', ['era', 'eraEnter'], () => ({ kind: 'era', era: 1 })),
        item('开场后多少年内亡、分裂或改朝', ['fate'], () => ({ kind: 'fate', within: 100, what: ['split', 'fall'] })),
      ],
    },
    ...(on
      ? [
          {
            title: '和别国',
            items: [
              item('接壤 / 隔山有隘口', ['border', 'pass'], () => ({ kind: 'border', other })),
              item('开场后多少年内打过仗', ['war'], () => ({ kind: 'war', other, within: 50 })),
              item('占过对方的地 / 被对方占过', ['conquer'], () => ({ kind: 'conquer', other, dir: 'took', within: 100, min: 2 })),
            ],
          },
        ]
      : []),
    { title: '交界', items: [item('它的一州同时挨着几国', ['junction'], () => ({ kind: 'junction', min: 3 }))] },
  ];
}

function togetherMenu(q: FinderQuery): MenuGroup[] {
  const free = (c: AnyCond) => c.kind === 'junction' && 'unowned' in c && !!c.unowned;
  return [
    {
      title: '交界',
      items: [
        item('有一州同时挨着几国', ['junction'], () => ({ kind: 'junction', min: 3 })),
        {
          // 要无主:有交界那一条就在它上面打开 / 关掉,没有就加一条要无主的
          text: '那州要无主（中立地）',
          has: (cs) => cs.some(free),
          apply: (cs, on) =>
            cs.some((c) => c.kind === 'junction')
              ? cs.map((c) => (c.kind === 'junction' && !('role' in c) ? { ...c, unowned: !on } : c))
              : [...cs, { kind: 'junction', min: 3, unowned: true }],
        },
      ],
    },
    {
      title: '故事',
      items: [
        item('故事讲多少年', ['span'], () => ({ kind: 'span', years: 100 })),
        item('开场年份', ['start'], () => (q.roles.length ? { kind: 'start', role: 0, era: 1, enter: 2, min: 15, max: 50 } : { kind: 'start', from: 500, to: 2500 })),
      ],
    },
  ];
}

/** 菜单开在哪:电脑在卡片右边(按钮那一行附近,不出窗口),手机从底下升起 */
interface MenuAt {
  role: number;
  x: number;
  y: number;
}

function AddMenu({ q, at, phone, onPick, onClose }: { q: FinderQuery; at: MenuAt; phone: boolean; onPick: (it: MenuItem, on: boolean) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(at.y);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    if (!phone) setTop(Math.max(12, Math.min(at.y - 84, window.innerHeight - h - 12)));
  }, [at.y, phone]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => window.addEventListener('pointerdown', down, true), 0);
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const together = at.role < 0;
  const groups = together ? togetherMenu(q) : roleMenu(q, at.role);
  const conds: readonly AnyCond[] = together ? q.together : (q.roles[at.role]?.conds ?? []);
  return (
    <div ref={ref} className={`fd-menu${phone ? ' phone' : ''}`} role="menu" style={phone ? undefined : { left: at.x, top }} data-testid="finder-add-menu">
      <div className="fd-menu-head">
        加到 {together ? <b>一起</b> : <RoleTag q={q} i={at.role} small />}
      </div>
      {groups.map((g) => (
        <div key={g.title} className="fd-menu-grp">
          <div className="fd-menu-title">{g.title}</div>
          {g.items.map((it) => {
            const on = it.has(conds);
            return (
              <button key={it.text} className="fd-menu-item" role="menuitemcheckbox" aria-checked={on} onClick={() => onPick(it, on)}>
                <span className="fd-menu-ck">{on && <Icon name="check" size={14} />}</span>
                {it.text}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 一国一组

function RoleGroup({ q, i, first, onMenu, put }: { q: FinderQuery; i: number; first: boolean; onMenu: (role: number, el: HTMLElement) => void; put: (q: FinderQuery) => void }) {
  const r = q.roles[i];
  const [naming, setNaming] = useState(false);
  const [text, setText] = useState(r.name);
  useEffect(() => setText(r.name), [r.name]);
  const commit = () => {
    setNaming(false);
    const name = text.trim().slice(0, NAME_MAX);
    if (name && name !== r.name) put({ ...q, roles: q.roles.map((x, k) => (k === i ? { ...x, name } : x)) });
    else setText(r.name);
  };
  return (
    <div className="fd-grp" data-role={i}>
      <div className="fd-row head">
        {naming ? (
          <input
            className={`${roleClass(i)} fd-name`}
            aria-label="这一国的叫法"
            value={text}
            maxLength={NAME_MAX}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        ) : (
          <button className={roleClass(i)} data-act="role-name" title="改叫法" onClick={() => setNaming(true)}>
            {r.name}
          </button>
        )}
        <span className="fd-v fd-hint">{first ? '叫法随你起' : ''}</span>
        <button className="fd-link" data-act="add-cond" onClick={(e) => onMenu(i, e.currentTarget)}>
          ＋ 加一条
        </button>
      </div>
      {r.conds.map((c, k) => (
        <RoleCondRow
          key={k}
          q={q}
          role={i}
          c={c}
          put={(nc) => {
            const conds = nc ? r.conds.map((x, j) => (j === k ? nc : x)) : r.conds.filter((_, j) => j !== k);
            put(withRole(q, i, conds));
          }}
        />
      ))}
      {roleFree(q, i) && (
        <div className="fd-row fd-hint" data-testid="finder-role-empty">
          还没有条件：找的时候不管它，搬过去以后大纲里的它要重新指。
        </div>
      )}
    </div>
  );
}

/** 约几分钟(按毫秒):"约 3 分钟""不到 1 分钟" */
export function aboutMinutes(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 1 ? '不到 1 分钟' : `约 ${m} 分钟`;
}

export function FinderConds({ ui, phone, seed, estimate }: { ui: FinderUi; phone: boolean; seed: number; estimate: (n: number) => number }) {
  const q = ui.query;
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const openMenu = (role: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const card = el.closest('.fd-panel')?.getBoundingClientRect();
    setMenu((m) => (m && m.role === role ? null : { role, x: (card?.right ?? r.right) - 18, y: r.top }));
  };
  const pick = (it: MenuItem, on: boolean) => {
    const at = menu;
    if (!at) return;
    if (at.role < 0) return setQuery({ ...q, together: it.apply(q.together, on) as TogetherCond[] });
    const conds = it.apply(q.roles[at.role].conds, on) as RoleCond[];
    setQuery(withRole(q, at.role, conds));
    // 这一国的条件都去掉了:这一国也去掉,菜单跟着收起
    if (!conds.length) setMenu(null);
  };
  const count = ui.count;
  const est = estimate(count);
  const canStart = q.roles.some((r) => r.conds.length) || q.together.length > 0;
  return (
    <>
      <div className="fd-body" data-page="conds">
        <div className="fd-chips">
          <span className="fd-chips-lab">{phone ? '例子' : '从例子改'}</span>
          {FINDER_PRESETS.map((p) => (
            <button key={p.id} className={`fd-chip${ui.preset === p.id ? ' on' : ''}`} data-preset={p.id} onClick={() => pickPreset(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <section>
          <div className="fd-sec-head">
            <span>故事里的国家</span>
            {q.roles.length < MAX_ROLES && (
              <button className="fd-link" data-act="add-role" onClick={() => setQuery(addRole(q))}>
                ＋ 再加一国
              </button>
            )}
          </div>
          <div className="fd-grps">
            {q.roles.map((_, i) => (
              <RoleGroup key={i} q={q} i={i} first={i === 0 && !phone} onMenu={openMenu} put={setQuery} />
            ))}
            {!q.roles.length && <div className="fd-grp fd-empty">没有指定国家：只看「一起」那几条。</div>}
          </div>
        </section>
        <section>
          <div className="fd-sec-head">
            <span>一起</span>
            <button className="fd-link" data-act="add-together" onClick={(e) => openMenu(-1, e.currentTarget)}>
              ＋ 加一条
            </button>
          </div>
          <div className="fd-grp">
            {q.together.map((c, k) => (
              <TogetherRow
                key={k}
                q={q}
                c={c}
                phone={phone}
                put={(nc) => setQuery({ ...q, together: nc ? q.together.map((x, j) => (j === k ? nc : x)) : q.together.filter((_, j) => j !== k) })}
              />
            ))}
            {!q.together.length && <div className="fd-row fd-hint">还没有。点「＋ 加一条」加交界、故事讲多少年、开场年份。</div>}
          </div>
        </section>
      </div>
      <footer className="fd-foot conds">
        <div className="fd-foot-line count">
          搜 <Num label="搜几个世界" value={count} min={1} max={5000} onChange={setFinderCount} /> 个世界
          {phone ? `，这部手机${aboutMinutes(est)}。锁屏或切走会暂停，回来接着算。` : `（种子 1–${count}），这台电脑${aboutMinutes(est)}`}
        </div>
        {!phone && (
          <div className="fd-foot-line">
            地图
            <span className="fd-seg" role="radiogroup" aria-label="地图">
              <button role="radio" aria-checked={ui.map === 'each'} className={ui.map === 'each' ? 'on' : ''} data-act="map-each" onClick={() => setFinderMap('each')}>
                每个世界换一张
              </button>
              <button role="radio" aria-checked={ui.map === 'fixed'} className={ui.map === 'fixed' ? 'on' : ''} data-act="map-fixed" onClick={() => setFinderMap('fixed')}>
                都用种子 {seed} 这张
              </button>
            </span>
          </div>
        )}
        <button className="fd-btn primary big" data-act="finder-start" disabled={!canStart} onClick={startFinder}>
          开始找
        </button>
      </footer>
      {menu && <AddMenu q={q} at={menu} phone={phone} onPick={pick} onClose={() => setMenu(null)} />}
    </>
  );
}
