import { registerTranslations, type TranslationBundle } from './i18n.service';

/** Loaded with the guide for a new or empty workspace. */
export const ONBOARDING_TRANSLATIONS: TranslationBundle = {
  en: {
    'onboarding.title': 'Start your first Agent',
    'onboarding.lead':
      'Choose a project and an available Agent. Termexo keeps your sessions together and helps you spot who needs you.',
    'onboarding.projectTitle': 'Choose a project',
    'onboarding.projectReady': 'Selected',
    'onboarding.projectHelp': 'A workspace keeps a project folder and its terminals together.',
    'onboarding.projectAction': 'Choose project folder',
    'onboarding.agentTitle': 'Choose an Agent',
    'onboarding.runTitle': 'Send a task',
    'onboarding.preview':
      'Browser preview cannot detect or launch local CLIs. Continue in the Windows desktop app.',
    'onboarding.readyCount': '{count} Agent CLIs available',
    'onboarding.checkAgain': 'Check again',
    'onboarding.status.checking': 'Checking…',
    'onboarding.status.ready': 'CLI available',
    'onboarding.status.missing': 'Not installed',
    'onboarding.status.unhealthy': 'Needs repair',
    'onboarding.status.error': 'Detection failed',
    'onboarding.useNamedAgent': 'Continue with {name}',
    'onboarding.startAgent': 'Configure & start',
    'onboarding.useAgent': 'Use this Agent',
    'onboarding.install': 'Install',
    'onboarding.repair': 'Repair',
    'onboarding.configurationNote':
      'Next, confirm the model and account to use. An available CLI may still ask you to sign in when it starts.',
    'onboarding.remoteInstall': 'Install or repair CLIs on the host computer.',
    'onboarding.runBody':
      'Send your task in the terminal. When an Agent needs input or approval, use the attention banner to return to its session, even from another project.',
    'onboarding.shell': 'Open a plain terminal',
    'onboarding.privacy':
      'No Termexo account required. Model requests use your configured Agent service. Phone access is optional.',
  },
  'zh-CN': {
    'onboarding.title': '启动你的第一个 Agent',
    'onboarding.lead': '选好项目和可用的 Agent，即可开始。Termexo 帮你集中管理会话，看清谁在等你。',
    'onboarding.projectTitle': '选择项目',
    'onboarding.projectReady': '已选择',
    'onboarding.projectHelp': '一个工作区，保存一个项目目录和它的终端。',
    'onboarding.projectAction': '选择项目文件夹',
    'onboarding.agentTitle': '选择 Agent',
    'onboarding.runTitle': '发送任务',
    'onboarding.preview': '浏览器预览无法检测或启动本机 CLI，请在 Windows 桌面版继续。',
    'onboarding.readyCount': '{count} 个 Agent CLI 可用',
    'onboarding.checkAgain': '重新检测',
    'onboarding.status.checking': '检测中…',
    'onboarding.status.ready': 'CLI 可用',
    'onboarding.status.missing': '未安装',
    'onboarding.status.unhealthy': '需要修复',
    'onboarding.status.error': '检测失败',
    'onboarding.useNamedAgent': '使用 {name} 继续',
    'onboarding.startAgent': '配置并启动',
    'onboarding.useAgent': '使用此 Agent',
    'onboarding.install': '安装',
    'onboarding.repair': '修复',
    'onboarding.configurationNote':
      '下一步确认要使用的模型和账号。CLI 可用不代表已登录，启动后可能仍需登录。',
    'onboarding.remoteInstall': '请在主机电脑上安装或修复 CLI。',
    'onboarding.runBody':
      '在终端里发送任务。Agent 等待输入或审批时，点击提醒即可回到对应会话，即使你正在另一个项目中。',
    'onboarding.shell': '打开普通终端',
    'onboarding.privacy': '无需注册 Termexo 账号。模型请求使用你配置的 Agent 服务；手机连接可选。',
  },
  es: {
    'onboarding.title': 'Inicia tu primer agente',
    'onboarding.lead':
      'Elige un proyecto y un agente disponible. Termexo reúne tus sesiones y te ayuda a ver quién te necesita.',
    'onboarding.projectTitle': 'Elige un proyecto',
    'onboarding.projectReady': 'Seleccionado',
    'onboarding.projectHelp': 'Un espacio reúne una carpeta de proyecto y sus terminales.',
    'onboarding.projectAction': 'Elegir carpeta',
    'onboarding.agentTitle': 'Elige un agente',
    'onboarding.runTitle': 'Envía una tarea',
    'onboarding.preview':
      'La vista previa no puede detectar ni iniciar CLI locales. Continúa en la aplicación de Windows.',
    'onboarding.readyCount': '{count} CLI de agentes disponibles',
    'onboarding.checkAgain': 'Comprobar de nuevo',
    'onboarding.status.checking': 'Comprobando…',
    'onboarding.status.ready': 'CLI disponible',
    'onboarding.status.missing': 'Sin instalar',
    'onboarding.status.unhealthy': 'Requiere reparación',
    'onboarding.status.error': 'Error de detección',
    'onboarding.useNamedAgent': 'Continuar con {name}',
    'onboarding.startAgent': 'Configurar e iniciar',
    'onboarding.useAgent': 'Usar este agente',
    'onboarding.install': 'Instalar',
    'onboarding.repair': 'Reparar',
    'onboarding.configurationNote':
      'A continuación, confirma el modelo y la cuenta. Una CLI disponible aún puede pedirte iniciar sesión al arrancar.',
    'onboarding.remoteInstall': 'Instala o repara las CLI en el equipo anfitrión.',
    'onboarding.runBody':
      'Envía tu tarea en la terminal. Si un agente necesita una respuesta o aprobación, usa el aviso para volver a su sesión, incluso desde otro proyecto.',
    'onboarding.shell': 'Abrir una terminal normal',
    'onboarding.privacy':
      'No necesitas una cuenta de Termexo. Las solicitudes usan el servicio de agente configurado. El acceso desde el móvil es opcional.',
  },
  fr: {
    'onboarding.title': 'Démarrez votre premier agent',
    'onboarding.lead':
      'Choisissez un projet et un agent disponible. Termexo regroupe vos sessions et vous aide à voir qui vous attend.',
    'onboarding.projectTitle': 'Choisir un projet',
    'onboarding.projectReady': 'Sélectionné',
    'onboarding.projectHelp': 'Un espace regroupe un dossier de projet et ses terminaux.',
    'onboarding.projectAction': 'Choisir un dossier',
    'onboarding.agentTitle': 'Choisir un agent',
    'onboarding.runTitle': 'Envoyer une tâche',
    'onboarding.preview':
      'L’aperçu du navigateur ne peut ni détecter ni lancer les CLI locales. Continuez dans l’application Windows.',
    'onboarding.readyCount': '{count} CLI d’agents disponibles',
    'onboarding.checkAgain': 'Vérifier à nouveau',
    'onboarding.status.checking': 'Vérification…',
    'onboarding.status.ready': 'CLI disponible',
    'onboarding.status.missing': 'Non installé',
    'onboarding.status.unhealthy': 'À réparer',
    'onboarding.status.error': 'Échec de détection',
    'onboarding.useNamedAgent': 'Continuer avec {name}',
    'onboarding.startAgent': 'Configurer et lancer',
    'onboarding.useAgent': 'Utiliser cet agent',
    'onboarding.install': 'Installer',
    'onboarding.repair': 'Réparer',
    'onboarding.configurationNote':
      'Confirmez ensuite le modèle et le compte. Une CLI disponible peut encore demander une connexion au démarrage.',
    'onboarding.remoteInstall': 'Installez ou réparez les CLI sur l’ordinateur hôte.',
    'onboarding.runBody':
      'Envoyez votre tâche dans le terminal. Lorsqu’un agent attend une réponse ou une approbation, utilisez la bannière pour revenir à sa session, même depuis un autre projet.',
    'onboarding.shell': 'Ouvrir un terminal simple',
    'onboarding.privacy':
      'Aucun compte Termexo requis. Les requêtes utilisent le service d’agent configuré. L’accès mobile est facultatif.',
  },
  de: {
    'onboarding.title': 'Starten Sie Ihren ersten Agenten',
    'onboarding.lead':
      'Wählen Sie ein Projekt und einen verfügbaren Agenten. Termexo bündelt Ihre Sitzungen und zeigt, wer Sie braucht.',
    'onboarding.projectTitle': 'Projekt wählen',
    'onboarding.projectReady': 'Ausgewählt',
    'onboarding.projectHelp': 'Ein Arbeitsbereich bündelt einen Projektordner und seine Terminals.',
    'onboarding.projectAction': 'Projektordner wählen',
    'onboarding.agentTitle': 'Agenten wählen',
    'onboarding.runTitle': 'Aufgabe senden',
    'onboarding.preview':
      'Die Browser-Vorschau kann lokale CLIs weder erkennen noch starten. Nutzen Sie die Windows-App.',
    'onboarding.readyCount': '{count} Agenten-CLIs verfügbar',
    'onboarding.checkAgain': 'Erneut prüfen',
    'onboarding.status.checking': 'Wird geprüft…',
    'onboarding.status.ready': 'CLI verfügbar',
    'onboarding.status.missing': 'Nicht installiert',
    'onboarding.status.unhealthy': 'Reparatur nötig',
    'onboarding.status.error': 'Erkennung fehlgeschlagen',
    'onboarding.useNamedAgent': 'Mit {name} fortfahren',
    'onboarding.startAgent': 'Einrichten und starten',
    'onboarding.useAgent': 'Agenten verwenden',
    'onboarding.install': 'Installieren',
    'onboarding.repair': 'Reparieren',
    'onboarding.configurationNote':
      'Bestätigen Sie als Nächstes Modell und Konto. Eine verfügbare CLI kann beim Start noch eine Anmeldung verlangen.',
    'onboarding.remoteInstall': 'Installieren oder reparieren Sie CLIs auf dem Host-Computer.',
    'onboarding.runBody':
      'Senden Sie Ihre Aufgabe im Terminal. Wartet ein Agent auf Eingabe oder Freigabe, führt Sie der Hinweis zu seiner Sitzung zurück, auch aus einem anderen Projekt.',
    'onboarding.shell': 'Einfaches Terminal öffnen',
    'onboarding.privacy':
      'Kein Termexo-Konto erforderlich. Modellanfragen nutzen den konfigurierten Agenten-Dienst. Der Handy-Zugriff ist optional.',
  },
  ja: {
    'onboarding.title': '最初のエージェントを起動',
    'onboarding.lead':
      'プロジェクトと利用可能なエージェントを選びます。Termexo はセッションをまとめ、対応が必要なものを見つけやすくします。',
    'onboarding.projectTitle': 'プロジェクトを選択',
    'onboarding.projectReady': '選択済み',
    'onboarding.projectHelp': 'ワークスペースはプロジェクトフォルダーとターミナルをまとめます。',
    'onboarding.projectAction': 'フォルダーを選択',
    'onboarding.agentTitle': 'エージェントを選択',
    'onboarding.runTitle': 'タスクを送信',
    'onboarding.preview':
      'ブラウザープレビューではローカル CLI の検出や起動はできません。Windows アプリで続行してください。',
    'onboarding.readyCount': '{count} 個のエージェント CLI が利用可能',
    'onboarding.checkAgain': '再検出',
    'onboarding.status.checking': '検出中…',
    'onboarding.status.ready': 'CLI 利用可能',
    'onboarding.status.missing': '未インストール',
    'onboarding.status.unhealthy': '修復が必要',
    'onboarding.status.error': '検出失敗',
    'onboarding.useNamedAgent': '{name} で続行',
    'onboarding.startAgent': '設定して起動',
    'onboarding.useAgent': 'このエージェントを使用',
    'onboarding.install': 'インストール',
    'onboarding.repair': '修復',
    'onboarding.configurationNote':
      '次にモデルとアカウントを確認します。CLI が利用可能でも、起動後にログインが必要な場合があります。',
    'onboarding.remoteInstall': 'CLI のインストールや修復はホスト PC で行ってください。',
    'onboarding.runBody':
      'ターミナルでタスクを送信します。エージェントが入力や承認を待っているときは、別のプロジェクトにいても通知バナーからそのセッションに戻れます。',
    'onboarding.shell': '通常のターミナルを開く',
    'onboarding.privacy':
      'Termexo アカウントは不要です。モデルへのリクエストは設定したエージェントサービスを使います。スマートフォン接続は任意です。',
  },
  ko: {
    'onboarding.title': '첫 에이전트 시작하기',
    'onboarding.lead':
      '프로젝트와 사용 가능한 에이전트를 선택하세요. Termexo가 세션을 모아 누가 기다리는지 쉽게 보여 줍니다.',
    'onboarding.projectTitle': '프로젝트 선택',
    'onboarding.projectReady': '선택됨',
    'onboarding.projectHelp': '작업 공간은 프로젝트 폴더와 터미널을 함께 보관합니다.',
    'onboarding.projectAction': '프로젝트 폴더 선택',
    'onboarding.agentTitle': '에이전트 선택',
    'onboarding.runTitle': '작업 보내기',
    'onboarding.preview':
      '브라우저 미리보기에서는 로컬 CLI를 감지하거나 실행할 수 없습니다. Windows 앱에서 계속하세요.',
    'onboarding.readyCount': '에이전트 CLI {count}개 사용 가능',
    'onboarding.checkAgain': '다시 감지',
    'onboarding.status.checking': '감지 중…',
    'onboarding.status.ready': 'CLI 사용 가능',
    'onboarding.status.missing': '설치되지 않음',
    'onboarding.status.unhealthy': '복구 필요',
    'onboarding.status.error': '감지 실패',
    'onboarding.useNamedAgent': '{name}으로 계속',
    'onboarding.startAgent': '설정 후 시작',
    'onboarding.useAgent': '이 에이전트 사용',
    'onboarding.install': '설치',
    'onboarding.repair': '복구',
    'onboarding.configurationNote':
      '다음으로 모델과 계정을 확인하세요. CLI를 사용할 수 있어도 시작 후 로그인이 필요할 수 있습니다.',
    'onboarding.remoteInstall': '호스트 컴퓨터에서 CLI를 설치하거나 복구하세요.',
    'onboarding.runBody':
      '터미널에서 작업을 보내세요. 에이전트가 입력이나 승인을 기다리면 다른 프로젝트에서도 알림 배너를 눌러 해당 세션으로 돌아갈 수 있습니다.',
    'onboarding.shell': '일반 터미널 열기',
    'onboarding.privacy':
      'Termexo 계정이 필요하지 않습니다. 모델 요청은 설정한 에이전트 서비스를 사용합니다. 휴대폰 연결은 선택 사항입니다.',
  },
};

export function registerOnboardingTranslations(): void {
  registerTranslations(ONBOARDING_TRANSLATIONS);
}
