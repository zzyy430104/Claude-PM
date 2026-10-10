import { Injectable, signal } from '@angular/core';
import { EN_PHRASES, EN_RULES } from './en';

export type Lang = 'zh' | 'en';
const KEY = 'pm.lang';
const CJK = /[一-鿿]/;
const ATTRS = ['placeholder', 'aria-label', 'title'];

function saved(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'zh' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

/** 当前语言，供不经过 DI 的辅助函数（如 askText）使用 */
let current: Lang = 'zh';

const sorted = [...EN_PHRASES].sort((a, b) => b[0].length - a[0].length);
const exact = new Map(EN_PHRASES);

function replacePhrases(text: string): string {
  let out = text;
  for (const [zh, en] of sorted) if (out.includes(zh)) out = out.split(zh).join(en);
  return out;
}

/** 把一段界面文字翻成英文；含有词典之外的中文（例如用户录入的项目名称）时保持原样，避免把用户数据翻得七零八落 */
export function translateToEnglish(text: string): string {
  if (!CJK.test(text)) return text;
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const core = text.trim();
  let out: string | undefined = exact.get(core);
  if (out === undefined) {
    for (const [re, to] of EN_RULES) {
      if (re.test(core)) { out = core.replace(re, to); break; }
    }
  }
  // 规则捕获出来的片段（如阶段名、状态）里可能还有词典里的中文，再逐词替换一遍
  out = replacePhrases(out ?? core);
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim();
  return CJK.test(out) ? text : lead + out + trail;
}

/** 输入框（系统内对话框，见 core/dialog.ts）；英文界面下提示语由页面翻译自动处理 */
export { askText } from './dialog';

@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Lang>('zh');
  private observer: MutationObserver | null = null;

  constructor() {
    const initial = saved() ?? (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en');
    this.lang.set(initial);
    current = initial;
  }

  /** 已有中文界面文字的翻译 */
  t(text: string): string {
    return this.lang() === 'en' ? translateToEnglish(text) : text;
  }

  /** 应用启动时调用：英文界面下，翻译现有内容并监听之后的界面变化 */
  start() {
    document.documentElement.lang = this.lang() === 'en' ? 'en' : 'zh-CN';
    if (this.lang() !== 'en' || typeof MutationObserver === 'undefined') return;
    this.translateTree(document.body);
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach((n) => this.translateTree(n));
        else if (r.type === 'characterData') this.translateText(r.target as Text);
        else if (r.type === 'attributes') this.translateAttr(r.target as Element, r.attributeName!);
      }
    });
    this.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  /** 切换语言：保存后刷新页面，最简单也最可靠 */
  toggle() {
    const next: Lang = this.lang() === 'en' ? 'zh' : 'en';
    try { localStorage.setItem(KEY, next); } catch { /* 隐私模式下忽略 */ }
    location.reload();
  }

  private translateTree(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) return this.translateText(root as Text);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const el = root as Element;
    if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(el.tagName)) return;
    for (const a of ATTRS) if (el.hasAttribute(a)) this.translateAttr(el, a);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n: Node | null = walker.nextNode();
    while (n) {
      if (n.nodeType === Node.TEXT_NODE) this.translateText(n as Text);
      else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) this.translateAttr(n as Element, a);
      n = walker.nextNode();
    }
  }

  private translateText(node: Text) {
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) return;
    const v = node.data;
    if (!CJK.test(v)) return;
    const out = translateToEnglish(v);
    if (out !== v) node.data = out;
  }

  private translateAttr(el: Element, name: string) {
    const v = el.getAttribute(name);
    if (!v || !CJK.test(v)) return;
    const out = translateToEnglish(v);
    if (out !== v) el.setAttribute(name, out);
  }
}
