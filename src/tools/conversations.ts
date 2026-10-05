import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseClient, inspectDatabaseSchema } from '../supabase.js';

export interface CleanMessage {
  id: number;
  timestamp: string;
  category: 'user_message' | 'agent_message' | 'followup' | 'tool_call' | 'internal_system';
  speaker: 'cliente' | 'agente_principal' | 'followup' | 'tool' | 'sistema';
  content: string;
  tool_details?: {
    tool_name?: string;
    tool_call_id?: string;
  };
}

function parseAndClassifyMessage(row: any, prevRow: any | null): CleanMessage {
  const msg = row.message || {};
  const rawType = msg.type || 'unknown';
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
  const timestamp = row.timestamp || `ID_${row.id}`;

  // 1. Tool Calls / Results
  if (
    rawType === 'tool' ||
    (msg.tool_calls && msg.tool_calls.length > 0) ||
    content.startsWith('Calling ') ||
    msg.name === 'Think' ||
    msg.name?.startsWith('Think')
  ) {
    return {
      id: row.id,
      timestamp,
      category: 'tool_call',
      speaker: 'tool',
      content: content,
      tool_details: {
        tool_name: msg.name || msg.tool_calls?.[0]?.name,
        tool_call_id: msg.tool_call_id || msg.tool_calls?.[0]?.id,
      },
    };
  }

  // 2. Internal System Prompts / Summary triggers
  if (
    rawType === 'human' &&
    (content.includes('Analise a conversa através da sua memória') ||
      content.includes('gere um resumo padronizado') ||
      content.startsWith('System:') ||
      content.startsWith('Instruction:'))
  ) {
    return {
      id: row.id,
      timestamp,
      category: 'internal_system',
      speaker: 'sistema',
      content: content,
    };
  }

  // 3. User / Client Message (WhatsApp Lead)
  if (rawType === 'human') {
    let cleanContent = content;
    // Strip WhatsApp lead metadata prefixes like "Nome do lead: ... \nMensagem: ..."
    const leadMatch = content.match(/^Nome do lead:\s*(.*?)\s*\nMensagem:\s*(.*)$/s);
    if (leadMatch) {
      cleanContent = leadMatch[2].trim();
    }
    // Strip trailing "Data atual: DD/MM/AAAA, HH:MM:SS"
    cleanContent = cleanContent.replace(
      /\s*Data atual:\s*\d{2}\/\d{2}\/\d{4},\s*\d{2}:\d{2}:\d{2}\s*$/,
      ''
    );

    return {
      id: row.id,
      timestamp,
      category: 'user_message',
      speaker: 'cliente',
      content: cleanContent.trim(),
    };
  }

  // 4. Agent Message vs Followup
  if (rawType === 'ai') {
    const isFollowupText =
      content.toLowerCase().includes('passando para saber') ||
      content.toLowerCase().includes('conseguiu verificar') ||
      content.toLowerCase().includes('ainda tem interesse') ||
      content.toLowerCase().includes('tudo bem por aí? sou a');

    let isTimeGapFollowup = false;
    if (prevRow && row.timestamp && prevRow.timestamp) {
      const diffMs =
        new Date(row.timestamp).getTime() - new Date(prevRow.timestamp).getTime();
      if (diffMs > 3 * 3600 * 1000 && prevRow.message?.type === 'ai') {
        isTimeGapFollowup = true;
      }
    }

    const isFollowup = isFollowupText || isTimeGapFollowup;

    return {
      id: row.id,
      timestamp,
      category: isFollowup ? 'followup' : 'agent_message',
      speaker: isFollowup ? 'followup' : 'agente_principal',
      content: content.trim(),
    };
  }

  return {
    id: row.id,
    timestamp,
    category: 'agent_message',
    speaker: 'agente_principal',
    content: content,
  };
}

