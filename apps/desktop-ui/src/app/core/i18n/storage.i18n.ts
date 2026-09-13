import { registerTranslations, type TranslationBundle } from './i18n.service';

/**
 * Wording for the storage tab of the settings window.
 *
 * The tab renders behind an `@defer` block, so its strings ship in the same lazy chunk instead of
 * the initial bundle.
 */
export const STORAGE_TRANSLATIONS: TranslationBundle = {
  en: {
    'storage.title': 'Storage',
    'storage.subtitle': 'Where Termexo keeps its database, agent events and runtime files.',
    'storage.dataDirectory': 'Data directory',
    'storage.relocatedFrom': 'Moved here; the default is {path}',
    'storage.copyPath': 'Copy path',
    'storage.copied': 'Copied',
    'storage.copyFailed':
      'The clipboard is not available here. Select the path and copy it by hand.',
    'storage.openFolder': 'Open folder',
    'storage.moveHint':
      'Changing the data directory copies the current data to the folder you choose. Restart Termexo to start using it.',
    'storage.changeLocation': 'Change data directory',
    'storage.useDefault': 'Restore default location',
    'storage.moving': 'Copying…',
    'storage.pickDirectory': 'Choose a new data directory',
    'storage.usage': 'Disk usage',
    'storage.notCreated': 'not created yet',
    'storage.total': 'Total',
    'storage.application': 'Application',
    'storage.executable': 'Executable',
    'storage.version': 'Version',
    'storage.movedRestart':
      'Copied. Restart Termexo to use the new location. Nothing was deleted — the previous copy is still in {path}, and you can remove it once you are satisfied the move worked.',
    'storage.restoredRestart':
      'Restored to the default directory. Restart Termexo to use it. The copy you moved is still where you put it.',
    'storage.desktopOnly':
      'The data directory belongs to the desktop application, so the browser preview has none to show.',
  },
  'zh-CN': {
    'storage.title': '存储',
    'storage.subtitle': 'Termexo 的数据库、Agent 事件和运行时文件都保存在这里。',
    'storage.dataDirectory': '数据目录',
    'storage.relocatedFrom': '已迁移到此处，默认位置是 {path}',
    'storage.copyPath': '复制路径',
    'storage.copied': '已复制',
    'storage.copyFailed': '当前环境无法访问剪贴板，请选中路径后手动复制。',
    'storage.openFolder': '打开文件夹',
    'storage.moveHint': '更改数据目录会把现有数据复制到你选择的文件夹，重启 Termexo 后生效。',
    'storage.changeLocation': '更改数据目录',
    'storage.useDefault': '恢复默认位置',
    'storage.moving': '正在复制…',
    'storage.pickDirectory': '选择新的数据目录',
    'storage.usage': '占用明细',
    'storage.notCreated': '尚未创建',
    'storage.total': '合计',
    'storage.application': '程序信息',
    'storage.executable': '可执行文件',
    'storage.version': '版本',
    'storage.movedRestart':
      '已复制完成，重启 Termexo 后生效。原数据没有被删除，仍保留在 {path}；确认迁移无误后可以自行删除以释放空间。',
    'storage.restoredRestart':
      '已恢复为默认位置，重启 Termexo 后生效。你迁移出去的那份副本仍在原处。',
    'storage.desktopOnly': '数据目录属于桌面端应用，浏览器预览没有可显示的目录。',
  },
  es: {
    'storage.title': 'Almacenamiento',
    'storage.subtitle':
      'Dónde guarda Termexo su base de datos, los eventos de los Agents y los archivos de ejecución.',
    'storage.dataDirectory': 'Directorio de datos',
    'storage.relocatedFrom': 'Movido aquí; la ubicación predeterminada es {path}',
    'storage.copyPath': 'Copiar ruta',
    'storage.copied': 'Copiado',
    'storage.copyFailed':
      'El portapapeles no está disponible aquí. Selecciona la ruta y cópiala manualmente.',
    'storage.openFolder': 'Abrir carpeta',
    'storage.moveHint':
      'Cambiar el directorio de datos copia los datos actuales a la carpeta que elijas. Reinicia Termexo para empezar a usarla.',
    'storage.changeLocation': 'Cambiar directorio de datos',
    'storage.useDefault': 'Restaurar ubicación predeterminada',
    'storage.moving': 'Copiando…',
    'storage.pickDirectory': 'Elige un nuevo directorio de datos',
    'storage.usage': 'Uso de disco',
    'storage.notCreated': 'aún no creado',
    'storage.total': 'Total',
    'storage.application': 'Aplicación',
    'storage.executable': 'Ejecutable',
    'storage.version': 'Versión',
    'storage.movedRestart':
      'Copiado. Reinicia Termexo para usar la nueva ubicación. No se eliminó nada: la copia anterior sigue en {path} y puedes borrarla cuando confirmes que el traslado funcionó.',
    'storage.restoredRestart':
      'Se restauró el directorio predeterminado. Reinicia Termexo para usarlo. La copia que moviste sigue donde la dejaste.',
    'storage.desktopOnly':
      'El directorio de datos pertenece a la aplicación de escritorio, así que la vista previa del navegador no tiene ninguno que mostrar.',
  },
  fr: {
    'storage.title': 'Stockage',
    'storage.subtitle':
      'L’emplacement où Termexo conserve sa base de données, les événements des Agents et les fichiers d’exécution.',
    'storage.dataDirectory': 'Dossier de données',
    'storage.relocatedFrom': 'Déplacé ici ; l’emplacement par défaut est {path}',
    'storage.copyPath': 'Copier le chemin',
    'storage.copied': 'Copié',
    'storage.copyFailed':
      'Le presse-papiers n’est pas disponible ici. Sélectionnez le chemin et copiez-le manuellement.',
    'storage.openFolder': 'Ouvrir le dossier',
    'storage.moveHint':
      'Changer le dossier de données copie les données actuelles dans le dossier choisi. Redémarrez Termexo pour l’utiliser.',
    'storage.changeLocation': 'Changer le dossier de données',
    'storage.useDefault': 'Rétablir l’emplacement par défaut',
    'storage.moving': 'Copie en cours…',
    'storage.pickDirectory': 'Choisir un nouveau dossier de données',
    'storage.usage': 'Espace utilisé',
    'storage.notCreated': 'pas encore créé',
    'storage.total': 'Total',
    'storage.application': 'Application',
    'storage.executable': 'Exécutable',
    'storage.version': 'Version',
    'storage.movedRestart':
      'Copie terminée. Redémarrez Termexo pour utiliser le nouvel emplacement. Rien n’a été supprimé : l’ancienne copie se trouve toujours dans {path}, vous pourrez la supprimer une fois le déplacement vérifié.',
    'storage.restoredRestart':
      'Dossier par défaut rétabli. Redémarrez Termexo pour l’utiliser. La copie déplacée reste à l’endroit où vous l’avez mise.',
    'storage.desktopOnly':
      'Le dossier de données appartient à l’application de bureau : l’aperçu dans le navigateur n’en a aucun à afficher.',
  },
  de: {
    'storage.title': 'Speicher',
    'storage.subtitle':
      'Hier speichert Termexo seine Datenbank, Agent-Ereignisse und Laufzeitdateien.',
    'storage.dataDirectory': 'Datenverzeichnis',
    'storage.relocatedFrom': 'Hierher verschoben; der Standard ist {path}',
    'storage.copyPath': 'Pfad kopieren',
    'storage.copied': 'Kopiert',
    'storage.copyFailed':
      'Die Zwischenablage ist hier nicht verfügbar. Markiere den Pfad und kopiere ihn manuell.',
    'storage.openFolder': 'Ordner öffnen',
    'storage.moveHint':
      'Beim Ändern des Datenverzeichnisses werden die aktuellen Daten in den gewählten Ordner kopiert. Starte Termexo neu, um ihn zu verwenden.',
    'storage.changeLocation': 'Datenverzeichnis ändern',
    'storage.useDefault': 'Standardort wiederherstellen',
    'storage.moving': 'Wird kopiert…',
    'storage.pickDirectory': 'Neues Datenverzeichnis auswählen',
    'storage.usage': 'Speicherbelegung',
    'storage.notCreated': 'noch nicht angelegt',
    'storage.total': 'Gesamt',
    'storage.application': 'Anwendung',
    'storage.executable': 'Programmdatei',
    'storage.version': 'Version',
    'storage.movedRestart':
      'Kopiert. Starte Termexo neu, um den neuen Ort zu verwenden. Es wurde nichts gelöscht – die bisherige Kopie liegt weiterhin in {path} und kann entfernt werden, sobald der Umzug geprüft ist.',
    'storage.restoredRestart':
      'Das Standardverzeichnis ist wiederhergestellt. Starte Termexo neu, um es zu verwenden. Die verschobene Kopie bleibt, wo du sie abgelegt hast.',
    'storage.desktopOnly':
      'Das Datenverzeichnis gehört zur Desktop-App, daher kann die Browser-Vorschau keines anzeigen.',
  },
  ja: {
    'storage.title': 'ストレージ',
    'storage.subtitle':
      'Termexo のデータベース、Agent のイベント、実行時ファイルはここに保存されます。',
    'storage.dataDirectory': 'データディレクトリ',
    'storage.relocatedFrom': 'ここへ移動済み。既定の場所は {path} です',
    'storage.copyPath': 'パスをコピー',
    'storage.copied': 'コピーしました',
    'storage.copyFailed':
      'この環境ではクリップボードを使用できません。パスを選択して手動でコピーしてください。',
    'storage.openFolder': 'フォルダーを開く',
    'storage.moveHint':
      'データディレクトリを変更すると、現在のデータが選択したフォルダーにコピーされます。Termexo を再起動すると反映されます。',
    'storage.changeLocation': 'データディレクトリを変更',
    'storage.useDefault': '既定の場所に戻す',
    'storage.moving': 'コピー中…',
    'storage.pickDirectory': '新しいデータディレクトリを選択',
    'storage.usage': '使用量の内訳',
    'storage.notCreated': '未作成',
    'storage.total': '合計',
    'storage.application': 'アプリケーション',
    'storage.executable': '実行ファイル',
    'storage.version': 'バージョン',
    'storage.movedRestart':
      'コピーが完了しました。Termexo を再起動すると新しい場所が使用されます。元のデータは削除されておらず {path} に残っているため、移動を確認したあとで削除できます。',
    'storage.restoredRestart':
      '既定のディレクトリに戻しました。Termexo を再起動すると反映されます。移動したコピーは元の場所に残っています。',
    'storage.desktopOnly':
      'データディレクトリはデスクトップアプリのものなので、ブラウザーのプレビューでは表示できません。',
  },
  ko: {
    'storage.title': '저장소',
    'storage.subtitle': 'Termexo의 데이터베이스, Agent 이벤트, 실행 파일이 여기에 저장됩니다.',
    'storage.dataDirectory': '데이터 디렉터리',
    'storage.relocatedFrom': '이곳으로 이동됨. 기본 위치는 {path}입니다',
    'storage.copyPath': '경로 복사',
    'storage.copied': '복사됨',
    'storage.copyFailed':
      '이 환경에서는 클립보드를 사용할 수 없습니다. 경로를 선택해 직접 복사하세요.',
    'storage.openFolder': '폴더 열기',
    'storage.moveHint':
      '데이터 디렉터리를 변경하면 현재 데이터가 선택한 폴더로 복사됩니다. Termexo를 다시 시작하면 적용됩니다.',
    'storage.changeLocation': '데이터 디렉터리 변경',
    'storage.useDefault': '기본 위치로 복원',
    'storage.moving': '복사 중…',
    'storage.pickDirectory': '새 데이터 디렉터리 선택',
    'storage.usage': '사용량 내역',
    'storage.notCreated': '아직 생성되지 않음',
    'storage.total': '합계',
    'storage.application': '애플리케이션',
    'storage.executable': '실행 파일',
    'storage.version': '버전',
    'storage.movedRestart':
      '복사가 완료되었습니다. Termexo를 다시 시작하면 새 위치를 사용합니다. 기존 데이터는 삭제되지 않고 {path}에 남아 있으니, 이동이 잘 되었는지 확인한 뒤 삭제하세요.',
    'storage.restoredRestart':
      '기본 디렉터리로 복원했습니다. Termexo를 다시 시작하면 적용됩니다. 이동했던 사본은 옮겨 둔 위치에 그대로 있습니다.',
    'storage.desktopOnly':
      '데이터 디렉터리는 데스크톱 앱에 속하므로 브라우저 미리보기에서는 표시할 수 없습니다.',
  },
};

/** Makes the wording above available; the storage panel calls it at module scope. */
export function registerStorageTranslations(): void {
  registerTranslations(STORAGE_TRANSLATIONS);
}
