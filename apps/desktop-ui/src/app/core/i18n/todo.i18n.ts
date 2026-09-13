import { registerTranslations, type TranslationBundle } from './i18n.service';

/**
 * Wording for running board tasks: dispatch toasts, execution errors and the prompts handed to the
 * agent doing the work.
 *
 * It stays out of the main tables so the initial bundle does not carry it. `App` loads it on
 * startup and awaits it before building a prompt or recording an execution error, so an agent is
 * never sent a raw key. `TodoService` stores some of these keys as a task's `lastError`, which the
 * board translates when it renders.
 */
export const TODO_TRANSLATIONS: TranslationBundle = {
  en: {
    'taskFlow.terminalName': 'Task · {title}',
    'taskFlow.toast.feedbackSent': 'Feedback sent back to {name}',
    'taskFlow.toast.stopped': 'Stopped “{title}”. Resume it or move it back to To do',
    'taskFlow.toast.returnedToBacklog': 'Moved “{title}” back to To do',
    'taskFlow.toast.amendmentSent': 'Additional instructions sent to {name}',
    'taskFlow.toast.linkedTerminalClosed':
      'The linked terminal has been closed. Continue from the task card to restore the session.',
    'taskFlow.toast.terminalClosed': 'Closed {name}',
    'taskFlow.toast.terminalCreatedResuming':
      'Terminal created and resuming its session. “{title}” will be sent once the agent is ready',
    'taskFlow.toast.terminalCreated':
      'Terminal created. The task will be sent to {name} once the agent is ready',
    'taskFlow.toast.taskSent': 'Task sent to {name}',
    'taskFlow.toast.sendFailed': 'Could not send the task: {error}',
    'taskFlow.error.selectedTerminalClosed':
      'The selected terminal has been closed. Edit the task and choose a terminal again.',
    'taskFlow.error.originalTerminalClosed':
      'The original terminal has been closed. Move the task back to To do and run it again.',
    'taskFlow.error.amendmentUndelivered':
      'The linked terminal has been closed, so the additional instructions were not delivered.',
    'taskFlow.error.workingDirectoryMissing':
      'The task has no usable working directory. Choose a directory for it first.',
    'taskFlow.error.modelProfileMissing':
      'The model profile no longer exists. Edit the task and choose a model again.',
    'taskFlow.error.credentialMissing': 'Model profile {name} is missing its credential.',
    'taskFlow.error.workspaceClosed':
      'The task’s workspace has been closed, so its terminal cannot be created.',
    'taskFlow.error.taskMissing':
      'The task no longer exists, so delivery to the terminal was cancelled.',
    'taskFlow.error.terminalOutsideWorkspace':
      'The selected terminal is not in this task’s workspace.',
    'taskFlow.error.terminalUnavailable':
      'The selected terminal is not ready or no longer available. Choose another one.',
    'taskFlow.error.terminalStarting':
      'The selected terminal is still starting. Try again shortly.',
    'taskFlow.error.agentTypeMismatch':
      'The terminal’s agent type does not match the task. Edit the task and choose again.',
    'taskFlow.error.terminalBusy': 'The selected terminal is running another board task.',
    'taskFlow.error.taskReassigned':
      'The task moved to another terminal, so this delivery was cancelled.',
    'taskFlow.error.deliveryUnconfirmed':
      'The task moved to another terminal, so this delivery could not be confirmed.',
    'taskFlow.error.terminalClosedBeforeSend':
      'The target terminal closed before the instructions were sent.',
    'taskFlow.error.terminalEnded': 'The agent terminal has ended. Check its output and try again.',
    'taskFlow.error.agentFailed':
      'The agent reported an error. Check the terminal output, then try again.',
    'taskFlow.error.terminalMissing':
      'The linked terminal no longer exists or has been closed. Retry to restore the original session.',
    'taskFlow.error.promptInterrupted':
      'The task instructions did not reach the terminal. Send them again.',
    'taskFlow.prompt.task': 'Task: {title}',
    'taskFlow.prompt.project': 'Project: {name}',
    'taskFlow.prompt.currentProject': 'Current project',
    'taskFlow.prompt.workingDirectory': 'Working directory: {path}',
    'taskFlow.prompt.description': 'Task description:\n{description}',
    'taskFlow.prompt.acceptanceCriteria': 'Acceptance criteria:\n{criteria}',
    'taskFlow.prompt.updatedDescription': 'Updated task description:\n{description}',
    'taskFlow.prompt.updatedAcceptanceCriteria': 'Updated acceptance criteria:\n{criteria}',
    'taskFlow.prompt.instruction': 'Additional requirements:\n{instruction}',
    'taskFlow.prompt.feedback': 'Reason it did not pass:\n{feedback}',
    'taskFlow.prompt.initialIntro':
      'You are working on a task from the Termexo task board. Implement it directly in the current project.',
    'taskFlow.prompt.initialClosing':
      'Review the existing implementation first, then make the required changes and run verification proportionate to the risk. When you finish, summarize the changes, the verification results and anything that still needs attention.',
    'taskFlow.prompt.resumeIntro':
      'The previous run was stopped manually. Continue this task in the current session context; do not start over.',
    'taskFlow.prompt.resumeClosing':
      'First explain how far the work has got, then finish the remaining work and run verification proportionate to the risk.',
    'taskFlow.prompt.amendmentIntro':
      'The requirements for this task have been updated. Continue in the current session context without discarding the work already done.',
    'taskFlow.prompt.amendmentClosing':
      'First explain how these additional requirements affect the completed work, then make the corresponding changes and run matching verification.',
    'taskFlow.prompt.rejectionIntro':
      'This task did not pass manual review. Keep making changes in the current session context without discarding the work already done.',
    'taskFlow.prompt.rejectionClosing':
      'Find the cause, fix it and rerun the relevant verification, then clearly explain what you changed in response to the review feedback.',
  },
  'zh-CN': {
    'taskFlow.terminalName': '任务 · {title}',
    'taskFlow.toast.feedbackSent': '已把修改意见发回 {name}',
    'taskFlow.toast.stopped': '已中止「{title}」，可继续执行或放回待办',
    'taskFlow.toast.returnedToBacklog': '已把「{title}」放回待办',
    'taskFlow.toast.amendmentSent': '已把补充指令发送到 {name}',
    'taskFlow.toast.linkedTerminalClosed': '关联终端已关闭，可从任务卡片继续执行以恢复会话。',
    'taskFlow.toast.terminalClosed': '已关闭 {name}',
    'taskFlow.toast.terminalCreatedResuming':
      '终端已创建，正在恢复会话，Agent 就绪后自动发送：{title}',
    'taskFlow.toast.terminalCreated': '终端已创建，Agent 就绪后自动发送任务到 {name}',
    'taskFlow.toast.taskSent': '已把任务发送到 {name}',
    'taskFlow.toast.sendFailed': '任务发送失败：{error}',
    'taskFlow.error.selectedTerminalClosed': '选择的已有终端已关闭，请编辑任务后重新选择执行终端。',
    'taskFlow.error.originalTerminalClosed': '原终端已关闭，请放回待办后重新执行。',
    'taskFlow.error.amendmentUndelivered': '关联终端已关闭，补充指令未能送达。',
    'taskFlow.error.workingDirectoryMissing': '任务缺少可用的工作目录，请先在待办中选择目录。',
    'taskFlow.error.modelProfileMissing': '模型配置已不存在，请编辑待办后重新选择模型。',
    'taskFlow.error.credentialMissing': '模型配置 {name} 缺少凭据。',
    'taskFlow.error.workspaceClosed': '任务所属工作空间已关闭，无法创建任务终端。',
    'taskFlow.error.taskMissing': '任务已不存在，已取消终端投递。',
    'taskFlow.error.terminalOutsideWorkspace': '选择的已有终端不在当前任务的工作空间。',
    'taskFlow.error.terminalUnavailable': '选择的已有终端尚未就绪或已不可用，请重新选择。',
    'taskFlow.error.terminalStarting': '选择的已有终端仍在启动，请稍后重试。',
    'taskFlow.error.agentTypeMismatch':
      '已有终端的 Agent 类型与任务配置不一致，请编辑待办后重新选择。',
    'taskFlow.error.terminalBusy': '选择的已有终端正在执行另一项看板任务。',
    'taskFlow.error.taskReassigned': '任务已切换到其他终端，已取消本次发送。',
    'taskFlow.error.deliveryUnconfirmed': '任务已切换到其他终端，无法确认本次发送。',
    'taskFlow.error.terminalClosedBeforeSend': '目标终端在发送指令前已关闭。',
    'taskFlow.error.terminalEnded': 'Agent 终端已结束，请检查终端输出后重试。',
    'taskFlow.error.agentFailed': 'Agent 运行出错，请检查终端输出后重试。',
    'taskFlow.error.terminalMissing': '关联终端不存在或已关闭，可重试以恢复原会话。',
    'taskFlow.error.promptInterrupted': '任务指令未送达终端，请重新发送。',
    'taskFlow.prompt.task': '任务：{title}',
    'taskFlow.prompt.project': '项目：{name}',
    'taskFlow.prompt.currentProject': '当前项目',
    'taskFlow.prompt.workingDirectory': '工作目录：{path}',
    'taskFlow.prompt.description': '任务说明：\n{description}',
    'taskFlow.prompt.acceptanceCriteria': '验收标准：\n{criteria}',
    'taskFlow.prompt.updatedDescription': '更新后的任务说明：\n{description}',
    'taskFlow.prompt.updatedAcceptanceCriteria': '更新后的验收标准：\n{criteria}',
    'taskFlow.prompt.instruction': '补充要求：\n{instruction}',
    'taskFlow.prompt.feedback': '未通过原因：\n{feedback}',
    'taskFlow.prompt.initialIntro':
      '你正在执行 Termexo 任务看板中的一项任务。请直接在当前项目中完成实现。',
    'taskFlow.prompt.initialClosing':
      '请先检查现有实现，再完成所需修改并运行与风险相匹配的验证。完成后请总结改动、验证结果和仍需注意的问题。',
    'taskFlow.prompt.resumeIntro':
      '刚才的执行被手动中止。请在当前会话上下文中继续完成这项任务，不要从头开始。',
    'taskFlow.prompt.resumeClosing':
      '请先说明已经完成到哪一步，再继续剩余工作并运行与风险相匹配的验证。',
    'taskFlow.prompt.amendmentIntro':
      '这项任务的要求有更新。请在当前会话上下文中继续，不要丢弃已经完成的工作。',
    'taskFlow.prompt.amendmentClosing':
      '请先说明这条补充要求对已完成部分的影响，再完成相应修改并运行匹配的验证。',
    'taskFlow.prompt.rejectionIntro':
      '这项任务的人工验收没有通过。请在当前会话上下文中继续修改，不要丢弃已经完成的工作。',
    'taskFlow.prompt.rejectionClosing':
      '请定位原因、完成修复并重新运行相关验证，然后清楚说明这次针对验收意见做了哪些修改。',
  },
  es: {
    'taskFlow.terminalName': 'Tarea · {title}',
    'taskFlow.toast.feedbackSent': 'Comentarios de revisión enviados de vuelta a {name}',
    'taskFlow.toast.stopped': 'Se detuvo “{title}”. Reanúdala o devuélvela a Pendiente',
    'taskFlow.toast.returnedToBacklog': '“{title}” se devolvió a Pendiente',
    'taskFlow.toast.amendmentSent': 'Instrucciones adicionales enviadas a {name}',
    'taskFlow.toast.linkedTerminalClosed':
      'El terminal vinculado se ha cerrado. Continúa desde la tarjeta de la tarea para restaurar la sesión.',
    'taskFlow.toast.terminalClosed': 'Se cerró {name}',
    'taskFlow.toast.terminalCreatedResuming':
      'Terminal creado; reanudando su sesión. “{title}” se enviará cuando el Agent esté listo',
    'taskFlow.toast.terminalCreated':
      'Terminal creado. La tarea se enviará a {name} cuando el Agent esté listo',
    'taskFlow.toast.taskSent': 'Tarea enviada a {name}',
    'taskFlow.toast.sendFailed': 'No se pudo enviar la tarea: {error}',
    'taskFlow.error.selectedTerminalClosed':
      'El terminal seleccionado se ha cerrado. Edita la tarea y vuelve a elegir un terminal.',
    'taskFlow.error.originalTerminalClosed':
      'El terminal original se ha cerrado. Devuelve la tarea a Pendiente y vuelve a ejecutarla.',
    'taskFlow.error.amendmentUndelivered':
      'El terminal vinculado se ha cerrado, por lo que no se entregaron las instrucciones adicionales.',
    'taskFlow.error.workingDirectoryMissing':
      'La tarea no tiene un directorio de trabajo utilizable. Primero elige un directorio para ella.',
    'taskFlow.error.modelProfileMissing':
      'El perfil de modelo ya no existe. Edita la tarea y vuelve a elegir un modelo.',
    'taskFlow.error.credentialMissing': 'Al perfil de modelo {name} le falta su credencial.',
    'taskFlow.error.workspaceClosed':
      'El espacio de trabajo de la tarea se ha cerrado, por lo que no se puede crear su terminal.',
    'taskFlow.error.taskMissing':
      'La tarea ya no existe, por lo que se canceló el envío al terminal.',
    'taskFlow.error.terminalOutsideWorkspace':
      'El terminal seleccionado no pertenece al espacio de trabajo de esta tarea.',
    'taskFlow.error.terminalUnavailable':
      'El terminal seleccionado no está listo o ya no está disponible. Elige otro.',
    'taskFlow.error.terminalStarting':
      'El terminal seleccionado todavía se está iniciando. Inténtalo de nuevo en breve.',
    'taskFlow.error.agentTypeMismatch':
      'El tipo de Agent del terminal no coincide con la tarea. Edita la tarea y vuelve a elegir.',
    'taskFlow.error.terminalBusy':
      'El terminal seleccionado está ejecutando otra tarea del tablero.',
    'taskFlow.error.taskReassigned':
      'La tarea pasó a otro terminal, por lo que se canceló este envío.',
    'taskFlow.error.deliveryUnconfirmed':
      'La tarea pasó a otro terminal, por lo que no se pudo confirmar este envío.',
    'taskFlow.error.terminalClosedBeforeSend':
      'El terminal de destino se cerró antes de enviar las instrucciones.',
    'taskFlow.error.terminalEnded':
      'El terminal del Agent ha finalizado. Revisa su salida e inténtalo de nuevo.',
    'taskFlow.error.agentFailed':
      'El Agent informó de un error. Revisa la salida del terminal e inténtalo de nuevo.',
    'taskFlow.error.terminalMissing':
      'El terminal vinculado ya no existe o se ha cerrado. Reintenta para restaurar la sesión original.',
    'taskFlow.error.promptInterrupted':
      'Las instrucciones de la tarea no llegaron al terminal. Vuelve a enviarlas.',
    'taskFlow.prompt.task': 'Tarea: {title}',
    'taskFlow.prompt.project': 'Proyecto: {name}',
    'taskFlow.prompt.currentProject': 'Proyecto actual',
    'taskFlow.prompt.workingDirectory': 'Directorio de trabajo: {path}',
    'taskFlow.prompt.description': 'Descripción de la tarea:\n{description}',
    'taskFlow.prompt.acceptanceCriteria': 'Criterios de aceptación:\n{criteria}',
    'taskFlow.prompt.updatedDescription': 'Descripción de la tarea actualizada:\n{description}',
    'taskFlow.prompt.updatedAcceptanceCriteria':
      'Criterios de aceptación actualizados:\n{criteria}',
    'taskFlow.prompt.instruction': 'Requisitos adicionales:\n{instruction}',
    'taskFlow.prompt.feedback': 'Motivo por el que no se aprobó:\n{feedback}',
    'taskFlow.prompt.initialIntro':
      'Estás trabajando en una tarea del tablero de tareas de Termexo. Impleméntala directamente en el proyecto actual.',
    'taskFlow.prompt.initialClosing':
      'Primero revisa la implementación existente; después haz los cambios necesarios y ejecuta una verificación proporcional al riesgo. Al terminar, resume los cambios, los resultados de la verificación y todo lo que aún requiera atención.',
    'taskFlow.prompt.resumeIntro':
      'La ejecución anterior se detuvo manualmente. Continúa esta tarea en el contexto de la sesión actual; no empieces desde cero.',
    'taskFlow.prompt.resumeClosing':
      'Primero explica hasta dónde ha avanzado el trabajo; después termina el trabajo pendiente y ejecuta una verificación proporcional al riesgo.',
    'taskFlow.prompt.amendmentIntro':
      'Los requisitos de esta tarea se han actualizado. Continúa en el contexto de la sesión actual sin descartar el trabajo ya realizado.',
    'taskFlow.prompt.amendmentClosing':
      'Primero explica cómo afectan estos requisitos adicionales al trabajo completado; después haz los cambios correspondientes y ejecuta la verificación adecuada.',
    'taskFlow.prompt.rejectionIntro':
      'Esta tarea no superó la revisión humana. Sigue haciendo cambios en el contexto de la sesión actual sin descartar el trabajo ya realizado.',
    'taskFlow.prompt.rejectionClosing':
      'Encuentra la causa, corrígela y vuelve a ejecutar la verificación correspondiente; después explica con claridad qué cambiaste en respuesta a los comentarios de la revisión.',
  },
  fr: {
    'taskFlow.terminalName': 'Tâche · {title}',
    'taskFlow.toast.feedbackSent': 'Retours renvoyés à {name}',
    'taskFlow.toast.stopped': 'Tâche « {title} » arrêtée. Reprenez-la ou remettez-la dans À faire',
    'taskFlow.toast.returnedToBacklog': 'Tâche « {title} » remise dans À faire',
    'taskFlow.toast.amendmentSent': 'Instructions supplémentaires envoyées à {name}',
    'taskFlow.toast.linkedTerminalClosed':
      'Le terminal associé a été fermé. Reprenez depuis la carte de tâche pour restaurer la session.',
    'taskFlow.toast.terminalClosed': '{name} a été fermé',
    'taskFlow.toast.terminalCreatedResuming':
      'Terminal créé, reprise de la session en cours. La tâche « {title} » sera envoyée dès que l’Agent sera prêt',
    'taskFlow.toast.terminalCreated':
      'Terminal créé. La tâche sera envoyée à {name} dès que l’Agent sera prêt',
    'taskFlow.toast.taskSent': 'Tâche envoyée à {name}',
    'taskFlow.toast.sendFailed': 'Impossible d’envoyer la tâche : {error}',
    'taskFlow.error.selectedTerminalClosed':
      'Le terminal sélectionné a été fermé. Modifiez la tâche et choisissez à nouveau un terminal.',
    'taskFlow.error.originalTerminalClosed':
      'Le terminal d’origine a été fermé. Remettez la tâche dans À faire, puis relancez-la.',
    'taskFlow.error.amendmentUndelivered':
      'Le terminal associé a été fermé ; les instructions supplémentaires n’ont pas été transmises.',
    'taskFlow.error.workingDirectoryMissing':
      'La tâche n’a aucun dossier de travail utilisable. Choisissez-en d’abord un.',
    'taskFlow.error.modelProfileMissing':
      'Le profil de modèle n’existe plus. Modifiez la tâche et choisissez à nouveau un modèle.',
    'taskFlow.error.credentialMissing': 'Il manque l’identifiant du profil de modèle {name}.',
    'taskFlow.error.workspaceClosed':
      'L’espace de travail de la tâche a été fermé ; impossible de créer son terminal.',
    'taskFlow.error.taskMissing': 'La tâche n’existe plus ; l’envoi au terminal a été annulé.',
    'taskFlow.error.terminalOutsideWorkspace':
      'Le terminal sélectionné n’appartient pas à l’espace de travail de cette tâche.',
    'taskFlow.error.terminalUnavailable':
      'Le terminal sélectionné n’est pas prêt ou n’est plus disponible. Choisissez-en un autre.',
    'taskFlow.error.terminalStarting':
      'Le terminal sélectionné est encore en cours de démarrage. Réessayez dans un instant.',
    'taskFlow.error.agentTypeMismatch':
      'Le type d’Agent du terminal ne correspond pas à la tâche. Modifiez la tâche et choisissez à nouveau.',
    'taskFlow.error.terminalBusy':
      'Le terminal sélectionné exécute déjà une autre tâche du tableau.',
    'taskFlow.error.taskReassigned':
      'La tâche a été déplacée vers un autre terminal ; cet envoi a été annulé.',
    'taskFlow.error.deliveryUnconfirmed':
      'La tâche a été déplacée vers un autre terminal ; cet envoi n’a pas pu être confirmé.',
    'taskFlow.error.terminalClosedBeforeSend':
      'Le terminal cible a été fermé avant l’envoi des instructions.',
    'taskFlow.error.terminalEnded':
      'Le terminal de l’Agent s’est arrêté. Vérifiez sa sortie, puis réessayez.',
    'taskFlow.error.agentFailed':
      'L’Agent a signalé une erreur. Vérifiez la sortie du terminal, puis réessayez.',
    'taskFlow.error.terminalMissing':
      'Le terminal associé n’existe plus ou a été fermé. Réessayez pour restaurer la session d’origine.',
    'taskFlow.error.promptInterrupted':
      'Les instructions de la tâche n’ont pas atteint le terminal. Renvoyez-les.',
    'taskFlow.prompt.task': 'Tâche : {title}',
    'taskFlow.prompt.project': 'Projet : {name}',
    'taskFlow.prompt.currentProject': 'Projet actuel',
    'taskFlow.prompt.workingDirectory': 'Dossier de travail : {path}',
    'taskFlow.prompt.description': 'Description de la tâche :\n{description}',
    'taskFlow.prompt.acceptanceCriteria': 'Critères d’acceptation :\n{criteria}',
    'taskFlow.prompt.updatedDescription': 'Description de la tâche mise à jour :\n{description}',
    'taskFlow.prompt.updatedAcceptanceCriteria': 'Critères d’acceptation mis à jour :\n{criteria}',
    'taskFlow.prompt.instruction': 'Exigences supplémentaires :\n{instruction}',
    'taskFlow.prompt.feedback': 'Motif du refus de validation :\n{feedback}',
    'taskFlow.prompt.initialIntro':
      'Vous travaillez sur une tâche issue du tableau des tâches Termexo. Implémentez-la directement dans le projet actuel.',
    'taskFlow.prompt.initialClosing':
      'Examinez d’abord l’implémentation existante, puis effectuez les modifications nécessaires et lancez des vérifications proportionnées au risque. Une fois terminé, résumez les modifications, les résultats des vérifications et les points qui nécessitent encore une attention.',
    'taskFlow.prompt.resumeIntro':
      'L’exécution précédente a été arrêtée manuellement. Poursuivez cette tâche dans le contexte de la session actuelle ; ne recommencez pas depuis le début.',
    'taskFlow.prompt.resumeClosing':
      'Indiquez d’abord où en est le travail, puis terminez le travail restant et lancez des vérifications proportionnées au risque.',
    'taskFlow.prompt.amendmentIntro':
      'Les exigences de cette tâche ont été mises à jour. Poursuivez dans le contexte de la session actuelle sans abandonner le travail déjà effectué.',
    'taskFlow.prompt.amendmentClosing':
      'Expliquez d’abord l’impact de ces exigences supplémentaires sur le travail déjà réalisé, puis effectuez les modifications correspondantes et lancez les vérifications adaptées.',
    'taskFlow.prompt.rejectionIntro':
      'Cette tâche n’a pas passé la validation humaine. Poursuivez les modifications dans le contexte de la session actuelle sans abandonner le travail déjà effectué.',
    'taskFlow.prompt.rejectionClosing':
      'Identifiez la cause, corrigez-la et relancez les vérifications concernées, puis expliquez clairement les modifications apportées en réponse aux retours de validation.',
  },
  de: {
    'taskFlow.terminalName': 'Aufgabe · {title}',
    'taskFlow.toast.feedbackSent': 'Feedback an {name} zurückgesendet',
    'taskFlow.toast.stopped': '„{title}“ gestoppt. Fortsetzen oder zurück zu To-do verschieben',
    'taskFlow.toast.returnedToBacklog': '„{title}“ zurück zu To-do verschoben',
    'taskFlow.toast.amendmentSent': 'Zusätzliche Anweisungen an {name} gesendet',
    'taskFlow.toast.linkedTerminalClosed':
      'Das verknüpfte Terminal wurde geschlossen. Setze die Aufgabe über die Aufgabenkarte fort, um die Sitzung wiederherzustellen.',
    'taskFlow.toast.terminalClosed': '{name} geschlossen',
    'taskFlow.toast.terminalCreatedResuming':
      'Terminal erstellt, Sitzung wird fortgesetzt. „{title}“ wird gesendet, sobald der Agent bereit ist',
    'taskFlow.toast.terminalCreated':
      'Terminal erstellt. Die Aufgabe wird an {name} gesendet, sobald der Agent bereit ist',
    'taskFlow.toast.taskSent': 'Aufgabe an {name} gesendet',
    'taskFlow.toast.sendFailed': 'Aufgabe konnte nicht gesendet werden: {error}',
    'taskFlow.error.selectedTerminalClosed':
      'Das ausgewählte Terminal wurde geschlossen. Bearbeite die Aufgabe und wähle erneut ein Terminal.',
    'taskFlow.error.originalTerminalClosed':
      'Das ursprüngliche Terminal wurde geschlossen. Verschiebe die Aufgabe zurück zu To-do und führe sie erneut aus.',
    'taskFlow.error.amendmentUndelivered':
      'Das verknüpfte Terminal wurde geschlossen, daher wurden die zusätzlichen Anweisungen nicht zugestellt.',
    'taskFlow.error.workingDirectoryMissing':
      'Die Aufgabe hat kein nutzbares Arbeitsverzeichnis. Wähle zuerst ein Verzeichnis dafür.',
    'taskFlow.error.modelProfileMissing':
      'Das Modellprofil existiert nicht mehr. Bearbeite die Aufgabe und wähle erneut ein Modell.',
    'taskFlow.error.credentialMissing': 'Für das Modellprofil {name} fehlen die Anmeldedaten.',
    'taskFlow.error.workspaceClosed':
      'Der Arbeitsbereich der Aufgabe wurde geschlossen, daher kann ihr Terminal nicht erstellt werden.',
    'taskFlow.error.taskMissing':
      'Die Aufgabe existiert nicht mehr, daher wurde die Zustellung an das Terminal abgebrochen.',
    'taskFlow.error.terminalOutsideWorkspace':
      'Das ausgewählte Terminal gehört nicht zum Arbeitsbereich dieser Aufgabe.',
    'taskFlow.error.terminalUnavailable':
      'Das ausgewählte Terminal ist nicht bereit oder nicht mehr verfügbar. Wähle ein anderes.',
    'taskFlow.error.terminalStarting':
      'Das ausgewählte Terminal startet noch. Versuche es gleich noch einmal.',
    'taskFlow.error.agentTypeMismatch':
      'Der Agent-Typ des Terminals passt nicht zur Aufgabe. Bearbeite die Aufgabe und wähle erneut.',
    'taskFlow.error.terminalBusy':
      'Im ausgewählten Terminal läuft bereits eine andere Aufgabe vom Board.',
    'taskFlow.error.taskReassigned':
      'Die Aufgabe wurde einem anderen Terminal zugewiesen, daher wurde diese Zustellung abgebrochen.',
    'taskFlow.error.deliveryUnconfirmed':
      'Die Aufgabe wurde einem anderen Terminal zugewiesen, daher konnte diese Zustellung nicht bestätigt werden.',
    'taskFlow.error.terminalClosedBeforeSend':
      'Das Zielterminal wurde geschlossen, bevor die Anweisungen gesendet wurden.',
    'taskFlow.error.terminalEnded':
      'Das Agent-Terminal wurde beendet. Prüfe die Ausgabe und versuche es erneut.',
    'taskFlow.error.agentFailed':
      'Der Agent hat einen Fehler gemeldet. Prüfe die Terminalausgabe und versuche es erneut.',
    'taskFlow.error.terminalMissing':
      'Das verknüpfte Terminal existiert nicht mehr oder wurde geschlossen. Versuche es erneut, um die ursprüngliche Sitzung wiederherzustellen.',
    'taskFlow.error.promptInterrupted':
      'Die Aufgabenanweisungen haben das Terminal nicht erreicht. Sende sie erneut.',
    'taskFlow.prompt.task': 'Aufgabe: {title}',
    'taskFlow.prompt.project': 'Projekt: {name}',
    'taskFlow.prompt.currentProject': 'Aktuelles Projekt',
    'taskFlow.prompt.workingDirectory': 'Arbeitsverzeichnis: {path}',
    'taskFlow.prompt.description': 'Aufgabenbeschreibung:\n{description}',
    'taskFlow.prompt.acceptanceCriteria': 'Abnahmekriterien:\n{criteria}',
    'taskFlow.prompt.updatedDescription': 'Aktualisierte Aufgabenbeschreibung:\n{description}',
    'taskFlow.prompt.updatedAcceptanceCriteria': 'Aktualisierte Abnahmekriterien:\n{criteria}',
    'taskFlow.prompt.instruction': 'Zusätzliche Anforderungen:\n{instruction}',
    'taskFlow.prompt.feedback': 'Grund für das Nichtbestehen der Prüfung:\n{feedback}',
    'taskFlow.prompt.initialIntro':
      'Du bearbeitest eine Aufgabe vom Termexo-Aufgabenboard. Setze sie direkt im aktuellen Projekt um.',
    'taskFlow.prompt.initialClosing':
      'Prüfe zuerst die bestehende Implementierung, nimm dann die erforderlichen Änderungen vor und führe eine dem Risiko angemessene Verifizierung durch. Fasse zum Schluss die Änderungen, die Ergebnisse der Verifizierung und alle noch offenen Punkte zusammen.',
    'taskFlow.prompt.resumeIntro':
      'Der vorherige Lauf wurde manuell gestoppt. Setze diese Aufgabe im Kontext der aktuellen Sitzung fort; fang nicht von vorn an.',
    'taskFlow.prompt.resumeClosing':
      'Erkläre zuerst, wie weit die Arbeit bereits fortgeschritten ist, erledige dann die verbleibende Arbeit und führe eine dem Risiko angemessene Verifizierung durch.',
    'taskFlow.prompt.amendmentIntro':
      'Die Anforderungen an diese Aufgabe wurden aktualisiert. Arbeite im Kontext der aktuellen Sitzung weiter, ohne die bereits erledigte Arbeit zu verwerfen.',
    'taskFlow.prompt.amendmentClosing':
      'Erkläre zuerst, wie sich diese zusätzlichen Anforderungen auf die bereits erledigte Arbeit auswirken, nimm dann die entsprechenden Änderungen vor und führe eine passende Verifizierung durch.',
    'taskFlow.prompt.rejectionIntro':
      'Diese Aufgabe hat die manuelle Prüfung nicht bestanden. Nimm im Kontext der aktuellen Sitzung weitere Änderungen vor, ohne die bereits erledigte Arbeit zu verwerfen.',
    'taskFlow.prompt.rejectionClosing':
      'Finde die Ursache, behebe sie und führe die relevante Verifizierung erneut durch. Erkläre anschließend klar, was du aufgrund des Prüfungsfeedbacks geändert hast.',
  },
  ja: {
    'taskFlow.terminalName': 'タスク · {title}',
    'taskFlow.toast.feedbackSent': '修正依頼を {name} に差し戻しました',
    'taskFlow.toast.stopped': '「{title}」を中止しました。再開するか未着手に戻せます',
    'taskFlow.toast.returnedToBacklog': '「{title}」を未着手に戻しました',
    'taskFlow.toast.amendmentSent': '追加の指示を {name} に送信しました',
    'taskFlow.toast.linkedTerminalClosed':
      '関連ターミナルが閉じられました。タスクカードから続行するとセッションを復元できます。',
    'taskFlow.toast.terminalClosed': '{name} を閉じました',
    'taskFlow.toast.terminalCreatedResuming':
      'ターミナルを作成し、セッションを再開しています。Agent の準備ができ次第「{title}」を送信します',
    'taskFlow.toast.terminalCreated':
      'ターミナルを作成しました。Agent の準備ができ次第、タスクを {name} に送信します',
    'taskFlow.toast.taskSent': 'タスクを {name} に送信しました',
    'taskFlow.toast.sendFailed': 'タスクを送信できませんでした：{error}',
    'taskFlow.error.selectedTerminalClosed':
      '選択したターミナルは閉じられています。タスクを編集してターミナルを選び直してください。',
    'taskFlow.error.originalTerminalClosed':
      '元のターミナルは閉じられています。タスクを未着手に戻して再実行してください。',
    'taskFlow.error.amendmentUndelivered':
      '関連ターミナルが閉じられたため、追加の指示は届きませんでした。',
    'taskFlow.error.workingDirectoryMissing':
      'タスクに使用できる作業ディレクトリがありません。先にディレクトリを選択してください。',
    'taskFlow.error.modelProfileMissing':
      'モデルプロファイルが存在しません。タスクを編集してモデルを選び直してください。',
    'taskFlow.error.credentialMissing': 'モデルプロファイル {name} に認証情報がありません。',
    'taskFlow.error.workspaceClosed':
      'タスクのワークスペースが閉じられているため、ターミナルを作成できません。',
    'taskFlow.error.taskMissing': 'タスクが存在しないため、ターミナルへの送信を取り消しました。',
    'taskFlow.error.terminalOutsideWorkspace':
      '選択したターミナルはこのタスクのワークスペースにありません。',
    'taskFlow.error.terminalUnavailable':
      '選択したターミナルは準備ができていないか、利用できなくなりました。別のターミナルを選択してください。',
    'taskFlow.error.terminalStarting':
      '選択したターミナルはまだ起動中です。しばらくしてから再試行してください。',
    'taskFlow.error.agentTypeMismatch':
      'ターミナルの Agent の種類がタスクと一致しません。タスクを編集して選び直してください。',
    'taskFlow.error.terminalBusy': '選択したターミナルでは、ボードの別のタスクを実行中です。',
    'taskFlow.error.taskReassigned':
      'タスクが別のターミナルに移ったため、今回の送信を取り消しました。',
    'taskFlow.error.deliveryUnconfirmed':
      'タスクが別のターミナルに移ったため、今回の送信を確認できませんでした。',
    'taskFlow.error.terminalClosedBeforeSend':
      '指示を送信する前に、送信先のターミナルが閉じられました。',
    'taskFlow.error.terminalEnded':
      'Agent ターミナルが終了しました。出力を確認してから再試行してください。',
    'taskFlow.error.agentFailed':
      'Agent がエラーを報告しました。ターミナルの出力を確認してから再試行してください。',
    'taskFlow.error.terminalMissing':
      '関連ターミナルが存在しないか、閉じられています。再試行すると元のセッションを復元します。',
    'taskFlow.error.promptInterrupted':
      'タスクの指示がターミナルに届きませんでした。もう一度送信してください。',
    'taskFlow.prompt.task': 'タスク：{title}',
    'taskFlow.prompt.project': 'プロジェクト：{name}',
    'taskFlow.prompt.currentProject': '現在のプロジェクト',
    'taskFlow.prompt.workingDirectory': '作業ディレクトリ：{path}',
    'taskFlow.prompt.description': 'タスクの説明：\n{description}',
    'taskFlow.prompt.acceptanceCriteria': '受け入れ基準：\n{criteria}',
    'taskFlow.prompt.updatedDescription': '更新後のタスクの説明：\n{description}',
    'taskFlow.prompt.updatedAcceptanceCriteria': '更新後の受け入れ基準：\n{criteria}',
    'taskFlow.prompt.instruction': '追加の要件：\n{instruction}',
    'taskFlow.prompt.feedback': '不合格の理由：\n{feedback}',
    'taskFlow.prompt.initialIntro':
      'あなたは Termexo のタスクボードにあるタスクを担当しています。現在のプロジェクト内で直接実装してください。',
    'taskFlow.prompt.initialClosing':
      'まず既存の実装を確認し、必要な変更を加えたうえで、リスクに見合った検証を実行してください。完了したら、変更内容、検証結果、引き続き注意が必要な点をまとめてください。',
    'taskFlow.prompt.resumeIntro':
      '前回の実行は手動で中止されました。最初からやり直さず、現在のセッションのコンテキストでこのタスクを続けてください。',
    'taskFlow.prompt.resumeClosing':
      'まず作業がどこまで進んでいるかを説明し、残りの作業を完了してから、リスクに見合った検証を実行してください。',
    'taskFlow.prompt.amendmentIntro':
      'このタスクの要件が更新されました。完了済みの作業を破棄せず、現在のセッションのコンテキストで続けてください。',
    'taskFlow.prompt.amendmentClosing':
      'まず追加の要件が完了済みの作業にどう影響するかを説明し、対応する変更を加えてから、それに見合った検証を実行してください。',
    'taskFlow.prompt.rejectionIntro':
      'このタスクは人によるレビューで不合格になりました。完了済みの作業を破棄せず、現在のセッションのコンテキストで修正を続けてください。',
    'taskFlow.prompt.rejectionClosing':
      '原因を特定して修正し、関連する検証を再実行したうえで、レビューのフィードバックを受けて何を変更したかを明確に説明してください。',
  },
  ko: {
    'taskFlow.terminalName': '작업 · {title}',
    'taskFlow.toast.feedbackSent': '수정 의견을 {name}에 다시 보냈습니다',
    'taskFlow.toast.stopped': '“{title}”을(를) 중지했습니다. 재개하거나 할 일로 되돌릴 수 있습니다',
    'taskFlow.toast.returnedToBacklog': '“{title}”을(를) 할 일로 되돌렸습니다',
    'taskFlow.toast.amendmentSent': '추가 지시를 {name}에 보냈습니다',
    'taskFlow.toast.linkedTerminalClosed':
      '연결된 터미널이 닫혔습니다. 작업 카드에서 재개하면 세션을 복원할 수 있습니다.',
    'taskFlow.toast.terminalClosed': '{name}을(를) 닫았습니다',
    'taskFlow.toast.terminalCreatedResuming':
      '터미널을 만들고 세션을 복원하는 중입니다. Agent가 준비되면 “{title}”을(를) 보냅니다',
    'taskFlow.toast.terminalCreated':
      '터미널을 만들었습니다. Agent가 준비되면 작업을 {name}에 보냅니다',
    'taskFlow.toast.taskSent': '작업을 {name}에 보냈습니다',
    'taskFlow.toast.sendFailed': '작업을 보내지 못했습니다: {error}',
    'taskFlow.error.selectedTerminalClosed':
      '선택한 터미널이 닫혔습니다. 작업을 편집하여 터미널을 다시 선택하세요.',
    'taskFlow.error.originalTerminalClosed':
      '기존 터미널이 닫혔습니다. 작업을 할 일로 되돌린 후 다시 실행하세요.',
    'taskFlow.error.amendmentUndelivered': '연결된 터미널이 닫혀 추가 지시를 전달하지 못했습니다.',
    'taskFlow.error.workingDirectoryMissing':
      '작업에 사용할 수 있는 작업 디렉터리가 없습니다. 먼저 디렉터리를 선택하세요.',
    'taskFlow.error.modelProfileMissing':
      '모델 프로필이 더 이상 존재하지 않습니다. 작업을 편집하여 모델을 다시 선택하세요.',
    'taskFlow.error.credentialMissing': '모델 프로필 {name}에 자격 증명이 없습니다.',
    'taskFlow.error.workspaceClosed': '작업이 속한 작업 공간이 닫혀 터미널을 만들 수 없습니다.',
    'taskFlow.error.taskMissing': '작업이 더 이상 존재하지 않아 터미널 전송을 취소했습니다.',
    'taskFlow.error.terminalOutsideWorkspace': '선택한 터미널이 이 작업의 작업 공간에 없습니다.',
    'taskFlow.error.terminalUnavailable':
      '선택한 터미널이 준비되지 않았거나 더 이상 사용할 수 없습니다. 다른 터미널을 선택하세요.',
    'taskFlow.error.terminalStarting':
      '선택한 터미널이 아직 시작 중입니다. 잠시 후 다시 시도하세요.',
    'taskFlow.error.agentTypeMismatch':
      '터미널의 Agent 유형이 작업과 일치하지 않습니다. 작업을 편집하여 다시 선택하세요.',
    'taskFlow.error.terminalBusy': '선택한 터미널에서 다른 보드 작업이 실행 중입니다.',
    'taskFlow.error.taskReassigned': '작업이 다른 터미널로 옮겨져 이번 전송을 취소했습니다.',
    'taskFlow.error.deliveryUnconfirmed':
      '작업이 다른 터미널로 옮겨져 이번 전송을 확인할 수 없습니다.',
    'taskFlow.error.terminalClosedBeforeSend': '지시를 보내기 전에 대상 터미널이 닫혔습니다.',
    'taskFlow.error.terminalEnded':
      'Agent 터미널이 종료되었습니다. 터미널 출력을 확인한 후 다시 시도하세요.',
    'taskFlow.error.agentFailed':
      'Agent가 오류를 보고했습니다. 터미널 출력을 확인한 후 다시 시도하세요.',
    'taskFlow.error.terminalMissing':
      '연결된 터미널이 없거나 닫혔습니다. 다시 시도하면 기존 세션을 복원합니다.',
    'taskFlow.error.promptInterrupted': '작업 지시가 터미널에 전달되지 않았습니다. 다시 보내세요.',
    'taskFlow.prompt.task': '작업: {title}',
    'taskFlow.prompt.project': '프로젝트: {name}',
    'taskFlow.prompt.currentProject': '현재 프로젝트',
    'taskFlow.prompt.workingDirectory': '작업 디렉터리: {path}',
    'taskFlow.prompt.description': '작업 설명:\n{description}',
    'taskFlow.prompt.acceptanceCriteria': '검수 기준:\n{criteria}',
    'taskFlow.prompt.updatedDescription': '업데이트된 작업 설명:\n{description}',
    'taskFlow.prompt.updatedAcceptanceCriteria': '업데이트된 검수 기준:\n{criteria}',
    'taskFlow.prompt.instruction': '추가 요구 사항:\n{instruction}',
    'taskFlow.prompt.feedback': '검수를 통과하지 못한 이유:\n{feedback}',
    'taskFlow.prompt.initialIntro':
      '당신은 Termexo 작업 보드의 작업을 수행하고 있습니다. 현재 프로젝트에서 직접 구현하세요.',
    'taskFlow.prompt.initialClosing':
      '먼저 기존 구현을 검토한 다음, 필요한 변경을 수행하고 위험도에 맞는 검증을 실행하세요. 완료하면 변경 사항, 검증 결과, 아직 주의가 필요한 사항을 요약하세요.',
    'taskFlow.prompt.resumeIntro':
      '이전 실행이 수동으로 중지되었습니다. 현재 세션 컨텍스트에서 이 작업을 이어서 진행하고, 처음부터 다시 시작하지 마세요.',
    'taskFlow.prompt.resumeClosing':
      '먼저 어디까지 진행되었는지 설명한 다음, 남은 부분을 마치고 위험도에 맞는 검증을 실행하세요.',
    'taskFlow.prompt.amendmentIntro':
      '이 작업의 요구 사항이 업데이트되었습니다. 이미 완료한 내용을 버리지 말고 현재 세션 컨텍스트에서 이어서 진행하세요.',
    'taskFlow.prompt.amendmentClosing':
      '먼저 이 추가 요구 사항이 이미 완료한 내용에 어떤 영향을 주는지 설명한 다음, 그에 맞게 변경하고 해당하는 검증을 실행하세요.',
    'taskFlow.prompt.rejectionIntro':
      '이 작업은 사람의 검수를 통과하지 못했습니다. 이미 완료한 내용을 버리지 말고 현재 세션 컨텍스트에서 계속 수정하세요.',
    'taskFlow.prompt.rejectionClosing':
      '원인을 찾아 수정하고 관련 검증을 다시 실행한 다음, 검수 피드백에 따라 무엇을 변경했는지 명확하게 설명하세요.',
  },
};

/** Makes the wording above available; `App` imports this module on demand. */
export function registerTodoTranslations(): void {
  registerTranslations(TODO_TRANSLATIONS);
}
