import { serve } from './mcp.js';

serve().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
