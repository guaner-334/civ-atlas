// 潮汐:算近岸每块海的潮差(米),画成一张渐变图层。只出图层,不改地图。
// 大陆架越宽、海湾越封闭,潮差越大(芬迪湾那种喇叭口最大)。

// 舍入到 24 位。QuickJS 里的 Math.pow 在哪台设备上都一样,不舍入也行;
// 舍入了,同一份代码不经 QuickJS 直接跑也和 QuickJS 里逐位一样(这个示例的测试要用)
function r24(x) {
  if (!(Math.abs(x) < 1e290)) return x;
  const c = x * 536870913;
  return c - (c - x);
}

civAtlas.map({
  layers(d) {
    const { n, water, elevation: e, adjStart: s, adj } = d;
    // 近岸的海(挨着陆地的海)、浅海(200 米以内)
    const coastal = new Uint8Array(n);
    const shallow = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (water[i] !== 1) continue;
      if (e[i] > -200) shallow[i] = 1;
      for (let k = s[i]; k < s[i + 1]; k++) {
        if (water[adj[k]] === 0) {
          coastal[i] = 1;
          break;
        }
      }
    }
    // 大陆架多宽:从近岸的海往外只走浅海,走得到的每块是第几步(帮手在网站那头算)
    const shelf = d.steps(coastal, shallow);
    const tide = new Float32Array(n).fill(NaN);
    const seen = new Int32Array(n).fill(-1);
    const ring = new Int32Array(n);
    const depth = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      if (!coastal[i]) continue;
      // 海湾多封闭:从这块往外走 4 步(沿邻居走,不扫全图),看走到的地块里陆地占几成;
      // 顺便记下附近的海里大陆架最宽有几步(最多算 12 步)
      let head = 0;
      let tail = 0;
      let land = 0;
      let all = 0;
      let far = 0;
      ring[tail++] = i;
      seen[i] = i;
      depth[i] = 0;
      while (head < tail) {
        const c = ring[head++];
        all++;
        if (water[c] === 0) {
          land++;
          continue;
        }
        far = Math.max(far, Math.min(12, shelf[c]));
        if (depth[c] >= 4) continue;
        for (let k = s[c]; k < s[c + 1]; k++) {
          const j = adj[k];
          if (seen[j] === i) continue;
          seen[j] = i;
          depth[j] = depth[c] + 1;
          ring[tail++] = j;
        }
      }
      const closed = land / all;
      tide[i] = 0.5 + 1.5 * (far / 12) + 9 * r24(Math.pow(Math.max(0, closed - 0.35), 1.5)) * (0.4 + far / 12);
    }
    return { layers: { tide } };
  },
});
