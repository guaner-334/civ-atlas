/**
 * 调规则的页点了才下载的那一包(RulesHost.tsx 按需加载):调规则的大卡、「我的世界」的「规则」分段、新建世界里选规则的那一页,
 * 连同它们的样式。
 * 打开网站时不下载,首页不变大。
 */
import './rules.css';

export { RulesSheet } from './RulesSheet';
export { RulesTab } from './RulesList';
export { RulesPick } from './RulesPick';
