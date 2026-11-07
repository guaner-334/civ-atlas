/** 投稿须知。版本号要和服务器的一样(投稿时带上,服务器不认就回 terms-changed);改了字就加一,CHANGED 里记下改了哪几条。 */
export const TERMS_VERSION = 3;

export const TERMS: readonly string[] = [
  '作品是你自己做的；改的是别人的作品，网站会自动写上原来的出处。',
  '你同意它在作品墙上公开展示：谁都能打开看、另存一份接着改、用你的地图、参数或规则新建世界；另存的那份写着你的署名和出处，改不掉。',
  '我们会看过里面所有的字（国名、人名、改的名字、人物和标注、AI 写的正文、介绍）再决定上不上；可能选进本月精选，配一句推荐语。封面由网站自动截地图。',
  '在「我的投稿」里随时撤下（在 QQ 群里投的，找管理员撤）。撤下后作品墙上不再出现；别人已经另存的在他们自己的浏览器里，我们删不掉。',
  '被举报、核实不适合公开的，我们会撤下。',
];

/** 每一版比上一版改了哪几条(从 0 数) */
const CHANGED: Readonly<Record<number, readonly number[]>> = { 3: [3] };

/** 看过第 since 版的人,到现在这一版之间改了哪几条(从 0 数,从小到大) */
export function changedSince(since: number): number[] {
  const out = new Set<number>();
  for (let v = since + 1; v <= TERMS_VERSION; v++) for (const i of CHANGED[v] ?? []) out.add(i);
  return [...out].sort((a, b) => a - b);
}
