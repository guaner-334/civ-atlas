/**
 * 调规则的页挂在哪:首页(HomeShell.tsx)和主程序(App.tsx)各挂一个 RulesHost,「我的世界」(MyWorlds.tsx)的「规则」分段放 RulesTabHost。
 * 代码和样式在 RulesUi.tsx 那一包里,打开大卡、点到「规则」分段时才下载(和立体地形一样按需加载,首页不多下载);
 * 下载的那一下什么都不画(一般不到一眨眼)。
 */
import { lazy, Suspense } from 'react';
import { useRulesSheet } from './sheetStore';

const Sheet = lazy(() => import('./RulesUi').then((m) => ({ default: m.RulesSheet })));
const Tab = lazy(() => import('./RulesUi').then((m) => ({ default: m.RulesTab })));

/** 调规则的大卡(开着的时候才下载、才挂上) */
export function RulesHost() {
  const s = useRulesSheet();
  if (!s) return null;
  return (
    <Suspense fallback={null}>
      <Sheet />
    </Suspense>
  );
}

/** 「我的世界」的「规则」分段 */
export function RulesTabHost({ phone }: { phone: boolean }) {
  return (
    <Suspense fallback={null}>
      <Tab phone={phone} />
    </Suspense>
  );
}
