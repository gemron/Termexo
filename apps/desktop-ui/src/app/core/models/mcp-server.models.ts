export interface McpServerSettings {
  enabled: boolean;
  autoConnectAgents: boolean;
  port: number;
  terminalAccess: boolean;
  taskAccess: boolean;
  settingsAccess: boolean;
}

export interface McpServerStatus {
  settings: McpServerSettings;
  running: boolean;
  error: string | null;
  url: string;
  token: string;
}

export interface McpToolRequest {
  id: string;
  name: string;
  arguments: Record<string, string | number | boolean>;
  deadline: number;
}

export interface DesktopPreferences {
  language: string;
  terminalFontSize: number;
  terminalFontName: string;
  inspectorOpen: boolean;
  workspaceSidebarOpen: boolean;
}
