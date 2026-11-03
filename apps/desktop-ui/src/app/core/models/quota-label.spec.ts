import { localizeQuotaLabel } from './quota-label';

const ZH: Record<string, string> = {
  'quota.window.fiveHour': '5 小时额度',
  'quota.window.weekly': '每周额度',
  'quota.window.hours': '{count} 小时窗口',
  'quota.group.claudeGpt': 'Claude 与 GPT 模型',
};

const t = (key: string, params: Readonly<Record<string, string | number>> = {}) =>
  (ZH[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));

describe('localizeQuotaLabel', () => {
  it('translates both the model group and the Antigravity window', () => {
    expect(localizeQuotaLabel('Claude and GPT models · Five Hour Limit Remaining', t)).toBe(
      'Claude 与 GPT 模型 · 5 小时额度',
    );
    expect(localizeQuotaLabel('Five Hour Limit Remaining', t)).toBe('5 小时额度');
  });

  it('keeps product names it does not know', () => {
    expect(localizeQuotaLabel('Gemini 4 Argon · Weekly Limit', t)).toBe('Gemini 4 Argon · 每周额度');
  });

  it('still translates the names Termexo writes in Chinese', () => {
    expect(localizeQuotaLabel('5 小时窗口', t)).toBe('5 小时窗口');
  });
});
