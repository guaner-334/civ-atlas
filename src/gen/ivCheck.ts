/**
 * 插件交上来的干预(工具插件改作者的修改、推演插件下命令)照这里查,不清理。和 edits.ts 分开放:首页不下载它。
 */
import { INTERVENTION_KINDS, INTERVENTION_YEAR_MAX, NAME_MAX, cleanName, tidyIntervention, type Intervention, type InterventionKind } from './edits';
import { SLUMP_DEFAULT } from './civ/calamity';

const IV_YEARS = ['from', 'until', 'born', 'died'] as const;
/** 去掉也不算改了意思的几样:取 0、false 的开关和滑条,空的国名,等于默认的疫后年数 */
const IV_ZERO_OK: ReadonlySet<string> = new Set(['war', 'expand', 'coast', 'peace', 'term', 'fromTick']);
const ivNoop = (k: string, x: unknown) => x === false || (x === 0 && IV_ZERO_OK.has(k)) || (k === 'name' && x === '') || (k === 'slump' && x === SLUMP_DEFAULT);

/**
 * 清理(edits.ts 的 cleanIntervention)会改掉、丢掉的就不收(上面 ivNoop 那几样、补上的默认值除外);
 * 立国的国名照改名的规矩去掉末尾的「国」这类,剩下的超过 NAME_MAX 字算超了上限(limit)。
 * 合格的返回字段先后照清理排好的一份
 */
export function checkIntervention(x: unknown): { ok: Intervention } | { error: string; limit?: true } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { error: '要是一个对象' };
  const o = x as Record<string, unknown>;
  if (!INTERVENTION_KINDS.includes(o.kind as InterventionKind)) return { error: `kind 只能是 ${INTERVENTION_KINDS.join('、')}` };
  for (const k of IV_YEARS) {
    const y = o[k];
    if (y === undefined ? k === 'from' : !(Number.isInteger(y) && (y as number) >= 0 && (y as number) <= INTERVENTION_YEAR_MAX)) return { error: `${k} 要是 0–${INTERVENTION_YEAR_MAX} 的整数年份` };
  }
  if (o.until !== undefined && (o.until as number) <= (o.from as number)) return { error: 'until 要比 from 晚' };
  if (o.kind === 'found' && typeof o.name === 'string' && [...cleanName('polity', o.name, false, Infinity)].length > NAME_MAX) return { error: `name 最多 ${NAME_MAX} 个字`, limit: true };
  const v = tidyIntervention(x);
  if (!v) return { error: `不是合格的 ${String(o.kind)}:要的字段缺了、键的格式不对,或者两方是同一个` };
  const w = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const a = o[k];
    if (a === undefined) continue;
    if (!(k in w)) {
      if (!ivNoop(k, a)) return { error: `${k} 不合规矩` };
    } else if (JSON.stringify(a) !== JSON.stringify(w[k]) && !(k === 'name' && o.kind === 'found')) return { error: `${k} 不合规矩` };
  }
  return { ok: v };
}
