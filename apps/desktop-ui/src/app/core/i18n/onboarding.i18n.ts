import { registerTranslations, type TranslationBundle } from './i18n.service';

/**
 * Wording for the first-run guide.
 *
 * It lives outside the main tables because the guide is behind an `@defer` block that most
 * sessions never render: once a workspace exists it is never shown again.
 */
export const ONBOARDING_TRANSLATIONS: TranslationBundle = {
  en: {
    'onboarding.title': 'Welcome to Termexo',
    'onboarding.lead':
      'A workspace is a project folder plus the terminals you run in it. Termexo remembers both, so nothing has to be set up twice.',
    'onboarding.step1Title': 'Create a workspace',
    'onboarding.step1Body': 'Point it at the project folder you work in and give it a name.',
    'onboarding.step2Title': 'Open a terminal',
    'onboarding.step2Body':
      'Use + on the tab strip for a plain shell, or for Claude Code, Codex, or OpenCode.',
    'onboarding.step3Title': 'Come back to it',
    'onboarding.step3Body':
      'Close the app and reopen it: the folder, tabs, layout, model and theme are all still there.',
    'onboarding.create': 'Create your first workspace',
    'onboarding.privacy': 'Everything stays on this computer. There is no account and no sync.',
  },
  'zh-CN': {
    'onboarding.title': '欢迎使用 Termexo',
    'onboarding.lead':
      '一个工作空间就是一个项目目录，加上你在里面运行的终端。Termexo 会把两者都记住，不用搭第二遍。',
    'onboarding.step1Title': '创建工作空间',
    'onboarding.step1Body': '选择你正在开发的项目目录，给它起个名字。',
    'onboarding.step2Title': '打开终端',
    'onboarding.step2Body':
      '在标签栏点 + ，开一个普通 Shell，或者直接启动 Claude Code、Codex、OpenCode。',
    'onboarding.step3Title': '随时回来接着做',
    'onboarding.step3Body': '关掉应用再打开，目录、标签、布局、模型和主题都还在。',
    'onboarding.create': '创建第一个工作空间',
    'onboarding.privacy': '所有内容都留在这台电脑上，不需要注册，也没有同步。',
  },
  es: {
    'onboarding.title': 'Bienvenido a Termexo',
    'onboarding.lead':
      'Un espacio de trabajo es una carpeta de proyecto más las terminales que ejecutas en ella. Termexo recuerda ambas cosas, así no hay que configurar nada dos veces.',
    'onboarding.step1Title': 'Crea un espacio de trabajo',
    'onboarding.step1Body': 'Apúntalo a la carpeta del proyecto en la que trabajas y ponle nombre.',
    'onboarding.step2Title': 'Abre una terminal',
    'onboarding.step2Body':
      'Usa + en la barra de pestañas para una shell normal, o para Claude Code, Codex u OpenCode.',
    'onboarding.step3Title': 'Vuelve cuando quieras',
    'onboarding.step3Body':
      'Cierra la aplicación y ábrela de nuevo: la carpeta, las pestañas, el diseño, el modelo y el tema siguen ahí.',
    'onboarding.create': 'Crear el primer espacio de trabajo',
    'onboarding.privacy': 'Todo se queda en este equipo. No hay cuenta ni sincronización.',
  },
  fr: {
    'onboarding.title': 'Bienvenue dans Termexo',
    'onboarding.lead':
      "Un espace de travail, c'est un dossier de projet et les terminaux que vous y lancez. Termexo retient les deux, rien n'est à reconfigurer.",
    'onboarding.step1Title': 'Créez un espace de travail',
    'onboarding.step1Body':
      'Choisissez le dossier du projet sur lequel vous travaillez et nommez-le.',
    'onboarding.step2Title': 'Ouvrez un terminal',
    'onboarding.step2Body':
      "Utilisez + dans la barre d'onglets pour un shell simple, ou pour Claude Code, Codex ou OpenCode.",
    'onboarding.step3Title': 'Revenez quand vous voulez',
    'onboarding.step3Body':
      "Fermez l'application et rouvrez-la : le dossier, les onglets, la disposition, le modèle et le thème sont toujours là.",
    'onboarding.create': 'Créer le premier espace de travail',
    'onboarding.privacy': 'Tout reste sur cet ordinateur. Aucun compte, aucune synchronisation.',
  },
  de: {
    'onboarding.title': 'Willkommen bei Termexo',
    'onboarding.lead':
      'Ein Arbeitsbereich ist ein Projektordner plus die Terminals, die Sie darin ausführen. Termexo merkt sich beides, damit nichts zweimal eingerichtet werden muss.',
    'onboarding.step1Title': 'Arbeitsbereich anlegen',
    'onboarding.step1Body':
      'Wählen Sie den Projektordner, in dem Sie arbeiten, und geben Sie ihm einen Namen.',
    'onboarding.step2Title': 'Terminal öffnen',
    'onboarding.step2Body':
      'Über + in der Tab-Leiste starten Sie eine einfache Shell oder Claude Code, Codex bzw. OpenCode.',
    'onboarding.step3Title': 'Jederzeit zurückkehren',
    'onboarding.step3Body':
      'Schließen Sie die App und öffnen Sie sie erneut: Ordner, Tabs, Layout, Modell und Theme sind noch da.',
    'onboarding.create': 'Ersten Arbeitsbereich anlegen',
    'onboarding.privacy': 'Alles bleibt auf diesem Rechner. Kein Konto, keine Synchronisierung.',
  },
  ja: {
    'onboarding.title': 'Termexo へようこそ',
    'onboarding.lead':
      'ワークスペースとは、プロジェクトのフォルダーと、そこで動かすターミナルのことです。Termexo は両方を覚えているので、同じ設定を二度する必要はありません。',
    'onboarding.step1Title': 'ワークスペースを作成',
    'onboarding.step1Body': '作業中のプロジェクトフォルダーを選び、名前を付けます。',
    'onboarding.step2Title': 'ターミナルを開く',
    'onboarding.step2Body':
      'タブバーの + から、通常のシェルや Claude Code、Codex、OpenCode を起動できます。',
    'onboarding.step3Title': 'いつでも戻れます',
    'onboarding.step3Body':
      'アプリを閉じて開き直しても、フォルダー・タブ・レイアウト・モデル・テーマはそのままです。',
    'onboarding.create': '最初のワークスペースを作成',
    'onboarding.privacy': 'すべてこのコンピューター内に残ります。アカウントも同期もありません。',
  },
  ko: {
    'onboarding.title': 'Termexo에 오신 것을 환영합니다',
    'onboarding.lead':
      '작업 공간은 프로젝트 폴더와 그 안에서 실행하는 터미널입니다. Termexo가 둘 다 기억하므로 같은 설정을 두 번 할 필요가 없습니다.',
    'onboarding.step1Title': '작업 공간 만들기',
    'onboarding.step1Body': '작업 중인 프로젝트 폴더를 지정하고 이름을 붙이세요.',
    'onboarding.step2Title': '터미널 열기',
    'onboarding.step2Body': '탭 바의 + 로 일반 셸이나 Claude Code, Codex, OpenCode를 시작합니다.',
    'onboarding.step3Title': '언제든 다시 이어서',
    'onboarding.step3Body':
      '앱을 닫았다 다시 열어도 폴더, 탭, 레이아웃, 모델, 테마가 그대로 남아 있습니다.',
    'onboarding.create': '첫 작업 공간 만들기',
    'onboarding.privacy': '모든 것은 이 컴퓨터에 남습니다. 계정도 동기화도 없습니다.',
  },
};

export function registerOnboardingTranslations(): void {
  registerTranslations(ONBOARDING_TRANSLATIONS);
}