export function registerConversationTools(server: McpServer) {
  server.tool(
    'get_conversation',
    'READ-ONLY: Retrieve a cleaned and chronologically ordered conversation for a specific client and session/chat_id. Automatically separates customer messages, main agent messages, follow-ups, and tool executions using the timestamp column.',
    {
      client: z
        .string()
        .describe('Name of the company/client (e.g. "Marcelo Reis", "DGO EPIs", "VM Turismo", "Dr Raphael", "Concursalas", "Eucaliptus", "Bluefit")'),
      session_id: z
        .string()
        .describe('The WhatsApp session/chat ID (e.g. "179658498826324@lid") or phone number'),
      table: z
        .string()
        .optional()
        .describe('Explicit memory table name if known (e.g. "marcelo_reis_chat_histories")'),
      include_tool_calls: z
        .boolean()
        .optional()
        .default(false)
        .describe('Set to true if you need to inspect internal tool calls (Think, etc.). Defaults to false for clean human-readable dialogue.'),
      include_internal_system: z
        .boolean()
        .optional()
        .default(false)
        .describe('Set to true if you need to see internal system prompts/triggers. Defaults to false.'),
      limit: z
        .number()
        .optional()
        .default(50)
        .describe('Max messages to return (default: 50, max: 200)'),
    },
    async ({
      client,
      session_id,
      table,
      include_tool_calls,
      include_internal_system,
      limit,
    }) => {
      try {
        const { tables, schema } = await inspectDatabaseSchema();
        let targetTable = table;

        if (!targetTable) {
          const clientNormalized = client.toLowerCase().replace(/[^a-z0-9]/g, '');
          // Search memory tables matching client
          const memoryTables = tables.filter(
            (t) => schema[t]?.classification === 'memory'
          );

          targetTable = memoryTables.find((t) => {
            const tNorm = t.toLowerCase().replace(/[^a-z0-9]/g, '');
            return tNorm.includes(clientNormalized);
          });
        }

        if (!targetTable) {
          const availableMemory = tables.filter(
            (t) => schema[t]?.classification === 'memory'
          );
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Memory table not found for client "${client}". Available memory tables:\n${availableMemory.join('\n')}`,
              },
            ],
          };
        }

        const supabase = getSupabaseClient();
        const tableMeta = schema[targetTable];
        const cols = tableMeta ? tableMeta.columns.map((c) => c.name) : [];

        // Check if session_id matches directly or via ILIKE (for phone searches)
        let query = supabase.from(targetTable).select('*');
        if (session_id.includes('@')) {
          query = query.eq('session_id', session_id);
        } else {
          query = query.or(`session_id.eq.${session_id},session_id.ilike.%${session_id}%`);
        }

        // Essential: Sort strictly by timestamp ASC, id ASC to eliminate out-of-order noise
        if (cols.includes('timestamp')) {
          query = query.order('timestamp', { ascending: true }).order('id', { ascending: true });
        } else {
          query = query.order('id', { ascending: true });
        }

        const safeLimit = Math.min(Math.max(limit, 1), 200);
        query = query.limit(safeLimit);

        const { data, error } = await query;

        if (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error fetching conversation from "${targetTable}": ${error.message}`,
              },
            ],
          };
        }

        if (!data || data.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    message: `No messages found for session_id "${session_id}" in table "${targetTable}".`,
                    tip: 'Use list_recent_conversations to see valid session IDs for this client.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Classify all messages
        const parsed: CleanMessage[] = [];
        for (let i = 0; i < data.length; i++) {
          const prev = i > 0 ? data[i - 1] : null;
          parsed.push(parseAndClassifyMessage(data[i], prev));
        }

        // Apply filters
        const filtered = parsed.filter((m) => {
          if (!include_tool_calls && m.category === 'tool_call') return false;
          if (!include_internal_system && m.category === 'internal_system') return false;
          return true;
        });

        // Summary statistics
        const stats = {
          total_raw_messages: data.length,
          returned_messages: filtered.length,
          user_messages: parsed.filter((m) => m.category === 'user_message').length,
          agent_messages: parsed.filter((m) => m.category === 'agent_message').length,
          followups: parsed.filter((m) => m.category === 'followup').length,
          tool_calls: parsed.filter((m) => m.category === 'tool_call').length,
          internal_system_prompts: parsed.filter((m) => m.category === 'internal_system').length,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  client,
                  session_id,
                  memory_table: targetTable,
                  statistics: stats,
                  chronological_conversation: filtered,
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
              text: `Error in get_conversation: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'list_recent_conversations',
    'READ-ONLY: List the most recent active conversation sessions for a client, showing the session_id, last message date, total messages, and snippet. Cross-references with WhatsApp contacts if available.',
    {
      client: z
        .string()
        .describe('Name of the company/client (e.g. "Marcelo Reis", "DGO EPIs", "VM Turismo", "Dr Raphael", "Concursalas")'),
      limit: z
        .number()
        .optional()
        .default(15)
        .describe('Number of sessions to return (default: 15, max: 50)'),
    },
    async ({ client, limit }) => {
      try {
        const { tables, schema } = await inspectDatabaseSchema();
        const clientNormalized = client.toLowerCase().replace(/[^a-z0-9]/g, '');

        const memoryTables = tables.filter((t) => schema[t]?.classification === 'memory');
        const targetTable = memoryTables.find((t) => {
          const tNorm = t.toLowerCase().replace(/[^a-z0-9]/g, '');
          return tNorm.includes(clientNormalized);
        });

        if (!targetTable) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Memory table not found for client "${client}". Available memory tables:\n${memoryTables.join('\n')}`,
              },
            ],
          };
        }

        const supabase = getSupabaseClient();
        const tableMeta = schema[targetTable];
        const cols = tableMeta ? tableMeta.columns.map((c) => c.name) : [];

        // Fetch recent messages to extract sessions
        let query = supabase.from(targetTable).select('*');
        if (cols.includes('timestamp')) {
          query = query.order('timestamp', { ascending: false });
        } else {
          query = query.order('id', { ascending: false });
        }

        // Fetch up to 300 messages to aggregate sessions
        const { data, error } = await query.limit(300);

        if (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error querying "${targetTable}": ${error.message}`,
              },
            ],
          };
        }

        const sessionMap = new Map<
          string,
          {
            session_id: string;
            last_timestamp: string;
            total_messages_sampled: number;
            last_message_preview: string;
            last_speaker: string;
          }
        >();

        for (const row of data || []) {
          const sid = row.session_id;
          if (!sid) continue;

          const parsed = parseAndClassifyMessage(row, null);
          if (!sessionMap.has(sid)) {
            sessionMap.set(sid, {
              session_id: sid,
              last_timestamp: row.timestamp || 'N/A',
              total_messages_sampled: 1,
              last_message_preview: parsed.content.slice(0, 100),
              last_speaker: parsed.speaker,
            });
          } else {
            const current = sessionMap.get(sid)!;
            current.total_messages_sampled++;
          }
        }

        const safeLimit = Math.min(Math.max(limit, 1), 50);
        const sessions = Array.from(sessionMap.values()).slice(0, safeLimit);

        // Optional: Cross reference with WhatsApp contacts table
        const contactTables = tables.filter(
          (t) =>
            schema[t]?.classification === 'contacts' &&
            t.toLowerCase().replace(/[^a-z0-9]/g, '').includes(clientNormalized)
        );

        let contactsMap = new Map<string, { nome?: string; telefone?: string }>();
        if (contactTables.length > 0) {
          const { data: contactsData } = await supabase
            .from(contactTables[0])
            .select('*')
            .limit(100);

          if (contactsData) {
            for (const c of contactsData) {
              const key = c.chat_id || c.Telefone || c.telefone || c.phone;
              if (key) {
                contactsMap.set(String(key), {
                  nome: c.Nome || c.nome || c.name,
                  telefone: c.Telefone || c.telefone || c.phone,
                });
              }
            }
          }
        }

        const enrichedSessions = sessions.map((s) => {
          const contact = contactsMap.get(s.session_id);
          return {
            ...s,
            contact_name: contact?.nome || null,
            contact_phone: contact?.telefone || null,
          };
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  client,
                  memory_table: targetTable,
                  active_sessions_count: enrichedSessions.length,
                  sessions: enrichedSessions,
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
              text: `Error in list_recent_conversations: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'audit_conversations_batch',
    'READ-ONLY: Mass analysis tool. Fetches multiple recent conversation sessions at once for a client, pre-cleaned and cross-referenced with WhatsApp contacts. Perfect for mass auditing, sentiment analysis, qualification checking, and executive reporting.',
    {
      client: z
        .string()
        .describe('Name of the company/client (e.g. "Marcelo Reis", "DGO EPIs", "VM Turismo", "Dr Raphael", "Bluefit curitiba")'),
      limit_conversations: z
        .number()
        .optional()
        .default(10)
        .describe('Number of recent conversation sessions to analyze in mass (default: 10, max: 25)'),
    },
    async ({ client, limit_conversations }) => {
      try {
        const { tables, schema } = await inspectDatabaseSchema();
        const clientNormalized = client.toLowerCase().replace(/[^a-z0-9]/g, '');

        const memoryTables = tables.filter((t) => schema[t]?.classification === 'memory');
        const targetMemory = memoryTables.find((t) =>
          t.toLowerCase().replace(/[^a-z0-9]/g, '').includes(clientNormalized)
        );

        if (!targetMemory) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Memory table not found for client "${client}". Available memory tables:\n${memoryTables.join('\n')}`,
              },
            ],
          };
        }

        const supabase = getSupabaseClient();
        const tableMeta = schema[targetMemory];
        const cols = tableMeta ? tableMeta.columns.map((c) => c.name) : [];

        // 1. Fetch recent raw messages to discover session IDs
        let recentQuery = supabase.from(targetMemory).select('*');
        if (cols.includes('timestamp')) {
          recentQuery = recentQuery.order('timestamp', { ascending: false });
        } else {
          recentQuery = recentQuery.order('id', { ascending: false });
        }

        const { data: recentMsgs, error: recentErr } = await recentQuery.limit(400);

        if (recentErr) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error discovering sessions in "${targetMemory}": ${recentErr.message}`,
              },
            ],
          };
        }

        // Distinct session IDs
        const distinctSessionIds = Array.from(
          new Set(recentMsgs?.map((m) => m.session_id).filter(Boolean))
        ).slice(0, Math.min(Math.max(limit_conversations, 1), 25));

        // 2. Fetch WhatsApp contacts to cross-reference names and phones
        const contactTables = tables.filter(
          (t) =>
            schema[t]?.classification === 'contacts' &&
            t.toLowerCase().replace(/[^a-z0-9]/g, '').includes(clientNormalized)
        );

        const contactsMap = new Map<string, { nome?: string; telefone?: string }>();
        if (contactTables.length > 0) {
          const { data: contactsData } = await supabase
            .from(contactTables[0])
            .select('*')
            .limit(200);

          if (contactsData) {
            for (const c of contactsData) {
              const key = c.chat_id || c.Telefone || c.telefone || c.phone;
              if (key) {
                contactsMap.set(String(key), {
                  nome: c.Nome || c.nome || c.name,
                  telefone: c.Telefone || c.telefone || c.phone,
                });
              }
            }
          }
        }

        // 3. For each session, fetch full clean dialogue
        const batchResults = [];
        for (const sid of distinctSessionIds) {
          let sessionQuery = supabase
            .from(targetMemory)
            .select('*')
            .eq('session_id', sid);

          if (cols.includes('timestamp')) {
            sessionQuery = sessionQuery.order('timestamp', { ascending: true }).order('id', { ascending: true });
          } else {
            sessionQuery = sessionQuery.order('id', { ascending: true });
          }

          const { data: sessionRows } = await sessionQuery.limit(60);

          if (!sessionRows || sessionRows.length === 0) continue;

          // Classify and clean
          const cleanDialogue: CleanMessage[] = [];
          for (let i = 0; i < sessionRows.length; i++) {
            const prev = i > 0 ? sessionRows[i - 1] : null;
            const parsed = parseAndClassifyMessage(sessionRows[i], prev);
            // Keep user, agent and followup only
            if (
              parsed.category === 'user_message' ||
              parsed.category === 'agent_message' ||
              parsed.category === 'followup'
            ) {
              cleanDialogue.push(parsed);
            }
          }

          const contact = contactsMap.get(sid);
          const firstUserMsg = cleanDialogue.find((m) => m.category === 'user_message');
          const lastMsg = cleanDialogue[cleanDialogue.length - 1];

          batchResults.push({
            session_id: sid,
            contact_name: contact?.nome || null,
            contact_phone: contact?.telefone || null,
            total_raw_events: sessionRows.length,
            total_clean_messages: cleanDialogue.length,
            started_at: cleanDialogue[0]?.timestamp || null,
            last_activity_at: lastMsg?.timestamp || null,
            lead_opening_message: firstUserMsg?.content || '(Sem mensagem inicial identificada)',
            last_message_by: lastMsg?.speaker || 'desconhecido',
            last_message_text: lastMsg?.content || '',
            clean_dialogue_transcript: cleanDialogue.map(
              (m) => `[${m.timestamp}] ${m.speaker.toUpperCase()}: ${m.content}`
            ),
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  client,
                  memory_table: targetMemory,
                  total_conversations_analyzed: batchResults.length,
                  conversations: batchResults,
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
              text: `Error in audit_conversations_batch: ${err.message || String(err)}`,
            },
          ],
        };
      }
    }
  );
}

