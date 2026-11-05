/** 首页也要用,所以单独一个小文件。 */

const gbText = (gb: number) => (gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1).replace(/\.0$/, '')} GB`);

export function sizeText(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  const mb = bytes / 1e6;
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  if (mb < 999.5) return `${Math.round(mb)} MB`;
  return gbText(mb / 1000);
}

export function aboutSize(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb < 1) return '不到 1 MB';
  if (mb < 100) return `约 ${Math.round(mb)} MB`;
  if (mb < 995) return `约 ${Math.round(mb / 10) * 10} MB`;
  return `约 ${gbText(mb / 1000)}`;
}
