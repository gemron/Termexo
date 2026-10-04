import { Injectable } from '@angular/core';

import type { McpServerSettings, McpServerStatus } from '../models/mcp-server.models';
import { invoke } from './backend-bridge';

@Injectable({ providedIn: 'root' })
export class McpServerService {
  getStatus(): Promise<McpServerStatus> {
    return invoke('get_mcp_server_status');
  }

  updateSettings(settings: McpServerSettings): Promise<McpServerStatus> {
    return invoke('update_mcp_server_settings', { settings });
  }

  regenerateToken(): Promise<McpServerStatus> {
    return invoke('regenerate_mcp_server_token');
  }
}
