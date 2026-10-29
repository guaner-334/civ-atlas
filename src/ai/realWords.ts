/**
 * 现实词检查:AI 写完的史书、名字由来里,扫一遍地球上真实的语言、地名、宗教、人物、典籍、朝代和纪年;
 * 命中的句子交给 AI 重写一次(只改这几句,其余原样)。
 *
 * 提示词里已经要求不写现实的东西,但模型还是会自己编出来(给人物起真实的名字、引真实的古诗文和外语句子);
 * 这里是写完以后的补救。词表只收"在这个架空世界里出现就一定不对"的词,宁漏勿错;
 * 材料里本来就有的词(作者起的名字、这个世界自己的叫法)不算。
 */
import { aiChat } from './client';
import { AiError, type AiMessage } from './types';

/** 一组词和它们为什么不该出现(告诉 AI 的说法) */
interface WordGroup {
  why: string;
  words: readonly string[];
  /** 中文古诗文和它们的作者、朝代:中式名字的"名字由来"允许引一处(allowClassics) */
  classics?: boolean;
}

const GROUPS: readonly WordGroup[] = [
  {
    why: '现实中的语言、民族',
    words: [
      '拉丁', '英语', '古英语', '古法语', '希腊语', '古希腊', '阿拉伯', '梵语', '梵文', '希伯来', '凯尔特', '盎格鲁',
      '撒克逊', '日耳曼', '斯拉夫', '维京', '诺尔斯', '哥特人', '突厥', '匈奴', '鲜卑', '契丹', '蒙古', '吐蕃',
    ],
  },
  {
    why: '现实中的国家、地名',
    words: [
      '欧洲', '亚洲', '非洲', '美洲', '北欧', '中国', '印度', '埃及', '波斯', '巴比伦', '希腊', '罗马', '拜占庭',
      '英格兰', '法兰西', '苏格兰', '爱尔兰', '西班牙', '意大利', '葡萄牙', '荷兰', '耶路撒冷', '地中海', '大西洋',
      '太平洋', '洛阳', '楼兰', '敦煌',
    ],
  },
  {
    why: '现实中的宗教、神祇',
    words: [
      '基督', '耶稣', '上帝', '伊斯兰', '穆斯林', '安拉', '真主', '十字军', '佛陀', '佛祖', '释迦', '菩萨', '观音',
      '儒家', '儒教', '宙斯', '奥丁', '雅典娜', '阿波罗', '朱庇特',
      // 讲教义时容易冒出来的(会和平常的话、这个世界自己的教名撞上的不收:"X道教义"里有道教,"如来犯之敌"里有如来)
      '弥勒', '阿弥陀', '天主教', '耶和华', '犹太', '婆罗门', '梵天', '湿婆', '毗湿奴', '琐罗亚斯德', '拜火教', '摩尼教',
      '玉皇大帝', '太上老君',
    ],
  },
  {
    why: '现实中的人物',
    words: [
      '穆罕默德', '亚历山大', '凯撒', '恺撒', '拿破仑', '查理曼', '成吉思汗', '秦始皇', '汉武帝', '唐太宗', '武则天',
      '莎士比亚', '荷马', '亚里士多德', '柏拉图', '苏格拉底',
    ],
  },
  {
    why: '现实中的典籍',
    words: ['圣经', '古兰经', '伊利亚特', '奥德赛', '贝奥武夫'],
  },
  {
    why: '现实中的典籍和作者',
    classics: true,
    // 会和平常的话撞上的不收(尚书是官名,"据史记载"里有史记,"仿佛教导"里有佛教)
    words: [
      '诗经', '楚辞', '离骚', '论语', '《史记》', '《汉书》', '左传', '周易', '易经', '道德经', '山海经', '水经注',
      '说文解字', '尔雅', '孙子兵法', '资治通鉴', '庄子', '孟子', '荀子', '韩非子', '淮南子', '唐诗', '宋词',
      '孔子', '老聃', '司马迁', '曹操', '诸葛亮', '陶渊明', '李白', '杜甫', '王维', '白居易', '苏轼',
    ],
  },
  {
    why: '现实的纪年',
    words: ['公元', '世纪'],
  },
];

/** 现实中古代字母(古英语、古诺尔斯语才有),拟造的拼写不会用到 */
const OLD_LETTERS = /[æÆþÞðÐƿ]/;
/** 一个拉丁字母写的词(至少 3 个字母、带小写,"AI"这类缩写不算) */
const LATIN_WORD = /[A-Za-zÀ-ɏ'’]*[a-zà-ɏ][A-Za-zÀ-ɏ'’]*/g;
/** 连着三个以上拉丁字母写的词 = 一句外语(拟造拼写是 hāl- + -mer + -ia 这样用符号连的) */
const LATIN_PHRASE = /[A-Za-zÀ-ɏ'’]+(?:[ \t]+[A-Za-zÀ-ɏ'’]+){2,}/g;

export interface ScanOptions {
  /** 发给 AI 的材料原文:材料里出现过的词不算(作者起的名字、这个世界自己的叫法) */
  material: string;
  /** 允许引一处中文古诗文(中式名字的名字由来) */
  allowClassics?: boolean;
  /** 允许拟造的拉丁字母拼写(音译名字的名字由来);不允许时,正文里的拉丁字母词都算 */
  allowSpelling?: boolean;
}

export interface RealWordHit {
  word: string;
  why: string;
}

