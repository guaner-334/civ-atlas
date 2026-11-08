// 魔力:每州一个魔力浓度,魔力浓的州,城的人口上限高
// 魔力怎么涨落写在 plugin.json 的表里(公式由网站算,插件代码不用管);图层也在那里标好,网站每 50 年存一份。
// 这里只做一件事:每 5 年把魔力浓度换成城的人口上限倍数,交给影响口 city.capacity

civAtlas.sim({
  act(turn) {
    const magic = turn.table('magic');
    const cap = turn.influence('city.capacity');
    // 新建世界时拨的滑条:0 = 魔力不影响城,1 = 魔力满 100 时上限翻一倍
    const k = civAtlas.params.strength;
    for (let r = 0; r < cap.length; r++) cap[r] = 1 + (k * magic[r]) / 100;
    return { influences: { 'city.capacity': cap } };
  },
});
