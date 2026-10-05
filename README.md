# Supabase MCP Server (Streamable HTTP + SSE + Stdio)

Servidor MCP (Model Context Protocol) de alta performance para consulta e auditoria de **Conversas**, **Contatos de WhatsApp** e **Bases de Conhecimento** no Supabase, compatível com **Claude Web**, **Claude Desktop**, **Cursor** e **Easypanel**.

---

## 🗂️ Taxonomia do Banco de Dados

O servidor aplica filtros rigorosos para proteger a integridade e relevância das consultas:

1. **Memória de Conversas (`_chat_history`, `_chat_histories`, `_chat_memories`):**
   - Fonte primária para auditoria de diálogos.
   - Mensagens reordenadas estritamente por `timestamp ASC, id ASC`.
   - Separação inteligente de papéis: **Cliente**, **Agente Principal**, **Follow-up**, **Tool Calls (Think)** e **Prompts de Sistema**.
2. **Contatos de WhatsApp (`[...] Contatos - Wpp`):**
   - Armazenamento de leads e contatos de WhatsApp (ex: `[Bluefit curitiba] Contatos - Wpp`, `[C. Despertar] Contatos - Wpp`).
3. **Bases de Conhecimento (`_vector_store`, `_banco_vetorial`):**
   - Embeddings e documentos de apoio dos agentes em produção.
4. **Tabelas Depreciadas (`message_buffer`):**
   - 100% filtradas e ignoradas pela API (descontinuadas).

---

## 🛠️ Ferramentas Disponíveis (100% Consultivas / Somente Leitura)

| Ferramenta | Descrição |
|---|---|
| `get_conversation` | **Principal ferramenta:** Retorna a conversa limpa e cronológica por `client` e `session_id`, separando cliente, agente e follow-up. |
| `list_recent_conversations` | Lista os últimos atendimentos de uma empresa com prévia da última mensagem, data e contato associado. |
| `get_contacts` | Busca contatos de WhatsApp por nome, telefone ou empresa (priorizando tabelas `Contatos - Wpp`). |
| `list_clients_and_tables` | Mapeia todas as empresas e suas tabelas de contatos, memória e base de conhecimento. |
| `list_tables` | Lista tabelas com filtro de categoria (`memory`, `contacts`, `vector_store`). |
| `describe_table` | Inspeciona colunas e tipos de dados de qualquer tabela. |
| `query_table` | Consulta genérica flexível em qualquer tabela com filtros, paginação e ordenação. |
| `count_records` | Conta registros de qualquer tabela com filtros opcionais. |

---

## 🚀 Como Rodar e Fazer Deploy no Easypanel

1. **Variáveis de Ambiente (no Easypanel ou `.env`):**
   ```env
   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_aqui
   AUTH_TOKEN=seu_token_secreto_aqui
   PORT=3000
   HOST=0.0.0.0
   ```

2. **No Easypanel:**
   - Crie um App a partir do repositório Git (o [Dockerfile](file:///D:/Trabalho%20-%20Inovacao/supabase-mcp/Dockerfile) já está pronto).
   - Defina a porta do container como `3000`.
   - Adicione o seu domínio com HTTPS automático.

3. **No Claude Web:**
   - Adicione o conector MCP: `https://seu-dominio.com/mcp`
   - Autenticação: **Bearer Token**
   - Token: o mesmo `AUTH_TOKEN` que você configurou no Easypanel
   - Copie o conteúdo de [CLAUDE_SKILL.md](file:///D:/Trabalho%20-%20Inovacao/supabase-mcp/CLAUDE_SKILL.md) para as instruções do seu Projeto no Claude.
