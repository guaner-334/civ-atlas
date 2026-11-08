/** 世界用的推演插件本机对不上、要接着推时问的窗(plugins/SimAsk.tsx,问的时候才下载) */
import { Suspense, lazy } from 'react';
import { useSimAsk } from './simAsk';

const SimAskBox = lazy(() => import('../plugins/SimAsk'));

export function SimAskHost({ phone }: { phone: boolean }) {
  const ask = useSimAsk();
  if (!ask) return null;
  return (
    <Suspense fallback={null}>
      <SimAskBox ask={ask} phone={phone} />
    </Suspense>
  );
}
