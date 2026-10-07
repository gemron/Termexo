import { registerTranslations, type TranslationBundle } from './i18n.service';

const REMOTE_ACCESS_GUIDE_TRANSLATIONS: TranslationBundle = {
  en: {
    'remote.guideTitle': 'Choose how to connect',
    'remote.guideLan': 'Local network',
    'remote.guideLanHint':
      'Connect your phone and computer to the same Wi-Fi or LAN. Enable the remote service below, save, then open its link or scan its QR code. No relay is needed.',
    'remote.guideInternet': 'Internet',
    'remote.guideInternetHint':
      'Mobile data or another network needs a relay. Deploy your own or apply for the free relay trial.',
    'remote.guideSelfHost': 'Deploy your own relay',
    'remote.guideSelfHostHint':
      'Follow the official installation guide to get a relay address and enrollment details.',
    'remote.guideDocs': 'Open installation guide',
    'remote.guideFreeRelay': 'Free relay trial',
    'remote.guideFreeRelayHint':
      'Apply by email. After receiving the relay address and enrollment details, enter them below and connect.',
    'remote.guideApply': 'Apply by email',
    'remote.guideOpenFailed': 'Could not open the link',
  },
  'zh-CN': {
    'remote.guideTitle': '选择访问方式',
    'remote.guideLan': '局域网访问',
    'remote.guideLanHint':
      '手机和电脑连接同一 Wi-Fi／局域网。开启下方远程服务并保存，再打开访问链接或扫描二维码，无需中继。',
    'remote.guideInternet': '互联网访问',
    'remote.guideInternetHint':
      '使用手机流量或其他网络访问时，需要中继服务。可以自己部署，也可以申请免费中继测试。',
    'remote.guideSelfHost': '自己部署中继',
    'remote.guideSelfHostHint': '按官网安装文档部署，获取中继地址及接入信息。',
    'remote.guideDocs': '打开官网安装文档',
    'remote.guideFreeRelay': '免费中继测试',
    'remote.guideFreeRelayHint': '发邮件申请测试；收到中继地址及接入信息后，在下方填写并连接。',
    'remote.guideApply': '发邮件申请测试',
    'remote.guideOpenFailed': '无法打开链接',
  },
  es: {
    'remote.guideTitle': 'Elige cómo conectarte',
    'remote.guideLan': 'Red local',
    'remote.guideLanHint':
      'Conecta el móvil y el ordenador a la misma Wi-Fi o LAN. Activa el servicio remoto, guarda y abre el enlace o escanea el QR. No necesitas un relay.',
    'remote.guideInternet': 'Internet',
    'remote.guideInternetHint':
      'Los datos móviles u otra red requieren un relay. Despliega el tuyo o solicita la prueba gratuita.',
    'remote.guideSelfHost': 'Desplegar tu propio relay',
    'remote.guideSelfHostHint':
      'Sigue la guía oficial para obtener la dirección y los datos de registro del relay.',
    'remote.guideDocs': 'Abrir guía de instalación',
    'remote.guideFreeRelay': 'Prueba gratuita del relay',
    'remote.guideFreeRelayHint':
      'Solicítala por correo. Cuando recibas la dirección y los datos de registro, introdúcelos abajo y conecta.',
    'remote.guideApply': 'Solicitar por correo',
    'remote.guideOpenFailed': 'No se pudo abrir el enlace',
  },
  fr: {
    'remote.guideTitle': 'Choisir le mode de connexion',
    'remote.guideLan': 'Réseau local',
    'remote.guideLanHint':
      'Connectez le téléphone et l’ordinateur au même Wi-Fi ou LAN. Activez le service distant, enregistrez, puis ouvrez le lien ou scannez le QR. Aucun relais n’est nécessaire.',
    'remote.guideInternet': 'Internet',
    'remote.guideInternetHint':
      'Les données mobiles ou un autre réseau nécessitent un relais. Déployez le vôtre ou demandez un essai gratuit.',
    'remote.guideSelfHost': 'Déployer son propre relais',
    'remote.guideSelfHostHint':
      'Suivez le guide officiel pour obtenir l’adresse du relais et les informations d’inscription.',
    'remote.guideDocs': 'Ouvrir le guide d’installation',
    'remote.guideFreeRelay': 'Essai gratuit du relais',
    'remote.guideFreeRelayHint':
      'Faites la demande par e-mail. Une fois l’adresse et les informations reçues, saisissez-les ci-dessous et connectez-vous.',
    'remote.guideApply': 'Demander par e-mail',
    'remote.guideOpenFailed': 'Impossible d’ouvrir le lien',
  },
  de: {
    'remote.guideTitle': 'Verbindungsart wählen',
    'remote.guideLan': 'Lokales Netzwerk',
    'remote.guideLanHint':
      'Verbinde Handy und Computer mit demselben WLAN oder LAN. Aktiviere den Fernzugriff, speichere und öffne den Link oder scanne den QR-Code. Kein Relay nötig.',
    'remote.guideInternet': 'Internet',
    'remote.guideInternetHint':
      'Mobile Daten oder ein anderes Netzwerk erfordern ein Relay. Betreibe ein eigenes oder beantrage den kostenlosen Test.',
    'remote.guideSelfHost': 'Eigenes Relay betreiben',
    'remote.guideSelfHostHint':
      'Folge der offiziellen Installationsanleitung, um Relay-Adresse und Anmeldedaten zu erhalten.',
    'remote.guideDocs': 'Installationsanleitung öffnen',
    'remote.guideFreeRelay': 'Kostenloser Relay-Test',
    'remote.guideFreeRelayHint':
      'Beantrage den Test per E-Mail. Trage die erhaltene Adresse und Anmeldedaten unten ein und verbinde dich.',
    'remote.guideApply': 'Per E-Mail beantragen',
    'remote.guideOpenFailed': 'Link konnte nicht geöffnet werden',
  },
  ja: {
    'remote.guideTitle': '接続方法を選ぶ',
    'remote.guideLan': 'ローカルネットワーク',
    'remote.guideLanHint':
      'スマートフォンとパソコンを同じ Wi-Fi／LAN に接続します。下のリモートサービスを有効にして保存し、リンクを開くか QR コードを読み取ります。中継は不要です。',
    'remote.guideInternet': 'インターネット',
    'remote.guideInternetHint':
      'モバイル回線や別のネットワークからは中継サービスが必要です。自分で構築するか、無料テストを申し込めます。',
    'remote.guideSelfHost': '中継を自分で構築',
    'remote.guideSelfHostHint':
      '公式インストールガイドに従い、中継アドレスと登録情報を取得します。',
    'remote.guideDocs': '公式インストールガイドを開く',
    'remote.guideFreeRelay': '無料中継テスト',
    'remote.guideFreeRelayHint':
      'メールで申し込みます。中継アドレスと登録情報が届いたら、下に入力して接続してください。',
    'remote.guideApply': 'メールでテストを申し込む',
    'remote.guideOpenFailed': 'リンクを開けませんでした',
  },
  ko: {
    'remote.guideTitle': '접속 방법 선택',
    'remote.guideLan': '로컬 네트워크',
    'remote.guideLanHint':
      '휴대폰과 컴퓨터를 같은 Wi-Fi／LAN에 연결하세요. 아래 원격 서비스를 켜고 저장한 다음 링크를 열거나 QR 코드를 스캔하세요. 중계가 필요하지 않습니다.',
    'remote.guideInternet': '인터넷',
    'remote.guideInternetHint':
      '모바일 데이터나 다른 네트워크에서는 중계 서비스가 필요합니다. 직접 배포하거나 무료 테스트를 신청할 수 있습니다.',
    'remote.guideSelfHost': '중계 직접 배포',
    'remote.guideSelfHostHint': '공식 설치 안내에 따라 중계 주소와 등록 정보를 준비하세요.',
    'remote.guideDocs': '공식 설치 안내 열기',
    'remote.guideFreeRelay': '무료 중계 테스트',
    'remote.guideFreeRelayHint':
      '이메일로 신청하세요. 중계 주소와 등록 정보를 받으면 아래에 입력하고 연결하세요.',
    'remote.guideApply': '이메일로 테스트 신청',
    'remote.guideOpenFailed': '링크를 열 수 없습니다',
  },
};

export function registerRemoteAccessGuideTranslations(): void {
  registerTranslations(REMOTE_ACCESS_GUIDE_TRANSLATIONS);
}
