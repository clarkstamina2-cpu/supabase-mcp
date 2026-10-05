#!/usr/bin/env node
import { startHttpServer } from './transports/http.js';
import { startStdioServer } from './transports/stdio.js';

const isStdio = process.argv.includes('--stdio');

if (isStdio) {
  startStdioServer().catch((err) => {
    console.error('[Supabase MCP] Fatal error starting STDIO server:', err);
    process.exit(1);
  });
} else {
  startHttpServer();
}
