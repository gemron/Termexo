import { registerTranslations, type TranslationBundle } from './i18n.service';

/**
 * Wording for the touch keypad a remote phone gets over its terminal.
 *
 * Kept out of the main tables for the same reason as the keypad itself: it only renders behind an
 * `@defer` block on a touch device, so the desktop's initial bundle never carries it.
 */
export const QUICK_KEY_TRANSLATIONS: TranslationBundle = {
  en: {
    'quickKeys.show': 'Show terminal keys',
    'quickKeys.hide': 'Hide terminal keys',
    'quickKeys.group': 'Terminal keys',
    'quickKeys.escape': 'Esc: interrupt the agent',
    'quickKeys.shiftTab': 'Shift+Tab: switch mode',
    'quickKeys.tab': 'Tab: complete',
    'quickKeys.enter': 'Enter: confirm',
    'quickKeys.ctrlC': 'Ctrl+C: cancel; press twice to quit the agent',
    'quickKeys.up': 'Up arrow',
    'quickKeys.down': 'Down arrow',
    'quickKeys.left': 'Left arrow',
    'quickKeys.right': 'Right arrow',
  },
  'zh-CN': {
    'quickKeys.show': '展开快捷键',
    'quickKeys.hide': '收起快捷键',
    'quickKeys.group': '终端快捷键',
    'quickKeys.escape': 'Esc：中断 Agent 当前任务',
    'quickKeys.shiftTab': 'Shift+Tab：切换模式',
    'quickKeys.tab': 'Tab：补全',
    'quickKeys.enter': 'Enter：确认',
    'quickKeys.ctrlC': 'Ctrl+C：取消，连按两次退出 Agent',
    'quickKeys.up': '上方向键',
    'quickKeys.down': '下方向键',
    'quickKeys.left': '左方向键',
    'quickKeys.right': '右方向键',
  },
  es: {
    'quickKeys.show': 'Mostrar teclas del terminal',
    'quickKeys.hide': 'Ocultar teclas del terminal',
    'quickKeys.group': 'Teclas del terminal',
    'quickKeys.escape': 'Esc: interrumpir al agente',
    'quickKeys.shiftTab': 'Mayús+Tab: cambiar de modo',
    'quickKeys.tab': 'Tab: completar',
    'quickKeys.enter': 'Intro: confirmar',
    'quickKeys.ctrlC': 'Ctrl+C: cancelar; pulsa dos veces para salir del agente',
    'quickKeys.up': 'Flecha arriba',
    'quickKeys.down': 'Flecha abajo',
    'quickKeys.left': 'Flecha izquierda',
    'quickKeys.right': 'Flecha derecha',
  },
  fr: {
    'quickKeys.show': 'Afficher les touches du terminal',
    'quickKeys.hide': 'Masquer les touches du terminal',
    'quickKeys.group': 'Touches du terminal',
    'quickKeys.escape': "Échap : interrompre l'agent",
    'quickKeys.shiftTab': 'Maj+Tab : changer de mode',
    'quickKeys.tab': 'Tab : compléter',
    'quickKeys.enter': 'Entrée : valider',
    'quickKeys.ctrlC': "Ctrl+C : annuler ; deux fois pour quitter l'agent",
    'quickKeys.up': 'Flèche haut',
    'quickKeys.down': 'Flèche bas',
    'quickKeys.left': 'Flèche gauche',
    'quickKeys.right': 'Flèche droite',
  },
  de: {
    'quickKeys.show': 'Terminaltasten einblenden',
    'quickKeys.hide': 'Terminaltasten ausblenden',
    'quickKeys.group': 'Terminaltasten',
    'quickKeys.escape': 'Esc: Agent unterbrechen',
    'quickKeys.shiftTab': 'Umschalt+Tab: Modus wechseln',
    'quickKeys.tab': 'Tab: vervollständigen',
    'quickKeys.enter': 'Eingabe: bestätigen',
    'quickKeys.ctrlC': 'Strg+C: abbrechen; zweimal drücken beendet den Agent',
    'quickKeys.up': 'Pfeil nach oben',
    'quickKeys.down': 'Pfeil nach unten',
    'quickKeys.left': 'Pfeil nach links',
    'quickKeys.right': 'Pfeil nach rechts',
  },
  ja: {
    'quickKeys.show': 'ターミナルキーを表示',
    'quickKeys.hide': 'ターミナルキーを隠す',
    'quickKeys.group': 'ターミナルキー',
    'quickKeys.escape': 'Esc: エージェントを中断',
    'quickKeys.shiftTab': 'Shift+Tab: モードを切り替え',
    'quickKeys.tab': 'Tab: 補完',
    'quickKeys.enter': 'Enter: 確定',
    'quickKeys.ctrlC': 'Ctrl+C: キャンセル（2 回押すとエージェントを終了）',
    'quickKeys.up': '上矢印キー',
    'quickKeys.down': '下矢印キー',
    'quickKeys.left': '左矢印キー',
    'quickKeys.right': '右矢印キー',
  },
  ko: {
    'quickKeys.show': '터미널 키 표시',
    'quickKeys.hide': '터미널 키 숨기기',
    'quickKeys.group': '터미널 키',
    'quickKeys.escape': 'Esc: 에이전트 중단',
    'quickKeys.shiftTab': 'Shift+Tab: 모드 전환',
    'quickKeys.tab': 'Tab: 자동 완성',
    'quickKeys.enter': 'Enter: 확인',
    'quickKeys.ctrlC': 'Ctrl+C: 취소, 두 번 누르면 에이전트 종료',
    'quickKeys.up': '위쪽 화살표',
    'quickKeys.down': '아래쪽 화살표',
    'quickKeys.left': '왼쪽 화살표',
    'quickKeys.right': '오른쪽 화살표',
  },
};

/** Makes the wording above available; the keypad calls it at module scope. */
export function registerQuickKeyTranslations(): void {
  registerTranslations(QUICK_KEY_TRANSLATIONS);
}
