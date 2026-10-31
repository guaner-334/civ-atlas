/**
 * 官方推演的全部旋钮表(各子系统"调参"那一段的数:名字、默认值;说明写在各文件每一项上面)。
 * 推演本身不读这个清单(各文件照自己的表算);它是给"看 / 调这些数"的地方用的总目录。
 */
import type { Knobs, KnobValue } from './engine/knobs';
import { ASSIMILATION_KNOBS } from './assimilation';
import { CITIES_KNOBS } from './cities';
import { CONSORTS_KNOBS } from './consorts';
import { CONTROL_KNOBS } from './control';
import { COUNCIL_KNOBS } from './council';
import { COUNCIL_RULES_KNOBS } from './councilRules';
import { DIPLOMACY_KNOBS } from './diplomacy';
import { DYNASTY_KNOBS } from './dynasty';
import { EXILE_KNOBS } from './exile';
import { KIN_KNOBS } from './kin';
import { MARRIAGES_KNOBS } from './marriages';
import { MIGRATION_KNOBS } from './migration';
import { OFFICIALS_KNOBS } from './officials';
import { PANDEMIC_KNOBS } from './pandemic';
import { PEOPLE_KNOBS } from './people';
import { PLAGUE_KNOBS } from './plague';
import { POLICY_KNOBS } from './policy';
import { POLITICS_KNOBS } from './politics';
import { POLITIES_KNOBS } from './polities';
import { POPULATION_KNOBS } from './population';
import { REFORM_KNOBS } from './reform';
import { REGENTS_KNOBS } from './regents';
import { REGIONS_KNOBS } from './regions';
import { ROUTES_KNOBS } from './routes';
import { ROYALS_KNOBS } from './royals';
import { RULERS_KNOBS } from './rulers';
import { TREATIES_KNOBS } from './treaties';
import { UNREST_KNOBS } from './unrest';
import { WARS_KNOBS } from './wars';
import { WOMEN_KNOBS } from './women';

export const CIV_KNOBS: readonly Knobs<Record<string, KnobValue>>[] = [
  ASSIMILATION_KNOBS,
  CITIES_KNOBS,
  CONSORTS_KNOBS,
  CONTROL_KNOBS,
  COUNCIL_KNOBS,
  COUNCIL_RULES_KNOBS,
  DIPLOMACY_KNOBS,
  DYNASTY_KNOBS,
  EXILE_KNOBS,
  KIN_KNOBS,
  MARRIAGES_KNOBS,
  MIGRATION_KNOBS,
  OFFICIALS_KNOBS,
  PANDEMIC_KNOBS,
  PEOPLE_KNOBS,
  PLAGUE_KNOBS,
  POLICY_KNOBS,
  POLITICS_KNOBS,
  POLITIES_KNOBS,
  POPULATION_KNOBS,
  REFORM_KNOBS,
  REGENTS_KNOBS,
  REGIONS_KNOBS,
  ROUTES_KNOBS,
  ROYALS_KNOBS,
  RULERS_KNOBS,
  TREATIES_KNOBS,
  UNREST_KNOBS,
  WARS_KNOBS,
  WOMEN_KNOBS,
];
