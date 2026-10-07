import { registerTranslations, type TranslationBundle } from './i18n.service';

const PROJECT_LINK_TRANSLATIONS: TranslationBundle = {
  en: {
    'projectLinks.support': 'Enjoying Termexo? Support us with a Star.',
    'projectLinks.group': 'Termexo project links',
    'projectLinks.home': 'Visit homepage',
    'projectLinks.star': 'GitHub Star',
    'projectLinks.openFailed': 'Unable to open the link',
  },
  'zh-CN': {
    'projectLinks.support': '喜欢 Termexo？用 Star 支持我们。',
    'projectLinks.group': 'Termexo 项目入口',
    'projectLinks.home': '访问主页',
    'projectLinks.star': 'GitHub Star',
    'projectLinks.openFailed': '无法打开链接',
  },
  es: {
    'projectLinks.support': '¿Te gusta Termexo? Apóyanos con una estrella.',
    'projectLinks.group': 'Enlaces de Termexo',
    'projectLinks.home': 'Visitar web',
    'projectLinks.star': 'GitHub Star',
    'projectLinks.openFailed': 'No se pudo abrir el enlace',
  },
  fr: {
    'projectLinks.support': 'Vous aimez Termexo ? Soutenez-nous avec une étoile.',
    'projectLinks.group': 'Liens du projet Termexo',
    'projectLinks.home': 'Visiter le site',
    'projectLinks.star': 'GitHub Star',
    'projectLinks.openFailed': 'Impossible d’ouvrir le lien',
  },
  de: {
    'projectLinks.support': 'Gefällt dir Termexo? Unterstütze uns mit einem Stern.',
    'projectLinks.group': 'Termexo-Projektlinks',
    'projectLinks.home': 'Homepage besuchen',
    'projectLinks.star': 'GitHub Star',
    'projectLinks.openFailed': 'Link konnte nicht geöffnet werden',
  },
  ja: {
    'projectLinks.support': 'Termexo を気に入ったら、Star で応援してください。',
    'projectLinks.group': 'Termexo プロジェクトリンク',
    'projectLinks.home': '公式サイト',
    'projectLinks.star': 'GitHub Star',
    'projectLinks.openFailed': 'リンクを開けませんでした',
  },
  ko: {
    'projectLinks.support': 'Termexo가 마음에 드시나요? Star로 응원해 주세요.',
    'projectLinks.group': 'Termexo 프로젝트 링크',
    'projectLinks.home': '홈페이지 방문',
    'projectLinks.star': 'GitHub Star',
    'projectLinks.openFailed': '링크를 열 수 없습니다',
  },
};

export function registerProjectLinkTranslations(): void {
  registerTranslations(PROJECT_LINK_TRANSLATIONS);
}
