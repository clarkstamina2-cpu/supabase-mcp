import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient } from '../supabase.js';

const FilterSchema = z.object({
  column: z.string().describe('Column name to filter on'),
  operator: z
    .enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in'])
    .describe('Filter operator: eq, neq, gt, gte, lt, lte, like, ilike, is, in'),
  value: z.any().describe('Value to filter by. For "in", provide an array. For "is", provide null/true/false.'),
});

export function registerGenericTools(server: McpServer) {
  server.tool(
    'query_table',
    'READ-ONLY: Execute a consultative query on any table in the Supabase database with column selection, filtering, ordering, and pagination',
    {
      table: z.string().describe('Name of the table to query, e.g. "[C. Despertar] Contatos - Wpp" or "dgo_epis_chat_histories"'),
      select: z.string().optional().default('*').describe('Columns to select, e.g. "*" or specific columns "id, Nome, Telefone"'),
      filters: z.array(FilterSchema).optional().describe('List of filter conditions to apply'),
      order_by: z.string().optional().describe('Column to order results by (e.g. "created_at" or "timestamp")'),
      ascending: z.boolean().optional().default(false).describe('Sort direction: true for ascending, false for descending (default: false)'),
      limit: z.number().optional().default(20).describe('Maximum number of rows to return (default: 20, max: 200)'),
      offset: z.number().optional().default(0).describe('Number of rows to skip for pagination (default: 0)'),
    },
    async ({ table, select, filters, order_by, ascending, limit, offset }) => {
      try {
        const supabase = getSupabaseClient();
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        const safeOffset = Math.max(offset, 0);

        let query = supabase
          .from(table)
          .select(select || '*', { count: 'exact' });

        if (filters && Array.isArray(filters)) {
          for (const f of filters) {
            switch (f.operator) {
              case 'eq':
                query = query.eq(f.column, f.value);
                break;
              case 'neq':
                query = query.neq(f.column, f.value);
                break;
              case 'gt':
                query = query.gt(f.column, f.value);
                break;
              case 'gte':
                query = query.gte(f.column, f.value);
                break;
              case 'lt':
                query = query.lt(f.column, f.value);
                break;
              case 'lte':
                query = query.lte(f.column, f.value);
                break;
              case 'like':
                query = query.like(f.column, String(f.value));
                break;
              case 'ilike':
                query = query.ilike(f.column, String(f.value));
                break;
              case 'is':
                query = query.is(f.column, f.value);
                break;
              case 'in':
                query = query.in(f.column, Array.isArray(f.value) ? f.value : [f.value]);
                break;
            }
          }
        }

        if (order_by) {
          query = query.order(order_by, { ascending: ascending ?? false });
        }

        query = query.range(safeOffset, safeOffset + safeLimit - 1);

        const { data, count, error } = await query;

        if (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Query error on table "${table}": ${error.message} (Code: ${error.code})`,
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
                  table,
                  returned_count: data?.length || 0,
                  total_matching_count: count,
                  offset: safeOffset,
                  limit: safeLimit,
                  data,
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
              text: `Unexpected query error: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'count_records',
    'READ-ONLY: Get the total number of records in a table matching optional filter criteria',
    {
      table: z.string().describe('Name of the table to count'),
      filters: z.array(FilterSchema).optional().describe('Optional list of filter conditions'),
    },
    async ({ table, filters }) => {
      try {
        const supabase = getSupabaseClient();
        let query = supabase.from(table).select('*', { count: 'exact', head: true });

        if (filters && Array.isArray(filters)) {
          for (const f of filters) {
            switch (f.operator) {
              case 'eq':
                query = query.eq(f.column, f.value);
                break;
              case 'neq':
                query = query.neq(f.column, f.value);
                break;
              case 'gt':
                query = query.gt(f.column, f.value);
                break;
              case 'gte':
                query = query.gte(f.column, f.value);
                break;
              case 'lt':
                query = query.lt(f.column, f.value);
                break;
              case 'lte':
                query = query.lte(f.column, f.value);
                break;
              case 'like':
                query = query.like(f.column, String(f.value));
                break;
              case 'ilike':
                query = query.ilike(f.column, String(f.value));
                break;
              case 'is':
                query = query.is(f.column, f.value);
                break;
              case 'in':
                query = query.in(f.column, Array.isArray(f.value) ? f.value : [f.value]);
                break;
            }
          }
        }

        const { count, error } = await query;

        if (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error counting records in table "${table}": ${error.message}`,
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
                  table,
                  total_count: count ?? 0,
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
              text: `Error counting records: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );
}
