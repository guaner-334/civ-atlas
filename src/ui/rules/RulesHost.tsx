/**
 * 调规则的页挂在哪:首页(HomeShell.tsx)和主程序(App.tsx)各挂一个 RulesHost,「我的世界」(MyWorlds.tsx)的「规则」分段放 RulesTabHost,
 * 新建世界(studio/Studio.tsx)里选规则的那一页放 RulesPickHost。
 * 代码和样式在 RulesUi.tsx 那一包里,打开大卡、点到「规则」分段时才下载(和立体地形一样按需加载,首页不多下载);
 * 下载的那一下什么都不画(一般不到一眨眼)。
 * 大卡上点「并排试推」打开的那一页(compare/ComparePage.tsx,盖在大卡上面)也挂在这里,同样点了才下载。
 */
import { lazy, Suspense } from 'react';
import { useRulesSheet } from './sheetStore';
import { useCompare } from '../compare/compareStore';
import type { RulesPickProps } from './RulesPick';

const Sheet = lazy(() => import('./RulesUi').then((m) => ({ default: m.RulesSheet })));
const Tab = lazy(() => import('./RulesUi').then((m) => ({ default: m.RulesTab })));
const Pick = lazy(() => import('./RulesUi').then((m) => ({ default: m.RulesPick })));
const Compare = lazy(() => import('../compare/ComparePage').then((m) => ({ default: m.ComparePage })));

/** 调规则的大卡、并排试推(开着的时候才下载、才挂上) */
export function RulesHost() {
  const s = useRulesSheet();
  const c = useCompare();
  if (!s && !c) return null;
  return (
    <>
      {s && (
        <Suspense fallback={null}>
          <Sheet />
        </Suspense>
      )}
      {c && (
        <Suspense fallback={null}>
          <Compare />
        </Suspense>
      )}
    </>
  );
}

/** 「我的世界」的「规则」分段 */
export function RulesTabHost({ phone, fileBtn }: { phone: boolean; fileBtn: boolean }) {
  return (
    <Suspense fallback={null}>
      <Tab phone={phone} fileBtn={fileBtn} />
    </Suspense>
  );
}

/** 新建世界里选规则的那一页 */
export function RulesPickHost(p: RulesPickProps) {
  return (
    <Suspense fallback={null}>
      <Pick {...p} />
    </Suspense>
  );
}
