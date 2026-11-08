/** 插件图层、插件存进世界的数据在界面上的几处空位(地块图层、标注、图例、读存着的图层、先问的框、世界设定里的一组);代码用到才下载 */
import { Suspense, lazy, useEffect, useMemo, type ComponentProps } from 'react';
import { dataAsk } from './askState';
import { chipOn, currentShown, layerChips, pickPluginLayer, pluginLayers, refreshLayerPlugins } from './layerState';

const load = () => import('./layers/LayerView');
const Cells = lazy(() => load().then((m) => ({ default: m.CellCanvas })));
const Marks = lazy(() => load().then((m) => ({ default: m.MarksCanvas })));
const Legend = lazy(() => load().then((m) => ({ default: m.PluginLegend })));
const Saved = lazy(() => load().then((m) => ({ default: m.SavedLoader })));

/** 有没有正显示的地块图层(左上角要不要放图例) */
export const usePluginLegendOn = (): boolean => pluginLayers.use(() => !!currentShown());

export function PluginCellSlot(p: ComponentProps<typeof Cells>) {
  if (!usePluginLegendOn()) return null;
  return (
    <Suspense fallback={null}>
      <Cells {...p} />
    </Suspense>
  );
}

export function PluginMarksSlot(p: ComponentProps<typeof Marks>) {
  const has = pluginLayers.use(() => [...pluginLayers.get().live.values()].some((l) => l.layer.kind === 'marks'));
  if (!has) return null;
  return (
    <Suspense fallback={null}>
      <Marks {...p} />
    </Suspense>
  );
}

export function PluginLegendSlot(p: ComponentProps<typeof Legend>) {
  if (!usePluginLegendOn()) return null;
  return (
    <Suspense fallback={null}>
      <Legend {...p} />
    </Suspense>
  );
}

export function PluginSavedSlot(p: ComponentProps<typeof Saved>) {
  return (
    <Suspense fallback={null}>
      <Saved {...p} />
    </Suspense>
  );
}

/** 图层面板「数据底图」下面一组「插件图层」:一个地块图层一个按钮,选中的蓝底;再点一下收起。没有插件图层就不放 */
export function PluginLayerChips({ phone }: { phone: boolean }) {
  const s = pluginLayers.use(pluginLayers.get);
  const chips = useMemo(() => layerChips(s), [s]);
  useEffect(refreshLayerPlugins, []);
  if (!chips.length) return null;
  const sim = chips.some((c) => c.sim);
  const timed = sim || chips.some((c) => c.timed);
  return (
    <>
      <div className="lp-sec">插件图层</div>
      <div className={`lp-chips${sim ? ' plg-chips' : ''}`} role="group" aria-label="插件图层">
        {chips.map((c) => {
          const on = chipOn(s, c.key);
          return (
            <button key={c.key} className={`lp-chip plg-chip${c.sim ? ' sim' : ''}${on ? ' on' : ''}`} aria-pressed={on} data-plugin-layer={c.key} title={c.label} onClick={() => pickPluginLayer(c.key)}>
              {c.label}
              {c.sim && <span className="plg-ctag">推演</span>}
            </button>
          );
        })}
      </div>
      <div className="lp-hint">
        {!timed ? (
          '插件交来的，盖在底图上；再点一下收起'
        ) : phone ? (
          '插件交来的，盖在底图上；带年份的跟着时间轴变'
        ) : (
          <>
            插件交来的，盖在底图上；再点一下收起。
            <br />
            带年份的图层跟着时间轴变。
          </>
        )}
      </div>
    </>
  );
}

const Ask = lazy(() => import('./WorldDataAsk'));
const WorldPlugins = lazy(() => import('./WorldPluginsSection'));

/** 插件第一次往这个世界里存数据时问的框、去掉插件存的数据时的确认框 */
export function PluginAskSlot({ phone }: { phone: boolean }) {
  const ask = dataAsk.use();
  if (!ask) return null;
  return (
    <Suspense fallback={null}>
      <Ask ask={ask} phone={phone} />
    </Suspense>
  );
}

/** 世界设定页「用到的插件」一组(没用插件的世界什么都不放) */
export function WorldPluginsSlot(p: ComponentProps<typeof WorldPlugins>) {
  return (
    <Suspense fallback={null}>
      <WorldPlugins {...p} />
    </Suspense>
  );
}