/** 扫一遍正文,按第一次出现的先后返回命中的词(每个词一次) */
export function scanRealWords(text: string, opts: ScanOptions): RealWordHit[] {
  const found: { at: number; end: number; hit: RealWordHit }[] = [];
  const seen = new Set<string>();
  // 每处只算一次:长词先扫,已经算进长词里的短词不再单算("古英语"里的"英语")
  const covered = (a: number, b: number) => found.some((f) => f.at <= a && b <= f.end);
  const add = (word: string, why: string, at: number) => {
    if (covered(at, at + word.length) || opts.material.includes(word)) return;
    found.push({ at, end: at + word.length, hit: { word, why } });
  };
  const words = GROUPS.filter((g) => !(g.classics && opts.allowClassics))
    .flatMap((g) => g.words.map((w) => ({ w, why: g.why })))
    .sort((a, b) => b.w.length - a.w.length);
  for (const { w, why } of words) for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + w.length)) add(w, why, at);
  if (opts.allowSpelling) {
    for (const m of text.matchAll(LATIN_PHRASE)) add(m[0], '现实中的外语句子', m.index);
    for (const m of text.matchAll(LATIN_WORD)) if (OLD_LETTERS.test(m[0])) add(m[0], '现实中的外语词', m.index);
  } else {
    for (const m of text.matchAll(LATIN_WORD)) if (m[0].length >= 3) add(m[0], '拉丁字母写的外语词', m.index);
  }
  found.sort((a, b) => a.at - b.at);
  const out: RealWordHit[] = [];
  for (const f of found) {
    if (seen.has(f.hit.word)) continue;
    seen.add(f.hit.word);
    out.push(f.hit);
  }
  return out;
}

/** 正文切成句子:每段 = [起点, 终点);标点、换行之外的东西都在句子里 */
function sentences(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(/[^。！？!?\n]+[。！？!?]*[”’」』）)]*/g)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** 句首的 Markdown 记号和空白(标题、列表、引用)原样留着,不交给 AI */
const LEAD = /^\s*(?:#+\s*|[-*]\s+|>\s*)?/;

/** 一次最多改几句(太多就只改前面这些;剩下的留着,不再来第二轮) */
const MAX_LINES = 40;

export interface FixOptions extends ScanOptions {
  /** 记进调用记录的功能名和说明(和写正文的那次一样) */
  feature: string;
  title?: string;
  signal?: AbortSignal;
}

/** 重写的请求:列出命中的词和原句,要 AI 逐句改好,回 {"lines": [...]} */
export function fixMessages(lines: readonly string[], hits: readonly RealWordHit[]): AiMessage[] {
  const system =
    '你是一部架空世界设定集的校对编辑。这个世界是虚构的,正文里不该出现地球上真实的语言、民族、国家、地名、宗教、神祇、人物、典籍、朝代和纪年。';
  const user = [
    `下面 ${lines.length} 句话里出现了现实世界的词:`,
    ...hits.map((h) => `- 「${h.word}」(${h.why})`),
    '',
    '逐句改写:把这些词换成这个世界自己的说法(可以照句子里已有的名字和风格来编),或者干脆删掉;同一个词在各句里换成同一个说法。',
    '其余的字、人名、地名、年份都不要动,语气不变,不要加解释。',
    `只回一个 JSON 对象:{"lines": ["改好的第 1 句", "改好的第 2 句", …]},条数和顺序与原句一致。`,
    '',
    '原句:',
    ...lines.map((l, i) => `${i + 1}. ${l}`),
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 从回复里取出改好的句子;条数不对、不是字符串的返回 null */
export function parseFixed(text: string, n: number): (string | null)[] | null {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let v: unknown;
  try {
    v = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  const lines = (v as { lines?: unknown })?.lines;
  if (!Array.isArray(lines) || lines.length !== n) return null;
  return lines.map((l) => (typeof l === 'string' && l.trim() ? l.trim().replace(/\n+/g, '') : null));
}

/**
 * 扫正文;有现实词就把含这些词的句子交给 AI 重写一次,换回原处。
 * 没命中原样返回;重写失败、回复对不上也原样返回(不因为这一步丢掉写好的正文);取消照样抛 AiError('aborted')
 */
export async function fixRealWords(text: string, opts: FixOptions): Promise<string> {
  const hits = scanRealWords(text, opts);
  if (!hits.length) return text;
  const picked = sentences(text)
    .filter((s) => hits.some((h) => text.slice(s.start, s.end).includes(h.word)))
    .slice(0, MAX_LINES)
    .map((s) => {
      const seg = text.slice(s.start, s.end);
      const lead = seg.match(LEAD)![0];
      return { start: s.start + lead.length, end: s.start + seg.trimEnd().length };
    })
    .filter((s) => s.end > s.start);
  if (!picked.length) return text;
  const lines = picked.map((s) => text.slice(s.start, s.end));
  const used = hits.filter((h) => lines.some((l) => l.includes(h.word)));
  const chars = lines.reduce((n, l) => n + l.length, 0);
  let reply: string;
  try {
    const r = await aiChat(
      {
        feature: opts.feature,
        title: `${opts.title ? `${opts.title} · ` : ''}改掉现实里的词`,
        messages: fixMessages(lines, used),
        temperature: 0.3,
        maxTokens: Math.min(4000, chars * 2 + 300),
        json: true,
      },
      { signal: opts.signal },
    );
    reply = r.text;
  } catch (e) {
    if (e instanceof AiError && e.code === 'aborted') throw e;
    return text;
  }
  const fixed = parseFixed(reply, lines.length);
  if (!fixed) return text;
  let out = '';
  let at = 0;
  picked.forEach((s, i) => {
    out += text.slice(at, s.start) + (fixed[i] ?? lines[i]);
    at = s.end;
  });
  return out + text.slice(at);
}
