import { registerTranslations, type TranslationBundle } from './i18n.service';

/**
 * Wording for the WebView2 upgrade notice.
 *
 * It lives outside the main tables because the notice is behind an `@defer` block that almost no
 * session renders: the runtime updates itself, so only a machine held back on a pinned or offline
 * version ever reaches it.
 */
export const WEBVIEW_TRANSLATIONS: TranslationBundle = {
  en: {
    'webview.title': 'WebView2 runtime needs updating',
    'webview.lead': 'This runtime is {version}. Termexo needs {minimum} or newer.',
    'webview.leadUnknown':
      'The WebView2 runtime version could not be read. Termexo needs {minimum} or newer.',
    'webview.impact':
      'Below that the interface loses its colours and parts of the layout can break.',
    'webview.installHeading': 'How to install',
    'webview.installDownload': 'Open the download page, take the Evergreen Bootstrapper, run it.',
    'webview.installWinget': 'Or run this in PowerShell:',
    'webview.installRestart': 'Restart Termexo once the install finishes.',
    'webview.openDownload': 'Open download page',
    'webview.opening': 'Opening…',
    'webview.openFailed': 'The download page could not be opened: {message}',
    'webview.address': 'Address',
    'webview.dismiss': 'Not now',
  },
  'zh-CN': {
    'webview.title': 'WebView2 运行时需要更新',
    'webview.lead': '当前运行时为 {version}，Termexo 需要 {minimum} 或更新的版本。',
    'webview.leadUnknown':
      '无法读取当前 WebView2 运行时的版本，Termexo 需要 {minimum} 或更新的版本。',
    'webview.impact': '版本过低时界面配色会失效，部分区域的布局也可能错位。',
    'webview.installHeading': '安装方式',
    'webview.installDownload': '打开下载页，获取 Evergreen Bootstrapper 并运行安装程序。',
    'webview.installWinget': '或在 PowerShell 中执行：',
    'webview.installRestart': '安装完成后重新启动 Termexo。',
    'webview.openDownload': '打开下载页',
    'webview.opening': '正在打开…',
    'webview.openFailed': '打开下载页失败：{message}',
    'webview.address': '地址',
    'webview.dismiss': '暂不处理',
  },
  es: {
    'webview.title': 'El runtime de WebView2 necesita actualizarse',
    'webview.lead': 'Este runtime es {version}. Termexo necesita {minimum} o posterior.',
    'webview.leadUnknown':
      'No se pudo leer la versión del runtime de WebView2. Termexo necesita {minimum} o posterior.',
    'webview.impact':
      'Por debajo de esa versión la interfaz pierde sus colores y parte del diseño puede romperse.',
    'webview.installHeading': 'Cómo instalarlo',
    'webview.installDownload':
      'Abre la página de descarga, toma el Evergreen Bootstrapper y ejecútalo.',
    'webview.installWinget': 'O ejecuta esto en PowerShell:',
    'webview.installRestart': 'Reinicia Termexo cuando termine la instalación.',
    'webview.openDownload': 'Abrir página de descarga',
    'webview.opening': 'Abriendo…',
    'webview.openFailed': 'No se pudo abrir la página de descarga: {message}',
    'webview.address': 'Dirección',
    'webview.dismiss': 'Ahora no',
  },
  fr: {
    'webview.title': 'Le runtime WebView2 doit être mis à jour',
    'webview.lead': 'Ce runtime est en {version}. Termexo demande {minimum} ou plus récent.',
    'webview.leadUnknown':
      "La version du runtime WebView2 n'a pas pu être lue. Termexo demande {minimum} ou plus récent.",
    'webview.impact':
      "En dessous, l'interface perd ses couleurs et une partie de la mise en page peut casser.",
    'webview.installHeading': 'Comment installer',
    'webview.installDownload':
      'Ouvrez la page de téléchargement, prenez le Evergreen Bootstrapper et lancez-le.',
    'webview.installWinget': 'Ou exécutez ceci dans PowerShell :',
    'webview.installRestart': "Redémarrez Termexo une fois l'installation terminée.",
    'webview.openDownload': 'Ouvrir la page de téléchargement',
    'webview.opening': 'Ouverture…',
    'webview.openFailed': "La page de téléchargement n'a pas pu être ouverte : {message}",
    'webview.address': 'Adresse',
    'webview.dismiss': 'Plus tard',
  },
  de: {
    'webview.title': 'Die WebView2-Laufzeit muss aktualisiert werden',
    'webview.lead': 'Diese Laufzeit ist {version}. Termexo benötigt {minimum} oder neuer.',
    'webview.leadUnknown':
      'Die Version der WebView2-Laufzeit ließ sich nicht lesen. Termexo benötigt {minimum} oder neuer.',
    'webview.impact':
      'Darunter verliert die Oberfläche ihre Farben und Teile des Layouts können brechen.',
    'webview.installHeading': 'So wird installiert',
    'webview.installDownload':
      'Öffne die Downloadseite, nimm den Evergreen Bootstrapper und führe ihn aus.',
    'webview.installWinget': 'Oder führe dies in PowerShell aus:',
    'webview.installRestart': 'Starte Termexo neu, sobald die Installation fertig ist.',
    'webview.openDownload': 'Downloadseite öffnen',
    'webview.opening': 'Wird geöffnet…',
    'webview.openFailed': 'Die Downloadseite ließ sich nicht öffnen: {message}',
    'webview.address': 'Adresse',
    'webview.dismiss': 'Später',
  },
  ja: {
    'webview.title': 'WebView2 ランタイムの更新が必要です',
    'webview.lead': '現在のランタイムは {version} です。Termexo には {minimum} 以降が必要です。',
    'webview.leadUnknown':
      'WebView2 ランタイムのバージョンを取得できませんでした。Termexo には {minimum} 以降が必要です。',
    'webview.impact': 'それより古いと画面の配色が失われ、一部のレイアウトが崩れることがあります。',
    'webview.installHeading': 'インストール方法',
    'webview.installDownload':
      'ダウンロードページを開き、Evergreen Bootstrapper を取得して実行します。',
    'webview.installWinget': 'または PowerShell で次を実行します:',
    'webview.installRestart': 'インストール後に Termexo を再起動してください。',
    'webview.openDownload': 'ダウンロードページを開く',
    'webview.opening': '開いています…',
    'webview.openFailed': 'ダウンロードページを開けませんでした: {message}',
    'webview.address': 'アドレス',
    'webview.dismiss': '後で',
  },
  ko: {
    'webview.title': 'WebView2 런타임을 업데이트해야 합니다',
    'webview.lead': '현재 런타임은 {version}입니다. Termexo에는 {minimum} 이상이 필요합니다.',
    'webview.leadUnknown':
      'WebView2 런타임 버전을 읽을 수 없습니다. Termexo에는 {minimum} 이상이 필요합니다.',
    'webview.impact': '그보다 낮으면 화면 색상이 사라지고 일부 레이아웃이 깨질 수 있습니다.',
    'webview.installHeading': '설치 방법',
    'webview.installDownload': '다운로드 페이지를 열고 Evergreen Bootstrapper를 받아 실행하세요.',
    'webview.installWinget': '또는 PowerShell에서 다음을 실행하세요:',
    'webview.installRestart': '설치가 끝나면 Termexo를 다시 시작하세요.',
    'webview.openDownload': '다운로드 페이지 열기',
    'webview.opening': '여는 중…',
    'webview.openFailed': '다운로드 페이지를 열지 못했습니다: {message}',
    'webview.address': '주소',
    'webview.dismiss': '나중에',
  },
};

export function registerWebviewTranslations(): void {
  registerTranslations(WEBVIEW_TRANSLATIONS);
}
