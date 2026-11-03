type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** Separates a model group from its window in the names the backend builds. */
const SEPARATOR = ' · ';

/**
 * Allowance line names the backend writes, and the wording that replaces each.
 *
 * Most come from Termexo itself, in Chinese; the English ones are what Antigravity reports for its
 * windows and model groups. English keys are matched case-insensitively.
 */
const LABEL_KEYS: Readonly<Record<string, string>> = {
  每周额度: 'quota.window.weekly',
  周额度: 'quota.window.weekly',
  每月额度: 'quota.window.monthly',
  'Opus 额度': 'quota.window.opus',
  订阅额度: 'quota.window.subscription',
  可用余额: 'quota.window.balance',
  额外点数余额: 'quota.window.extraCredits',
  'five hour limit remaining': 'quota.window.fiveHour',
  'five hour limit': 'quota.window.fiveHour',
  'weekly limit remaining': 'quota.window.weekly',
  'weekly limit': 'quota.window.weekly',
  'monthly limit remaining': 'quota.window.monthly',
  'monthly limit': 'quota.window.monthly',
  'claude and gpt models': 'quota.group.claudeGpt',
  'gemini models': 'quota.group.gemini',
};

function localizePart(part: string, t: Translate): string {
  const hours = /^(\d+) 小时窗口$/.exec(part);
  if (hours) return t('quota.window.hours', { count: hours[1] });
  const days = /^(\d+) 天窗口$/.exec(part);
  if (days) return t('quota.window.days', { count: days[1] });
  const key = LABEL_KEYS[part] ?? LABEL_KEYS[part.toLowerCase()];
  return key ? t(key) : part;
}

/**
 * Shows an allowance line name in the interface language. Each part of a `group · window` name is
 * translated on its own; anything unknown is a provider's own wording and passes through.
 */
export function localizeQuotaLabel(label: string, t: Translate): string {
  return label
    .split(SEPARATOR)
    .map((part) => localizePart(part.trim(), t))
    .join(SEPARATOR);
}
