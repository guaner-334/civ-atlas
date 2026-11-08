// 环形山:撒几十个陨石坑,坑底下陷、坑沿隆起,坑沿高低不平。
// 只改海拔,后面的照常算:陆地上的坑积水成湖,挖到海平面以下的成了海,山多了挡雨、河跟着改道。
// 新建世界时拨两个滑条:坑有几个(count)、多大(size,坑的半径乘几)

// 舍入到 24 位。QuickJS 里的 Math.exp 在哪台设备上都一样,不舍入也行;
// 舍入了,同一份代码不经 QuickJS 直接跑也和 QuickJS 里逐位一样(这个示例的测试要用)
function r24(x) {
  if (!(Math.abs(x) < 1e290)) return x;
  const c = x * 536870913;
  return c - (c - x);
}

civAtlas.map({
  height(d) {
    const e = d.elevation.slice();
    const { count, size } = d.params;
    // 坑沿的高低起伏:约 250 公里一个起落,叠 3 层
    const jag = d.noise({ km: 250, octaves: 3, salt: 'rim' });
    for (let k = 0; k < count; k++) {
      // 第 k 个坑:坑心、半径(150–600 公里)、坑底挖下去多深(300–1800 米)都从 d.rand 取
      const c = Math.floor(d.rand(k, 1) * d.n);
      const R = (150 + 450 * d.rand(k, 2)) * size;
      const depth = 300 + 1500 * d.rand(k, 3);
      // 只看坑附近的地块,不扫全图
      const cells = d.near(c, 2 * R);
      for (let q = 0; q < cells.length; q++) {
        const i = cells[q];
        const t = d.km(c, i) / R;
        const bowl = t < 1 ? (t * t - 1) * depth : 0;
        const rim = 0.3 * depth * r24(Math.exp(-((t - 1) * (t - 1)) / 0.06)) * (1 + 0.3 * jag[i]);
        e[i] += bowl + rim;
      }
    }
    return { elevation: e };
  },
});
