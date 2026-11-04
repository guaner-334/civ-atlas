/**
 * 名字占位符:编年史存进世界时,文字里的名字写成占位符,显示时换成当前的名字,这样改名不用重写存下的文字(story/nameTokens.ts)。
 *
 * 占位符是一串私用区的字,正文里不会自然出现:
 * - 一个名字:`开头 + 指谁 + (写法记号 + 写法)… + 结尾`。指谁:p12 = 12 号国家的国名词根,s3 = 3 号城……(见 story/nameTokens.ts)。
 *   写法:名字的长短、开头的字决定写成什么样的地方("昌" → "大昌王朝","景辰" → "景辰皇朝")要等换回名字才知道,
 *   所以把"要什么写法"记在占位符里(growth.ts、peopleText.ts、surname.ts)。
 * - 一处选择(nameIf):句子跟着名字变的地方(州名带"之"的不再叠一个"之"、同名的朝写"新朝")两种写法都存着,换回名字时按当前的名字选。
 *
 * 只放写法,不引别的文件:国号、称呼的代码都要用它。真名字走到这里只多一次字符比较,结果和没有占位符时一样。
 */

const OPEN = 0xe000;
const CLOSE = 0xe001;
const OPEN_CHAR = '';
const CLOSE_CHAR = '';
const FORM_CHAR = '';
const IF_CHAR = '';
const ARM_CHAR = '';
const END_CHAR = '';
const ARG_CHAR = '';

/** 找文字里所有名字占位符的正则:指谁 = $1,写法 = $2(每个写法前面带写法记号) */
export const NAME_TOKEN_RE = /([a-z]\d+(?:\.\d+)?)((?:[a-z0-9]+)*)/g;

/** 写法记号:拆开 NAME_TOKEN_RE 的 $2 用 */
export const NAME_FORM_MARK = FORM_CHAR;

/**
 * 找文字里最里层的选择的正则:条件 = $1(哪种 + 两个参数,用 NAME_IF_ARG 隔开),成立时的写法 = $2,不成立时的写法 = $3。
 * 选择可能嵌套(来历写进了另一处选择的写法里):里层换完再换外层
 */
export const NAME_IF_RE = /([^]*)([^]*)([^]*)/g;

/** 选择条件里隔开参数的字 */
export const NAME_IF_ARG = ARG_CHAR;

/** 占位符用到的所有字:换完还剩的(文件里的坏文字)清掉,不留方块 */
export const NAME_TOKEN_CHARS = /[-]/g;

/** 指向 ref 的占位符 */
export function nameToken(ref: string): string {
  return `${OPEN_CHAR}${ref}${CLOSE_CHAR}`;
}

/** 整个字符串是不是一个名字占位符 */
export function isNameToken(s: string): boolean {
  return s.charCodeAt(0) === OPEN && s.charCodeAt(s.length - 1) === CLOSE && s.indexOf(OPEN_CHAR, 1) < 0;
}

/** 文字里有没有选择 */
export function hasNameIf(s: string): boolean {
  return s.indexOf(IF_CHAR) >= 0;
}

/** 文字里有没有占位符用到的字 */
export function hasNameToken(s: string): boolean {
  return /[\uE000-\uE007]/.test(s);
}

/**
 * 东方国名词根生成时是什么样(记在占位符的写法里,换回名字时不起作用):和字数有关的写法要等换回名字才知道,
 * 但"正文里写到这个国家没有"得照生成时的名字算(来历,chronicle.ts 的 namesOf)。
 * long = 不是单字("景辰"):简称、去掉"大"的写法都是词根本身;big = "大" + 单字("大安"):简称是词根本身;单字不记
 */
export type RootShape = 'long' | 'big';

const SHAPE_FORM: Record<RootShape, string> = { long: 'l', big: 'x' };

/** 东方国名词根的占位符记上生成时是什么样 */
export function markRootShape(token: string, shape: RootShape | null): string {
  return shape ? nameForm(token, SHAPE_FORM[shape]) : token;
}

/** 东方国名词根的占位符生成时是什么样;没记、不是占位符 = null */
export function rootShapeOf(s: string): RootShape | null {
  if (!isNameToken(s)) return null;
  if (s.includes(FORM_CHAR + SHAPE_FORM.long)) return 'long';
  return s.includes(FORM_CHAR + SHAPE_FORM.big) ? 'big' : null;
}

/** 占位符加一个写法:换回名字时把名字套进这个写法 */
export function nameForm(token: string, form: string): string {
  return `${token.slice(0, -1)}${FORM_CHAR}${form}${CLOSE_CHAR}`;
}

/**
 * 选择的条件:名字里有没有 arg(has)、名字是不是以 arg 结尾(end)、两个名字一样不一样(same)、名字是不是空的(empty)、
 * 是不是两到四个字的中式名字(han)。真名字现在就有答案;换回名字时(story/nameTokens.ts)拿当前的名字再算一次
 */
export type NameTest = 'has' | 'end' | 'same' | 'empty' | 'han';

/** 一处选择的条件成不成立 */
export function testName(test: NameTest, name: string, arg: string): boolean {
  if (test === 'has') return name.includes(arg);
  if (test === 'end') return name.endsWith(arg);
  if (test === 'same') return name === arg;
  if (test === 'empty') return !name;
  return /^[一-鿿]{2,4}$/.test(name);
}

/** 按名字选写法:条件成立写 yes,不成立写 no。名字是占位符时两种都存着,换回名字时再选 */
export function nameIf(test: NameTest, name: string, arg: string, yes: string, no: string): string {
  if (name.charCodeAt(0) !== OPEN && arg.charCodeAt(0) !== OPEN) return testName(test, name, arg) ? yes : no;
  return `${IF_CHAR}${test}${ARG_CHAR}${name}${ARG_CHAR}${arg}${ARM_CHAR}${yes}${ARM_CHAR}${no}${END_CHAR}`;
}
