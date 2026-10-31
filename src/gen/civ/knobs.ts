/**
 * 官方推演的全部旋钮表(各子系统"调参"那一段的数:名字、默认值;说明写在各文件每一项上面)。
 * 推演本身不读这个清单(各文件照自己的表算);它是给"看 / 调这些数"的地方用的总目录。
 */
import type { Knobs, KnobValue } from './engine/knobs';
import { ASSIMILATION_KNOBS } from './assimilation';
import { CITIES_KNOBS } from './cities';
import { CONTROL_KNOBS } from './control';
import { COUNCIL_KNOBS } from './council';
import { COUNCIL_RULES_KNOBS } from './councilRules';
import { DIPLOMACY_KNOBS } from './diplomacy';
import { DYNASTY_KNOBS } from './dynasty';
import { EXILE_KNOBS } from './exile';
import { MIGRATION_KNOBS } from './migration';
import { POLICY_KNOBS } from './policy';
import { POLITICS_KNOBS } from './politics';
import { REFORM_KNOBS } from './reform';
import { REGENTS_KNOBS } from './regents';
import { TREATIES_KNOBS } from './treaties';
import { UNREST_KNOBS } from './unrest';
import { WARS_KNOBS } from './wars';

export const CIV_KNOBS: readonly Knobs<Record<string, KnobValue>>[] = [
  ASSIMILATION_KNOBS,
  CITIES_KNOBS,
  CONTROL_KNOBS,
  COUNCIL_KNOBS,
  COUNCIL_RULES_KNOBS,
  DIPLOMACY_KNOBS,
  DYNASTY_KNOBS,
  EXILE_KNOBS,
  MIGRATION_KNOBS,
  POLICY_KNOBS,
  POLITICS_KNOBS,
  REFORM_KNOBS,
  REGENTS_KNOBS,
  TREATIES_KNOBS,
  UNREST_KNOBS,
  WARS_KNOBS,
];
