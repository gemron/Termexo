import { registerTranslations, type TranslationBundle } from './i18n.service';

/**
 * Wording for the full-screen switch in the phone menu.
 *
 * Only the phone-width menu shows it, and that menu is deferred, so its strings ship in the same
 * lazy chunk instead of the initial bundle.
 */
export const FULLSCREEN_TRANSLATIONS: TranslationBundle = {
  en: {
    'fullscreen.enter': 'Full screen',
    'fullscreen.exit': 'Exit full screen',
    'fullscreen.failed': 'Could not switch full screen: {error}',
  },
  'zh-CN': {
    'fullscreen.enter': '全屏显示',
    'fullscreen.exit': '退出全屏',
    'fullscreen.failed': '无法切换全屏：{error}',
  },
  es: {
    'fullscreen.enter': 'Pantalla completa',
    'fullscreen.exit': 'Salir de pantalla completa',
    'fullscreen.failed': 'No se pudo cambiar a pantalla completa: {error}',
  },
  fr: {
    'fullscreen.enter': 'Plein écran',
    'fullscreen.exit': 'Quitter le plein écran',
    'fullscreen.failed': 'Impossible de basculer en plein écran : {error}',
  },
  de: {
    'fullscreen.enter': 'Vollbild',
    'fullscreen.exit': 'Vollbild beenden',
    'fullscreen.failed': 'Vollbild konnte nicht umgeschaltet werden: {error}',
  },
  ja: {
    'fullscreen.enter': '全画面表示',
    'fullscreen.exit': '全画面表示を終了',
    'fullscreen.failed': '全画面表示を切り替えられません: {error}',
  },
  ko: {
    'fullscreen.enter': '전체 화면',
    'fullscreen.exit': '전체 화면 종료',
    'fullscreen.failed': '전체 화면으로 전환할 수 없습니다: {error}',
  },
};

/** Makes the wording above available; the phone menu calls it at module scope. */
export function registerFullscreenTranslations(): void {
  registerTranslations(FULLSCREEN_TRANSLATIONS);
}
