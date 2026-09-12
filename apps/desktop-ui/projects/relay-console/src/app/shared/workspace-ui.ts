/**
 * Everything the console borrows from the desktop application.
 *
 * Keeping it to one module makes the coupling between the two Angular applications visible and
 * reviewable, and leaves the long relative paths in a single place instead of in every page.
 */
export { I18nService, registerTranslations } from '../../../../../src/app/core/i18n/i18n.service';
export type { TranslationBundle } from '../../../../../src/app/core/i18n/i18n.service';
export { formatRelativeTime } from '../../../../../src/app/core/i18n/relative-time';
export { TranslatePipe } from '../../../../../src/app/core/i18n/translate.pipe';
export { IconComponent } from '../../../../../src/app/shared/icon/icon';
