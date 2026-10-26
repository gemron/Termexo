// Read the CLI's native session export, never a model-authored status or terminal text.
export function readOpenCodeReport(value: unknown, sessionId: string, model?: string): { completed: boolean; interrupted: boolean; failure?: string; takenOver?: boolean; report?: unknown; model?: string } {
  const data = value as any;
  if (!data || data.info?.id !== sessionId || !Array.isArray(data.messages)) throw new Error('OpenCode evidence is missing or belongs to another session.');
  const messages: any[] = data.messages;
  const users = messages.filter(message => message.type === 'user');
  const assistants = messages.filter(message => message.type === 'assistant');
  const last = assistants.at(-1), idle = messages.at(-1);
  const actualModel = last?.model ? `${last.model.providerID}/${last.model.id}` : undefined;
  if (model && actualModel && actualModel !== model) throw new Error(`OpenCode model changed from approved ${model} to ${actualModel}; review the plan before continuing.`);
  const interrupted = data.info.outcome === 'interrupted' || idle?.type === 'idle' && idle.outcome === 'interrupted';
  const failure = !interrupted && (data.info.outcome === 'failed' || last?.error || last?.finish === 'error')
    ? String(last?.error?.message || 'OpenCode reported a failed turn.') : undefined;
  const completed = !interrupted && !failure && users.length === 1 && Boolean(last?.time?.completed) && last.finish === 'stop'
    && idle?.type === 'idle' && idle.outcome === 'succeeded' && data.info.outcome === 'succeeded';
  let report: unknown;
  if (completed) {
    const text = (last.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('').trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
    try { report = JSON.parse(text); } catch { /* Natural-language completion is not delivery evidence. */ }
  }
  return { completed, interrupted, report, model: actualModel, ...(failure ? { failure } : {}), ...(users.length > 1 ? { takenOver: true } : {}) };
}
