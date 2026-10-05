import { randomUUID } from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createMcpServer } from '../server.js';
import { getConfig } from '../config.js';

interface SessionRecord {
  transport: StreamableHTTPServerTransport | SSEServerTransport;
  open: number;
  lastActive: number;
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 1000;
const sessions = new Map<string, SessionRecord>();

function trackResponse(session: SessionRecord, res: Response) {
  if (!res.socket || res.destroyed) return;
  session.open++;
  res.on('close', () => {
    session.open--;
    session.lastActive = Date.now();
  });
}

// Clean up idle sessions periodically
setInterval(() => {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [sid, { transport, open, lastActive }] of sessions.entries()) {
    if (open === 0 && lastActive < cutoff) {
      console.log(`[MCP] Cleaning up idle session: ${sid}`);
      transport.close().catch(console.error);
      sessions.delete(sid);
    }
  }
}, 60 * 1000).unref();

export function startHttpServer() {
  const config = getConfig();
  const app = createMcpExpressApp({ host: config.host });

  // Enable CORS
  app.use(cors());

  // Optional authentication middleware
  const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!config.authToken) {
      return next();
    }

    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];
    const apiKeyQuery = req.query.apiKey as string | undefined;

    const token =
      (authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null) ||
      apiKeyHeader ||
      apiKeyQuery;

    if (!token || token !== config.authToken) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unauthorized: Invalid or missing authentication token',
        },
        id: null,
      });
      return;
    }

    next();
  };

  // Health and info endpoint
  app.get(['/', '/health'], (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'supabase-mcp',
      version: '1.0.0',
      auth_required: Boolean(config.authToken),
      endpoints: {
        streamable_http: '/mcp (GET, POST, DELETE)',
        sse_events: '/sse (GET)',
        sse_messages: '/messages (POST)',
      },
      configured_tables: config.tableNames,
    });
  });

  //=============================================================================
  // STREAMABLE HTTP TRANSPORT (Protocol version: 2025-11-25)
  // Used by modern MCP clients, Claude remote connectors, etc.
  //=============================================================================
  app.all('/mcp', authMiddleware, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const session = sessionId ? sessions.get(sessionId) : undefined;
      let transport: StreamableHTTPServerTransport;

      if (session) {
        if (session.transport instanceof StreamableHTTPServerTransport) {
          transport = session.transport;
          trackResponse(session, res);
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: Session exists but uses a different transport protocol',
            },
            id: null,
          });
          return;
        }
      } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        if (sessions.size >= MAX_SESSIONS) {
          res.status(503).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Too many open sessions' },
            id: null,
          });
          return;
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSid) => {
            console.log(`[StreamableHTTP] Session initialized: ${newSid}`);
            sessions.set(newSid, { transport, open: 0, lastActive: Date.now() });
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions.has(sid)) {
            console.log(`[StreamableHTTP] Session closed: ${sid}`);
            sessions.delete(sid);
          }
        };

        const server = createMcpServer();
        await server.connect(transport);
      } else if (sessionId) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found or expired' },
          id: null,
        });
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided or invalid initialization payload',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error: any) {
      console.error('[StreamableHTTP] Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error: ' + (error?.message || String(error)),
          },
          id: null,
        });
      }
    }
  });

  //=============================================================================
  // CLASSIC SSE TRANSPORT (Protocol version: 2024-11-05)
  // Backward compatible with older SSE clients and MCP proxies
  //=============================================================================
  app.get('/sse', authMiddleware, async (req: Request, res: Response) => {
    try {
      if (sessions.size >= MAX_SESSIONS) {
        res.status(503).send('Too many open sessions');
        return;
      }

      const transport = new SSEServerTransport('/messages', res);
      const session: SessionRecord = { transport, open: 0, lastActive: Date.now() };
      sessions.set(transport.sessionId, session);
      trackResponse(session, res);

      transport.onclose = () => {
        console.log(`[SSE] Session closed: ${transport.sessionId}`);
        sessions.delete(transport.sessionId);
      };

      const server = createMcpServer();
      await server.connect(transport);
      console.log(`[SSE] Client connected: ${transport.sessionId}`);
    } catch (error: any) {
      console.error('[SSE] Error initializing SSE connection:', error);
      if (!res.headersSent) {
        res.status(500).send('Error initializing SSE connection');
      }
    }
  });

  app.post('/messages', authMiddleware, async (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).send('Missing sessionId parameter');
        return;
      }

      const existingTransport = sessions.get(sessionId)?.transport;
      if (existingTransport instanceof SSEServerTransport) {
        await existingTransport.handlePostMessage(req, res, req.body);
      } else {
        res.status(404).send('No active SSE session found for sessionId');
      }
    } catch (error: any) {
      console.error('[SSE] Error handling post message:', error);
      if (!res.headersSent) {
        res.status(500).send('Error handling message: ' + (error?.message || String(error)));
      }
    }
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(`
============================================================
🚀 Supabase MCP Server running at http://${config.host}:${config.port}
============================================================
Supported Transports:
1. Streamable HTTP (Claude Connectors, Remote MCP 2025):
   Endpoint: http://${config.host}:${config.port}/mcp
   Methods:  GET, POST, DELETE

2. HTTP + SSE (Classic SSE 2024):
   Event stream: http://${config.host}:${config.port}/sse
   Messages:     http://${config.host}:${config.port}/messages?sessionId=<id>

Authentication: ${config.authToken ? 'ENABLED (Bearer Token / x-api-key / ?apiKey)' : 'DISABLED (Open Access)'}
Target Supabase: ${config.supabaseUrl || '(Warning: SUPABASE_URL not configured)'}
============================================================
`);
  });

  const shutdown = async () => {
    console.log('\n[MCP] Shutting down server...');
    for (const [sid, { transport }] of sessions.entries()) {
      try {
        await transport.close();
      } catch (err) {
        console.error(`[MCP] Error closing transport ${sid}:`, err);
      }
    }
    server.close(() => {
      console.log('[MCP] Server closed successfully.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
