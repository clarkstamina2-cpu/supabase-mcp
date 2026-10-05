import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config.js';

let clientInstance: SupabaseClient | null = null;
let cachedSchema: Record<string, any> | null = null;
let cachedTables: string[] | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (clientInstance) {
    return clientInstance;
  }

  const { supabaseUrl, supabaseKey } = getConfig();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be provided in environment variables.'
    );
  }

  clientInstance = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return clientInstance;
}

export type TableClassification = 'memory' | 'contacts' | 'vector_store' | 'other';

export interface TableColumnInfo {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

export interface TableMetadata {
  name: string;
  classification: TableClassification;
  description?: string;
  columns: TableColumnInfo[];
}

export function classifyTable(tableName: string): TableClassification {
  const lower = tableName.toLowerCase();
  if (
    lower.endsWith('_chat_history') ||
    lower.endsWith('_chat_histories') ||
    lower.endsWith('_chat_memories')
  ) {
    return 'memory';
  }
  if (lower.includes('contato') || lower.includes('contact')) {
    return 'contacts';
  }
  if (lower.endsWith('_vector_store') || lower.endsWith('_banco_vetorial')) {
    return 'vector_store';
  }
  return 'other';
}

/**
 * Inspects database schema by fetching the OpenAPI root from Supabase PostgREST.
 * Excludes deprecated tables like 'message_buffer'.
 */
export async function inspectDatabaseSchema(): Promise<{
  tables: string[];
  schema: Record<string, TableMetadata>;
}> {
  if (cachedTables && cachedSchema) {
    return { tables: cachedTables, schema: cachedSchema };
  }

  const { supabaseUrl, supabaseKey } = getConfig();
  if (!supabaseUrl || !supabaseKey) {
    return { tables: [], schema: {} };
  }

  try {
    const cleanUrl = supabaseUrl.replace(/\/+$/, '');
    const openApiUrl = `${cleanUrl}/rest/v1/?apikey=${supabaseKey}`;

    const res = await fetch(openApiUrl, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/openapi+json, application/json',
      },
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const tables: string[] = [];
      const schema: Record<string, TableMetadata> = {};

      const definitions = data.definitions || {};
      for (const [name, def] of Object.entries<any>(definitions)) {
        // REGRA 1: Ignorar completamente tabelas que contenham message_buffer
        if (name.toLowerCase().includes('message_buffer')) {
          continue;
        }

        tables.push(name);
        const properties = def.properties || {};
        const required = new Set<string>(def.required || []);

        const columns: TableColumnInfo[] = Object.entries<any>(properties).map(
          ([colName, colDef]) => ({
            name: colName,
            type: colDef.format || colDef.type || 'unknown',
            description: colDef.description,
            required: required.has(colName),
          })
        );

        schema[name] = {
          name,
          classification: classifyTable(name),
          description: def.description,
          columns,
        };
      }

      cachedTables = tables;
      cachedSchema = schema;
      return { tables, schema };
    }
  } catch (err) {
    console.warn('Could not inspect PostgREST OpenAPI schema directly:', err);
  }

  return { tables: [], schema: {} };
}
