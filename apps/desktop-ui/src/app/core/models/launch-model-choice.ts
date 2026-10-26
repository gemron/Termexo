/** A persisted terminal marker: use the CLI account, never a saved provider's credentials. */
export const CLI_NATIVE_PROFILE_ID = '__termexo_cli_native__';
export const OFFICIAL_MODEL_PREFIX = 'official:';

export function officialModelId(choice: string): string | undefined {
  return choice.startsWith(OFFICIAL_MODEL_PREFIX) ? choice.slice(OFFICIAL_MODEL_PREFIX.length) : undefined;
}

export function launchProfileId(choice: string): string | undefined {
  return officialModelId(choice) !== undefined ? CLI_NATIVE_PROFILE_ID : choice || undefined;
}

/** Labels such as “Codex default model” must never be sent as literal model IDs on restore. */
export function explicitCliModel(model: string): string | undefined {
  return /^[a-zA-Z0-9._:/[\]-]+$/.test(model) ? model : undefined;
}
