import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { inspectDatabaseSchema } from '../supabase.js';

export function registerSchemaTools(server: McpServer) {
  server.tool(
    'list_clients_and_tables',
    'List all clients/companies detected in the database with their respective Agent Memory tables, WhatsApp Contact tables, and Vector Store (Knowledge Base) tables. Excludes deprecated message_buffer.',
    {},
    async () => {
      try {
        const { tables, schema } = await inspectDatabaseSchema();

        const clientMap: Record<
          string,
          {
            agent_memory_table?: string;
            whatsapp_contacts_table?: string;
            knowledge_base_vector_store?: string;
            other_tables: string[];
          }
        > = {};

        // Helper to normalize client names
        const getOrCreateClient = (rawName: string) => {
          const clean = rawName
            .replace(/[\[\]]/g, '')
            .replace(/[_-]/g, ' ')
            .trim();
          // Normalize key
          const key = Object.keys(clientMap).find(
            (k) => k.toLowerCase() === clean.toLowerCase()
          ) || clean;

          if (!clientMap[key]) {
            clientMap[key] = { other_tables: [] };
          }
          return key;
        };

        for (const tbl of tables) {
          const meta = schema[tbl];
          const classification = meta?.classification || 'other';

          // 1. Bracket style: "[Bluefit curitiba] Contatos - Wpp"
          const bracketMatch = tbl.match(/^\[(.*?)\]\s*(.*)$/);
          if (bracketMatch) {
            const clientKey = getOrCreateClient(bracketMatch[1]);
            const rest = bracketMatch[2].toLowerCase();

            if (classification === 'contacts') {
              clientMap[clientKey].whatsapp_contacts_table = tbl;
            } else if (classification === 'memory') {
              clientMap[clientKey].agent_memory_table = tbl;
            } else if (classification === 'vector_store') {
              clientMap[clientKey].knowledge_base_vector_store = tbl;
            } else {
              clientMap[clientKey].other_tables.push(tbl);
            }
            continue;
          }

          // 2. Underscore style: "dgo_epis_chat_histories" or "dgo_epis_vector_store"
          const suffixMatch = tbl.match(
            /^([a-z0-9_]+)_(chat_histories|chat_history|chat_memories|vector_store|banco_vetorial)$/i
          );
          if (suffixMatch) {
            const clientKey = getOrCreateClient(suffixMatch[1]);
            if (classification === 'memory') {
              clientMap[clientKey].agent_memory_table = tbl;
            } else if (classification === 'vector_store') {
              clientMap[clientKey].knowledge_base_vector_store = tbl;
            }
            continue;
          }

          // Other single tables
          const clientKey = getOrCreateClient(tbl);
          clientMap[clientKey].other_tables.push(tbl);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  active_tables_count: tables.length,
                  total_clients_detected: Object.keys(clientMap).length,
                  clients: clientMap,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error listing clients and tables: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'list_tables',
    'List active table names with optional filtering by type (memory, contacts, vector_store, or all)',
    {
      type_filter: z
        .enum(['all', 'memory', 'contacts', 'vector_store'])
        .optional()
        .default('all')
        .describe('Filter by classification: "memory" (agent memories), "contacts" (WhatsApp contacts), "vector_store" (knowledge base), or "all"'),
      name_search: z
        .string()
        .optional()
        .describe('Search substring in table name (e.g. "bluefit", "dgo", "concursalas")'),
    },
    async ({ type_filter, name_search }) => {
      try {
        const { tables, schema } = await inspectDatabaseSchema();
        let filtered = tables;

        if (type_filter && type_filter !== 'all') {
          filtered = filtered.filter((t) => schema[t]?.classification === type_filter);
        }

        if (name_search && name_search.trim()) {
          const s = name_search.toLowerCase().trim();
          filtered = filtered.filter((t) => t.toLowerCase().includes(s));
        }

        const result = filtered.map((t) => ({
          table: t,
          type: schema[t]?.classification,
          columns_count: schema[t]?.columns?.length || 0,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: result.length,
                  tables: result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error listing tables: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'describe_table',
    'Get detailed column list, types, and sample data for any table',
    {
      table: z.string().describe('Exact table name to describe'),
    },
    async ({ table }) => {
      try {
        const { schema } = await inspectDatabaseSchema();
        if (schema[table]) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(schema[table], null, 2),
              },
            ],
          };
        }

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Table "${table}" not found in database.`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error describing table: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );
}
