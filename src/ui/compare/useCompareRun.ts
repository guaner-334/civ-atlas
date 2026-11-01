/**
 * 并排试推的两段历史和画图用的地图:换地图时全部重来(生成地图的线程、推历史的线程都换);
 * 右边换规则(推不下去时改回那两项)只重推右边,左边接着推。
 * 地图生成的进度用和打开世界一样的顶部提示条(「正在生成地图」)。
 */
import { useEffect, useRef, useState } from 'react';
import type { Civ } from '../../gen/civ/types';
import type { TuningValues } from '../../gen/civ/tuning';
import { CompareRun } from './compareClient';
import { makeDrawMap, type DrawMap } from './drawMap';
import type { MapChoice } from './compareMaps';
import { clearToast, showToast } from '../toastStore';

/** 一段历史现在怎样 */
export interface SideState {
  /** 交来的最新一份(还没交 = null) */
  civ: Civ | null;
  /** 推到第几年了(交来的那份之后还在往前推的也算) */
  progress: number;
  status: 'run' | 'done' | 'failed';
  /** 推不下去:出错的那一年;crashed = 后台线程停了(不是规则的事) */
  at?: number;
  crashed?: boolean;
}

const fresh = (): SideState => ({ civ: null, progress: 0, status: 'run' });

const TOAST = 'compare-map';

export function useCompareRun(choice: MapChoice, tuning: TuningValues | undefined, threads: number, failAt?: number) {
  const [map, setMap] = useState<DrawMap | null>(null);
  const [mapError, setMapError] = useState(false);
  const [sides, setSides] = useState<SideState[]>(() => [fresh(), fresh()]);
  const run = useRef<CompareRun | null>(null);
  const tuningNow = useRef(tuning);
  tuningNow.current = tuning;

  useEffect(() => {
    let live = true;
    setMap(null);
    setMapError(false);
    setSides([fresh(), fresh()]);
    const patch = (side: number, f: (s: SideState) => SideState) => live && setSides((all) => all.map((s, i) => (i === side ? f(s) : s)));
    const r = new CompareRun({
      map: choice.map,
      setup: choice.setup,
      sides: [undefined, tuningNow.current],
      threads,
      ...(failAt !== undefined ? { failAt: [undefined, failAt] } : {}),
      on: {
        progress: (side, year) => patch(side, (s) => ({ ...s, progress: Math.max(s.progress, year) })),
        civ: (side, civ, done) => patch(side, (s) => ({ ...s, civ, progress: Math.max(s.progress, civ.endYear), status: done ? 'done' : 'run' })),
        failed: (side, at, civ, crashed) => patch(side, (s) => ({ ...s, civ: civ ?? s.civ, status: 'failed', at, crashed })),
      },
    });
    run.current = r;
    const label = choice.label.replace(/的地图$/, '');
    const m = makeDrawMap(choice.map, (stage, pct) => {
      if (live) showToast({ id: TOAST, kind: 'progress', text: '正在生成地图', more: [`${label}，${stage}`], progress: pct });
    });
    m.done.then(
      (d) => {
        if (!live) return;
        clearToast(TOAST);
        setMap(d);
      },
      () => {
        if (!live) return;
        clearToast(TOAST);
        setMapError(true);
      },
    );
    return () => {
      live = false;
      m.stop();
      r.dispose();
      if (run.current === r) run.current = null;
      clearToast(TOAST);
    };
    // 换地图才重来(规则改了只重推右边,见 restartSide;开几个线程打开时定下)
  }, [choice.key]);

  /** 第 side 段换一套规则(或照原样)从头推,另一段照旧 */
  const restartSide = (side: number, t: TuningValues | undefined) => {
    run.current?.restart(side, t);
    setSides((all) => all.map((s, i) => (i === side ? fresh() : s)));
  };
  const restartRight = (t: TuningValues | undefined) => restartSide(1, t);

  return { map, mapError, sides, restartRight, restartSide };
}
