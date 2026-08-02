import { TestBed } from '@angular/core/testing';

import { I18nService, resolveSystemLanguage } from './i18n.service';

describe('I18nService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('matches supported system language families and falls back to English', () => {
    expect(resolveSystemLanguage(['zh-Hant-TW'])).toBe('zh-CN');
    expect(resolveSystemLanguage(['es-MX'])).toBe('es');
    expect(resolveSystemLanguage(['pt-BR', 'ja-JP'])).toBe('ja');
    expect(resolveSystemLanguage(['pt-BR'])).toBe('en');
  });

  it('switches immediately and persists a manual preference', () => {
    const service = TestBed.inject(I18nService);
    service.setPreference('ja');

    expect(service.activeLanguage()).toBe('ja');
    expect(service.t('workspace.settings')).toBe('設定');
    expect(window.localStorage.getItem('termexo.language')).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
  });

  it('interpolates translated parameters', () => {
    const service = TestBed.inject(I18nService);
    service.setPreference('en');
    expect(service.t('common.messages', { count: 3 })).toBe('3 messages');
  });
});
