/**
 * 界面骨架的纯逻辑:图层 ↔ (画风, 数据图层, 国家 / 民族 / 信仰开关) 的换算、网址里的图层、深浅主题;顶部提示条的 store;
 * 宽屏左边侧栏卡片的收起 / 展开;地图飞回整张图时的进度。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAP_LAYERS,
  baseDark,
  baseLook,
  baseName,
  baseOf,
  baseThumb,
  fillOf,
  fillShow,
  layerDark,
  layerDef,
  layerFromUrl,
  layerOf,
  layerParts,
  layerShow,
  mapViewFromUrl,
  writeMapView,
} from '../src/ui/mapLayers';
import { _resetToasts, clearToast, getToast, peekToast, showToast } from '../src/ui/toastStore';
import { closeOverview, getOverview, openOverview } from '../src/ui/overviewStore';
import { clearSelection, getChronicle, getSelection, setChronicle, setSelection } from '../src/ui/civView';
import { collapseSide, expandSide, getSide, setSideHold } from '../src/ui/sideStore';
import { FLY_MS, animProgress, easeOutCubic, flatFly, sideRoom } from '../src/ui/flyTo';

describe('图层换算', () => {
  it('每个图层换成设置再换回来还是它自己', () => {
    for (const l of MAP_LAYERS) {
      expect(layerOf(l.style, l.data ?? 'biomes', layerShow(l))).toBe(l.id);
    }
  });
  it('旧的组合也认得出:写实 + 国家算实景;手绘 + 国家 + 民族算政区;没有数据图层名的算生态;信仰开着(手绘)算信仰', () => {
    expect(layerOf('realistic', 'biomes', { polities: true, cultures: false })).toBe('realistic');
    expect(layerOf('realistic', 'biomes', { polities: true, cultures: false, faiths: true })).toBe('realistic');
    expect(layerOf('fantasy', 'biomes', { polities: false, cultures: true, faiths: true })).toBe('faith');
    expect(layerOf('fantasy', 'biomes', { polities: true, cultures: true })).toBe('political');
    expect(layerOf('fantasy', 'biomes', { polities: false, cultures: false })).toBe('terrain');
    expect(layerOf('data', 'temperature', { polities: true, cultures: false })).toBe('temperature');
  });
  it('时代、物产是第二行小字按钮:时代留国界(开着国家),物产不叠国家;网址 layer=era / layer=resources', () => {
    expect(MAP_LAYERS.filter((l) => l.dev).map((l) => l.id)).toEqual(['era', 'resources']);
    expect(layerShow(layerDef('era'))).toEqual({ polities: true, cultures: false, faiths: false, eras: true, resources: false });
    expect(layerShow(layerDef('resources'))).toEqual({ polities: false, cultures: false, faiths: false, eras: false, resources: true });
    expect(layerOf('fantasy', 'biomes', { polities: true, cultures: false, eras: true })).toBe('era');
    expect(layerFromUrl(new URLSearchParams('seed=7&layer=era'))).toBe('era');
    expect(layerFromUrl(new URLSearchParams('seed=7&layer=resources'))).toBe('resources');
  });
  it('深色主题:实景、高程、降水;六张缩略图是政区、民族、信仰、地形、生态、实景', () => {
    expect(MAP_LAYERS.filter((l) => layerDark(l.id)).map((l) => l.id)).toEqual(['realistic', 'elevation', 'precipitation']);
    expect(MAP_LAYERS.filter((l) => l.main).map((l) => l.id)).toEqual(['political', 'cultures', 'faith', 'terrain', 'biomes', 'realistic']);
  });
  it('网址:带 style= 的旧链接照旧;没有 style= 时 layer= 是新图层名;都没有默认政区(有 civ= 就按 civ=)', () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(layerFromUrl(q('seed=7&style=fantasy'))).toBe(null);
    expect(layerFromUrl(q('seed=7&style=data&layer=plates'))).toBe(null);
    expect(layerFromUrl(q('seed=7&layer=realistic'))).toBe('realistic');
    expect(layerFromUrl(q('seed=7&layer=elevation'))).toBe('elevation');
    expect(layerFromUrl(q('seed=7&layer=faith'))).toBe('faith');
    expect(layerFromUrl(q('seed=7&civ=cultures'))).toBe(null);
    expect(layerFromUrl(q('seed=7'))).toBe('political');
    expect(layerFromUrl(q('seed=7&layer=nonsense'))).toBe('political');
  });
});

describe('底图 × 填色', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('旧图层的对应:政区 = 手绘 + 国家,信仰 = 手绘 + 信仰,地形 = 手绘 + 不填,实景 = 经典卫星 + 不填,高程 = 高程 + 不填', () => {
    expect(layerParts('political')).toEqual({ base: 'fantasy', fill: 'polities' });
    expect(layerParts('cultures')).toEqual({ base: 'fantasy', fill: 'cultures' });
    expect(layerParts('faith')).toEqual({ base: 'fantasy', fill: 'faiths' });
    expect(layerParts('terrain')).toEqual({ base: 'fantasy', fill: 'none' });
    expect(layerParts('realistic')).toEqual({ base: 'satellite', fill: 'none', sat: 'classic' });
    expect(layerParts('elevation')).toEqual({ base: 'elevation', fill: 'none' });
    expect(layerParts('era')).toEqual({ base: 'fantasy', fill: 'eras' });
    expect(layerParts('resources')).toEqual({ base: 'fantasy', fill: 'none', resources: true });
  });
  it('填色和文明层开关互换:信仰留着国界;任何底图都能配任何填色', () => {
    for (const f of ['none', 'polities', 'cultures', 'faiths', 'eras'] as const) expect(fillOf(fillShow(f))).toBe(f);
    expect(fillShow('faiths')).toEqual({ polities: true, cultures: false, faiths: true, eras: false });
    expect(fillShow('eras')).toEqual({ polities: true, cultures: false, faiths: false, eras: true });
    // 物产是叠加开关,换填色不碰它
    expect('resources' in fillShow('none')).toBe(false);
    for (const b of ['fantasy', 'satellite', 'geo', 'blank', 'elevation'] as const) {
      const l = baseLook(b, 'detail');
      expect(baseOf(l.style, l.data ?? 'biomes', l.look ?? 'detail')).toBe(b);
    }
    expect(baseLook('satellite', 'classic')).toEqual({ style: 'realistic', look: 'classic' });
    expect(baseLook('geo', 'classic')).toEqual({ style: 'realistic', look: 'geo' });
  });
  it('名字、深色界面、缩略图:卫星按画法写「经典卫星」或「卫星」;白模浅色,卫星、地理图深色', () => {
    expect(baseName('satellite', 'classic')).toBe('经典卫星');
    expect(baseName('satellite', 'detail')).toBe('卫星');
    expect(baseName('elevation', 'detail')).toBe('高程');
    expect([baseDark('satellite'), baseDark('geo'), baseDark('blank'), baseDark('fantasy'), baseDark('elevation'), baseDark('plates')]).toEqual([true, true, false, false, true, false]);
    expect(baseThumb('satellite', 'classic')).toBe('realistic');
    expect(baseThumb('satellite', 'detail')).toBe('realistic:detail');
    expect(baseThumb('blank', 'detail')).toBe('realistic:blank');
    expect(baseThumb('fantasy', 'detail')).toBe('terrain');
  });
  it('读网址:map= / fill= / sat=;卫星没写画法按经典;旧链接按旧图层认;只有 civ= 或带 style= 的照原样', () => {
    expect(mapViewFromUrl(q('map=geo&fill=cultures'))).toEqual({ base: 'geo', fill: 'cultures', sat: undefined });
    expect(mapViewFromUrl(q('map=satellite&sat=detail'))).toEqual({ base: 'satellite', fill: 'polities', sat: 'detail' });
    expect(mapViewFromUrl(q('map=satellite'))?.sat).toBe('classic');
    expect(mapViewFromUrl(q('fill=none'))).toEqual({ base: 'fantasy', fill: 'none', sat: undefined });
    expect(mapViewFromUrl(q('layer=realistic'))).toEqual({ base: 'satellite', fill: 'none', sat: 'classic' });
    expect(mapViewFromUrl(q('layer=faith'))).toEqual({ base: 'fantasy', fill: 'faiths' });
    expect(mapViewFromUrl(q('layer=resources'))).toEqual({ base: 'fantasy', fill: 'none', resources: true });
    expect(mapViewFromUrl(q('fill=eras'))?.fill).toBe('eras');
    expect(mapViewFromUrl(q(''))).toEqual({ base: 'fantasy', fill: 'polities' });
    expect(mapViewFromUrl(q('style=realistic'))).toBeNull();
    expect(mapViewFromUrl(q('civ=cultures'))).toBeNull();
  });
  it('写网址:默认的手绘、国家省掉,卫星才写画法;去掉旧的 style=、layer= 和 civ= 里的填色开关;写完再读回来一样', () => {
    const w = (s: string, v: Parameters<typeof writeMapView>[1]) => writeMapView(q(s), v).toString();
    expect(w('seed=7&layer=realistic&style=fantasy', { base: 'fantasy', fill: 'polities', sat: 'detail' })).toBe('seed=7');
    expect(w('seed=7&civ=cultures,-labels', { base: 'blank', fill: 'polities', sat: 'detail' })).toBe('seed=7&civ=-labels&map=blank');
    expect(w('', { base: 'satellite', fill: 'none', sat: 'detail' })).toBe('map=satellite&fill=none&sat=detail');
    expect(w('civ=-labels', { base: 'fantasy', fill: 'polities', sat: 'detail' })).toBe('civ=-labels&fill=polities');
    expect(w('sat=classic', { base: 'elevation', fill: 'faiths', sat: 'classic' })).toBe('map=elevation&fill=faiths');
    expect(w('civ=eras,resources', { base: 'fantasy', fill: 'eras', sat: 'detail' })).toBe('civ=resources&fill=eras');
    for (const v of [
      { base: 'satellite', fill: 'cultures', sat: 'classic' },
      { base: 'geo', fill: 'none', sat: 'detail' },
      { base: 'temperature', fill: 'polities', sat: 'detail' },
    ] as const) {
      const back = mapViewFromUrl(writeMapView(q(''), v));
      expect(back?.base).toBe(v.base);
      expect(back?.fill).toBe(v.fill);
      if (v.base === 'satellite') expect(back?.sat).toBe(v.sat);
    }
  });
});

describe('顶部提示条', () => {
  afterEach(() => {
    _resetToasts();
    vi.useRealTimers();
  });
  it('同一时间只显示最近的一条;它收起后露出下面还在的那条', () => {
    showToast({ id: 'pick', kind: 'info', text: '在地图上点结盟的对象' });
    showToast({ id: 'save', kind: 'warn', text: '已打开存档' });
    expect(getToast()?.id).toBe('save');
    clearToast('save');
    expect(getToast()?.text).toBe('在地图上点结盟的对象');
    // 收起别的来源不影响正在显示的
    clearToast('progress');
    expect(getToast()?.id).toBe('pick');
    clearToast();
    expect(getToast()).toBe(null);
  });
  it('"已完成"不盖住还没关的警告:排在它下面,警告关了再露出来', () => {
    showToast({ id: 'save', kind: 'warn', text: '这个存档来自旧版本' });
    showToast({ id: 'terrain', kind: 'ok', text: '已按新地形重新生成' });
    expect(getToast()?.id).toBe('save');
    showToast({ id: 'pick', kind: 'info', text: '在地图上点结盟的对象' });
    expect(getToast()?.id).toBe('pick');
    clearToast('pick');
    clearToast('save');
    expect(getToast()?.id).toBe('terrain');
  });
  it('带"撤销"的已完成照常排最前:它几秒就收,压在警告下面就一眼都看不到', () => {
    vi.useFakeTimers();
    showToast({ id: 'storage', kind: 'warn', text: '没能自动存档:浏览器存储已满' });
    showToast({ id: 'save', kind: 'ok', text: '已删除「苍澜界」', action: { label: '撤销', onClick: () => {} } });
    expect(getToast()?.id).toBe('save');
    vi.advanceTimersByTime(7100);
    expect(getToast()?.id).toBe('storage');
  });
  it('两个按钮(二选一):按顺序排,只给 action 的老调用照旧', () => {
    const picked: string[] = [];
    showToast({
      id: 'share-ask',
      kind: 'warn',
      text: '这个世界本地也改过,有 1 处和链接不同',
      dismissible: false,
      actions: [
        { label: '用链接里的', primary: true, act: 'share-use', onClick: () => picked.push('use') },
        { label: '保留本地', act: 'share-keep', onClick: () => picked.push('keep') },
      ],
    });
    const t = getToast()!;
    expect(t.actions?.map((a) => a.label)).toEqual(['用链接里的', '保留本地']);
    t.actions!.forEach((a) => a.onClick());
    expect(picked).toEqual(['use', 'keep']);
    showToast({ id: 'resim-done', kind: 'ok', text: '已撤销', action: { label: '撤销', onClick: () => {} } });
    expect(peekToast('resim-done')?.action?.label).toBe('撤销');
    expect(peekToast('resim-done')?.actions).toBeUndefined();
  });
  it('同一来源再 show 是更新;ok 默认 7 秒收起,ttl 可以改,0 = 一直留着', () => {
    vi.useFakeTimers();
    showToast({ id: 'progress', kind: 'progress', text: '生成', progress: 0.2 });
    showToast({ id: 'progress', kind: 'progress', text: '生成', progress: 0.6 });
    expect(peekToast('progress')?.progress).toBe(0.6);
    showToast({ id: 'done', kind: 'ok', text: '已生效' });
    showToast({ id: 'undo', kind: 'ok', text: '已撤销', ttl: 4000 });
    showToast({ id: 'keep', kind: 'ok', text: '已导出', ttl: 0 });
    vi.advanceTimersByTime(4100);
    expect(peekToast('undo')).toBe(null);
    expect(peekToast('done')).not.toBe(null);
    vi.advanceTimersByTime(3000);
    expect(peekToast('done')).toBe(null);
    expect(peekToast('keep')).not.toBe(null);
    expect(getToast()?.id).toBe('keep');
  });
});

describe('世界概览', () => {
  it('收起概览时编年史的"只看这一国"清掉(时间轴回到全部国家),概览不会被重新打开', () => {
    openOverview('chronicle', { polity: 3 });
    expect(getOverview()).toEqual({ open: true, tab: 'chronicle' });
    expect(getChronicle()).toMatchObject({ open: true, polity: 3 });
    closeOverview();
    expect(getOverview().open).toBe(false);
    expect(getChronicle()).toMatchObject({ open: false, polity: null });
    // 老办法关编年史(setChronicle({ open: false }))也一样
    openOverview('chronicle', { polity: 5 });
    setChronicle({ open: false });
    expect(getOverview().open).toBe(false);
    expect(getChronicle().polity).toBe(null);
    // 开着概览时换"只看哪一国"照常
    openOverview('countries');
    setChronicle({ polity: 2 });
    expect(getChronicle().polity).toBe(2);
    closeOverview();
    expect(getChronicle().polity).toBe(null);
  });
});

describe('侧栏收起', () => {
  afterEach(() => {
    clearSelection();
    setSideHold(false);
    expandSide();
  });
  it('收起:卡片占掉的宽度只剩左边距(和 desktop.css 的 --side-room 一致);窄屏照旧是 0;展开回到原来', () => {
    expect(getSide()).toEqual({ collapsed: false, peek: false });
    expect(sideRoom(1440)).toBe(400);
    collapseSide();
    expect(getSide()).toEqual({ collapsed: true, peek: false });
    expect(sideRoom(1440)).toBe(14);
    expect(sideRoom(1024)).toBe(14);
    expect(sideRoom(390)).toBe(0);
    expandSide();
    expect(sideRoom(1440)).toBe(400);
    expect(sideRoom(1024)).toBe(368);
  });
  it('收起时选中了东西:卡片弹出来(让出它的宽度);取消选中又收回去', () => {
    collapseSide();
    setSelection({ kind: 'polity', id: 3 });
    expect(getSide().peek).toBe(true);
    expect(sideRoom(1440)).toBe(400);
    setSelection({ kind: 'settlement', id: 5 });
    expect(getSide().peek).toBe(true);
    clearSelection();
    expect(getSide()).toEqual({ collapsed: true, peek: false });
    expect(sideRoom(1440)).toBe(14);
  });
  it('弹出来时点收起:收回去,选中的留着;再点同一个又弹出来;展开着选中不算弹出', () => {
    collapseSide();
    setSelection({ kind: 'polity', id: 3 });
    collapseSide();
    expect(getSide().peek).toBe(false);
    expect(getSelection().sel).toEqual({ kind: 'polity', id: 3 });
    expect(sideRoom(1440)).toBe(14);
    setSelection({ kind: 'polity', id: 3 });
    expect(getSide().peek).toBe(true);
    expandSide();
    setSelection({ kind: 'polity', id: 4 });
    expect(getSide()).toEqual({ collapsed: false, peek: false });
  });
  it('新建世界这一步:左边是新建世界的卡片,收起着也照常让出它', () => {
    collapseSide();
    setSideHold(true);
    expect(sideRoom(1440)).toBe(400);
    setSideHold(false);
    expect(sideRoom(1440)).toBe(14);
  });
});

describe('地图飞过去的进度', () => {
  it('帧时刻比起步还早(主线程刚忙过)按 0 算,超过时长按 1 算', () => {
    expect(animProgress(1000 - 1800, 1000, FLY_MS)).toBe(0);
    expect(animProgress(1000 + FLY_MS / 2, 1000, FLY_MS)).toBe(0.5);
    expect(animProgress(1000 + 5 * FLY_MS, 1000, FLY_MS)).toBe(1);
  });
  it('从放大 3 倍飞回整张图:晚到的那一帧缩放还在 3 倍以内,不会冲到天文数字', () => {
    const b = { sw: 1600, sh: 900, bw: 1800, bh: 900 };
    const at = flatFly({ k: 3, x: -400, y: -1000 }, b, 2048, 1024, { focus: null, kind: 'home' });
    expect(at).not.toBeNull();
    const first = at!(easeOutCubic(animProgress(1000 - 1800, 1000, FLY_MS)));
    expect(first.k).toBeCloseTo(3, 6);
    expect(at!(easeOutCubic(animProgress(1000 + FLY_MS, 1000, FLY_MS))).k).toBeCloseTo(1, 6);
  });
});
