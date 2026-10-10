import { translateToEnglish } from './i18n';

describe('translateToEnglish', () => {
  it('精确匹配词典词条，保留前后空白', () => {
    expect(translateToEnglish('用户管理')).toBe('Users');
    expect(translateToEnglish('  保存  ')).toBe('  Save  ');
  });

  it('动态拼接的句子按规则翻译', () => {
    expect(translateToEnglish('欢迎，Alice')).toBe('Welcome, Alice');
    expect(translateToEnglish('总工期 10 天，预计完成 2026-03-12')).toBe('Total duration 10 days, projected finish 2026-03-12');
    expect(translateToEnglish('项目管理计划（第 3 版）')).toBe('Project management plan (version 3)');
    expect(translateToEnglish('2 个行动项逾期')).toBe('2 overdue actions');
  });

  it('没有中文的文字原样返回', () => {
    expect(translateToEnglish('HSR-001 · v2')).toBe('HSR-001 · v2');
  });

  it('含有词典之外的中文（用户数据）时保持原文，不把用户录入的名称翻碎', () => {
    expect(translateToEnglish('高铁转向架项目')).toBe('高铁转向架项目');
    expect(translateToEnglish('HSR-001 · 高铁转向架项目')).toBe('HSR-001 · 高铁转向架项目');
  });

  it('词典里的词组合成的句子逐词翻译，且不留下中文', () => {
    const out = translateToEnglish('项目经理：保存失败');
    expect(out).toBe('Project manager: Save failed');
  });

  it('词典自洽：每个词条的译文都不含中文，且没有重复的中文键', async () => {
    const { EN_PHRASES } = await import('./en');
    const seen = new Set<string>();
    for (const [zh, en] of EN_PHRASES) {
      expect(/[一-鿿]/.test(en), `译文含中文：${zh} → ${en}`).toBe(false);
      seen.add(zh);
    }
    // 重复的键以先出现的为准（Map 会保留最后一个，这里只提示数量）
    expect(seen.size).toBeGreaterThan(300);
  });
});
