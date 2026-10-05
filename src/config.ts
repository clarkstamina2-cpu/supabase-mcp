import dotenv from 'dotenv';

dotenv.config();

export interface ServerConfig {
  supabaseUrl: string;
  supabaseKey: string;
  port: number;
  host: string;
  authToken?: string;
  enableRawSql: boolean;
  tableNames: {
    contacts: string;
    conversations: string;
    messages: string;
  };
  contactCandidates: string[];
  conversationCandidates: string[];
  messageCandidates: string[];
}

export function getConfig(): ServerConfig {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    '';

  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';
  const authToken = process.env.AUTH_TOKEN || undefined;
  const enableRawSql = process.env.ENABLE_RAW_SQL === 'true';

  const tableNames = {
    contacts: process.env.TABLE_CONTACTS || 'contacts',
    conversations: process.env.TABLE_CONVERSATIONS || 'conversations',
    messages: process.env.TABLE_MESSAGES || 'messages',
  };

  const contactCandidates = [
    tableNames.contacts,
    'contacts',
    'contatos',
    'leads',
    'clientes',
    'clients',
  ];

  const conversationCandidates = [
    tableNames.conversations,
    'conversations',
    'conversas',
    'chats',
    'atendimentos',
  ];

  const messageCandidates = [
    tableNames.messages,
    'messages',
    'mensagens',
    'chat_messages',
  ];

  return {
    supabaseUrl,
    supabaseKey,
    port,
    host,
    authToken,
    enableRawSql,
    tableNames,
    contactCandidates: Array.from(new Set(contactCandidates)),
    conversationCandidates: Array.from(new Set(conversationCandidates)),
    messageCandidates: Array.from(new Set(messageCandidates)),
  };
}
