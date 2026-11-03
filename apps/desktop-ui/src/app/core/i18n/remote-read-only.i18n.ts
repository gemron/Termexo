import { registerTranslations } from './i18n.service';

registerTranslations({
  en: {
    'remote.linkPermission': 'Link permissions',
    'remote.controlLink': 'Control link',
    'remote.viewingLink': 'Read-only link',
    'remote.viewingLinkHint': 'Read-only viewers can watch terminal output. They cannot type, run commands or change settings. Regenerating the token revokes both links.',
    'remote.viewing': 'Read-only',
    'remote.viewingEmpty': 'No terminals to display. Start a terminal in the desktop app.',
    'remote.workspace': 'Workspace',
  },
  'zh-CN': {
    'remote.linkPermission': '链接权限',
    'remote.controlLink': '可控制链接',
    'remote.viewingLink': '只读链接',
    'remote.viewingLinkHint': '只读访客可查看终端输出，无法输入、执行命令或修改配置。重新生成令牌会使两种旧链接同时失效。',
    'remote.viewing': '只读模式',
    'remote.viewingEmpty': '暂无可查看的终端，请先在桌面端启动终端。',
    'remote.workspace': '工作区',
  },
  de: {
    'remote.linkPermission': 'Link-Berechtigungen',
    'remote.controlLink': 'Steuerungslink',
    'remote.viewingLink': 'Nur-Lese-Link',
    'remote.viewingLinkHint': 'Betrachter können Terminalausgaben sehen, aber keine Eingaben senden, Befehle ausführen oder Einstellungen ändern. Ein neuer Token macht beide bisherigen Links ungültig.',
    'remote.viewing': 'Nur lesen',
    'remote.viewingEmpty': 'Keine Terminals verfügbar. Starten Sie ein Terminal in der Desktop-App.',
    'remote.workspace': 'Arbeitsbereich',
  },
});
