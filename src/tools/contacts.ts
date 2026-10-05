import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient, inspectDatabaseSchema } from '../supabase.js';

export function registerContactTools(server: McpServer) {
  server.tool(
    'get_contacts',
    'READ-ONLY: Search and retrieve WhatsApp contacts for a client (e.g. "Bluefit curitiba", "DGO EPIs", "Despertar", "VM Turismo", "Dr Raphael"). Searches by Name, Phone, or chat_id.',
    {
      client: z
        .string()
        .optional()
        .describe('Name of the company/client (e.g. "Bluefit curitiba", "Despertar", "VM Turismo", "DGO EPIs", "Oticas Design")'),
      table: z
        .string()
        .optional()
        .describe('Explicit WhatsApp contact table, e.g. "[Bluefit curitiba] Contatos - Wpp" or "[C. Despertar] Contatos - Wpp"'),
      query: z
        .string()
        .optional()
        .describe('Search term to match against contact Name (Nome), Phone (Telefone), or chat_id'),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe('Max contacts to return (default: 20, max: 100)'),
      offset: z
        .number()
        .optional()
        .default(0)
        .describe('Pagination offset (default: 0)'),
    },
    async ({ client, table, query, limit, offset }) => {
      try {
        const { tables, schema } = await inspectDatabaseSchema();
        let targetTable = table;

        if (!targetTable) {
          const contactTables = tables.filter(
            (t) => schema[t]?.classification === 'contacts'
          );

          if (client) {
            const clientNorm = client.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Prioritize tables with "Contatos - Wpp"
            targetTable = contactTables.find((t) => {
              const tNorm = t.toLowerCase().replace(/[^a-z0-9]/g, '');
              return tNorm.includes(clientNorm) && t.includes('Wpp');
            });
            if (!targetTable) {
              targetTable = contactTables.find((t) => {
                const tNorm = t.toLowerCase().replace(/[^a-z0-9]/g, '');
                return tNorm.includes(clientNorm);
              });
            }
          } else {
            // Default to Bluefit curitiba or first contact table
            targetTable =
              contactTables.find((t) => t.includes('Bluefit') && t.includes('Wpp')) ||
              contactTables[0];
          }
        }

        if (!targetTable) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `No contact table found for client "${client || 'unknown'}".`,
              },
            ],
          };
        }

        const supabase = getSupabaseClient();
        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const safeOffset = Math.max(offset, 0);

        let queryBuilder = supabase.from(targetTable).select('*', { count: 'exact' });

        if (query && query.trim()) {
          const q = query.trim();
          const tableMeta = schema[targetTable];
          const availableCols = tableMeta ? tableMeta.columns.map((c) => c.name) : [];

          const candidateCols = [
            'Nome',
            'nome',
            'Telefone',
            'telefone',
            'chat_id',
            'email',
            'name',
            'phone',
          ];
          const matchedCols = candidateCols.filter((col) =>
            availableCols.includes(col)
          );

          if (matchedCols.length > 0) {
            const orConditions = matchedCols
              .map((col) => `${col}.ilike.%${q}%`)
              .join(',');
            queryBuilder = queryBuilder.or(orConditions);
          }
        }

        const tableMeta = schema[targetTable];
        const cols = tableMeta ? tableMeta.columns.map((c) => c.name) : [];
        if (cols.includes('created_at')) {
          queryBuilder = queryBuilder.order('created_at', { ascending: false });
        } else if (cols.includes('timestamp')) {
          queryBuilder = queryBuilder.order('timestamp', { ascending: false });
        } else if (cols.includes('id')) {
          queryBuilder = queryBuilder.order('id', { ascending: false });
        }

        queryBuilder = queryBuilder.range(safeOffset, safeOffset + safeLimit - 1);

        const { data, count, error } = await queryBuilder;

        if (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error fetching contacts from "${targetTable}": ${error.message}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  resolved_table: targetTable,
                  count: data?.length || 0,
                  total_matching: count,
                  offset: safeOffset,
                  limit: safeLimit,
                  contacts: data,
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
              text: `Error fetching contacts: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );
}
