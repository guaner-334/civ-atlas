/** 「这台：iPhone，微信里打开（WebKit 605）」那一行,从浏览器标识里认 */

const APPS: [RegExp, string][] = [
  [/wxwork\//i, '企业微信'],
  [/MicroMessenger\//i, '微信'],
  // QQ 自己的标识是「 QQ/版本」;只有 MQQBrowser 的是 QQ 浏览器(QQ 在安卓上的标识两个都带)
  [/\sQQ\/\d/, 'QQ'],
  [/MQQBrowser\//, 'QQ 浏览器'],
  [/DingTalk\//i, '钉钉'],
  [/Lark\/|Feishu/i, '飞书'],
  [/Weibo/i, '微博'],
  [/AlipayClient\//, '支付宝'],
  [/Quark\//, '夸克'],
  [/UCBrowser\//, 'UC 浏览器'],
  [/baiduboxapp\//i, '百度'],
  [/HuaweiBrowser\//, '华为浏览器'],
  [/MiuiBrowser\//, '小米浏览器'],
  [/SamsungBrowser\//, '三星浏览器'],
  [/EdgA?\/|EdgiOS\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

function platform(ua: string, touchMac: boolean): string {
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (touchMac && /Macintosh/.test(ua))) return 'iPad';
  if (/HarmonyOS|OpenHarmony/.test(ua)) return '鸿蒙';
  if (/Android/.test(ua)) return '安卓';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return '没认出的设备';
}

function engine(ua: string, apple: boolean): string {
  const webkit = /AppleWebKit\/(\d+)/.exec(ua);
  // iOS、iPadOS 上的浏览器都是 WebKit,标识里写 Chrome、Firefox 的也一样
  if (apple && webkit) return `WebKit ${webkit[1]}`;
  const firefox = /Firefox\/(\d+)/.exec(ua);
  if (firefox) return `Firefox ${firefox[1]}`;
  const chrome = /Chrome\/(\d+)/.exec(ua);
  if (chrome) return `Chrome 内核 ${chrome[1]}`;
  if (webkit) return `WebKit ${webkit[1]}`;
  return '内核没认出来';
}

/** touchMac:标识写 Mac 但有触屏,是 iPad 用电脑版标识 */
export function describeDevice(ua: string, touchMac = false): string {
  const p = platform(ua, touchMac);
  const app = APPS.find(([re]) => re.test(ua))?.[1] ?? '浏览器';
  const apple = p === 'iPhone' || p === 'iPad';
  return `${p}，${app}${/[A-Za-z]$/.test(app) ? ' ' : ''}里打开（${engine(ua, apple)}）`;
}
