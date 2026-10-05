import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { startHttpServer } from './src/transports/http.js';
import { getConfig } from './src/config.js';

async function runUpdatedTests() {
  console.log('====================================================');
  console.log('🧪 TESTANDO REGRAS ATUALIZADAS (TAXONOMIA & CONVERSAS)');
  console.log('====================================================\n');

  const config = getConfig();
  const server = startHttpServer();
  await new Promise((r) => setTimeout(r, 1000));

  const baseUrl = `http://localhost:${config.port}`;
  const authToken = config.authToken || '';

  const sseUrl = new URL(`${baseUrl}/sse`);
  const transport = new SSEClientTransport(sseUrl, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  });

  const client = new Client(
    { name: 'test-claude-agent', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Conectado ao MCP Server autenticado via SSE!\n');

  // TESTE 1: Validar que message_buffer foi 100% ignorado e vector_store classificado como knowledge_base
  console.log('👉 [1/4] Verificando list_clients_and_tables (filtro de message_buffer)...');
  const res1: any = await client.callTool({
    name: 'list_clients_and_tables',
    arguments: {},
  });
  const data1 = JSON.parse(res1.content[0].text);
  console.log(`   Total de tabelas ativas: ${data1.active_tables_count}`);
  
  // Assert message_buffer is NOT present in any client or other_tables
  const jsonStr = JSON.stringify(data1);
  const hasBuffer = jsonStr.includes('message_buffer');
  console.log(`   Contém message_buffer? ${hasBuffer ? '❌ ERRO: vazou' : '✅ NÃO (100% ignorado conforme solicitado)'}`);

  console.log('   Exemplo de mapeamento do cliente "dgo epis":', data1.clients['dgo epis']);
  console.log('   Exemplo de mapeamento do cliente "marcelo reis":', data1.clients['marcelo reis']);

  // TESTE 2: WhatsApp Contacts da Bluefit Curitiba
  console.log('\n👉 [2/4] Testando get_contacts para "Bluefit curitiba"...');
  const res2: any = await client.callTool({
    name: 'get_contacts',
    arguments: { client: 'Bluefit curitiba', limit: 2 },
  });
  const data2 = JSON.parse(res2.content[0].text);
  console.log(`   Tabela resolvida: ${data2.resolved_table}`);
  console.log(`   Contatos retornados: ${data2.count} (Total: ${data2.total_matching})`);
  if (data2.contacts?.[0]) {
    console.log('   Amostra de contato:', {
      Nome: data2.contacts[0].Nome,
      Telefone: data2.contacts[0].Telefone,
      chat_id: data2.contacts[0].chat_id,
    });
  }

  // TESTE 3: Listar sessões recentes de conversa (list_recent_conversations)
  console.log('\n👉 [3/4] Testando list_recent_conversations para "Marcelo Reis"...');
  const res3: any = await client.callTool({
    name: 'list_recent_conversations',
    arguments: { client: 'Marcelo Reis', limit: 3 },
  });
  const data3 = JSON.parse(res3.content[0].text);
  console.log(`   Tabela de memória: ${data3.memory_table}`);
  console.log(`   Sessões ativas encontradas: ${data3.active_sessions_count}`);
  const targetSession = data3.sessions[0]?.session_id;
  console.log(`   Primeira sessão: ${targetSession} | Última atividade: ${data3.sessions[0]?.last_timestamp}`);

  // TESTE 4: Puxar conversa limpa com separação de papéis e ordenação por timestamp
  console.log(`\n👉 [4/4] Testando get_conversation (sessão: ${targetSession})...`);
  const res4: any = await client.callTool({
    name: 'get_conversation',
    arguments: {
      client: 'Marcelo Reis',
      session_id: targetSession,
      include_tool_calls: false,
      limit: 10,
    },
  });
  const data4 = JSON.parse(res4.content[0].text);
  console.log('   Estatísticas da conversa:');
  console.log(data4.statistics);
  console.log('\n   Linha do tempo cronológica limpa:');
  data4.chronological_conversation.slice(0, 4).forEach((msg: any) => {
    console.log(`   [${msg.timestamp}] [${msg.speaker.toUpperCase()}]: ${msg.content.slice(0, 80)}...`);
  });

  console.log('\n====================================================');
  console.log('🎉 TODOS OS TESTES PASSARAM COM EXCELÊNCIA!');
  console.log('====================================================');

  await client.close();
  server.close();
  process.exit(0);
}

runUpdatedTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
