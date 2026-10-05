import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../server.js';

export async function startStdioServer() {
  const transport = new StdioServerTransport();
  const server = createMcpServer();

  // Use console.error for logs so stdout remains clean for JSON-RPC messages
  console.error('[Supabase MCP] Starting server in STDIO mode...');
  await server.connect(transport);
  console.error('[Supabase MCP] STDIO transport connected and ready.');
}
