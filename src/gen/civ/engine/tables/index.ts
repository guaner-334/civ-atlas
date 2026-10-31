/**
 * 数表:推演里"慢慢变"的量(人口、动荡、发展度、思潮……)记成一张张表,每张表按登记卡上的规则一步步算。
 * 登记卡见 cards.ts,公式语言见 formula.ts 和 compile.ts,引擎见 engine.ts。
 */
export { FREQUENCIES, budgetOf, cardProblems, colCount, TILE_COLS_PER_YEAR, REGION_COLS_PER_YEAR, type Budget, type TableCard, type Unit } from './cards';
export { parseFormula, FormulaError, type Program } from './formula';
export { compileCard, evalAllowed, RuleError, type Backend } from './compile';
export { TableEngine, TableSetupError, type EngineOptions, type EngineUnits, type FlowWindow, type Incident, type TableSnapshot } from './engine';
