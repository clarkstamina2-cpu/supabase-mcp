import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSchemaTools } from './tools/schema.js';
import { registerGenericTools } from './tools/generic.js';
import { registerContactTools } from './tools/contacts.js';
import { registerConversationTools } from './tools/conversations.js';

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'supabase-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  registerSchemaTools(server);
  registerGenericTools(server);
  registerContactTools(server);
  registerConversationTools(server);

  return server;
}
