import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./mcp/tools.js";
import { logger } from "./utils/logger.js";

const SERVER_NAME = "petros-trading-scanner-mcp";
const SERVER_VERSION = "1.0.0";

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, SessionEntry>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerTools(server);
  return server;
}

function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.MCP_SERVER_API_KEY;
  if (!configuredKey) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const expected = `Bearer ${configuredKey}`;

  if (authHeader !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader)
    ? sessionIdHeader[0]
    : sessionIdHeader;

  try {
    if (isInitializeRequest(req.body)) {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
          logger.info("MCP session initialized", { sessionId: id });
        },
      });

      transport.onclose = () => {
        const id = transport.sessionId;
        if (id && sessions.has(id)) {
          sessions.delete(id);
          logger.info("MCP session closed", { sessionId: id });
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error("MCP request failed", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal MCP server error" });
    }
  }
}

async function handleMcpGet(req: Request, res: Response): Promise<void> {
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader)
    ? sessionIdHeader[0]
    : sessionIdHeader;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const entry = sessions.get(sessionId)!;
  await entry.transport.handleRequest(req, res);
}

async function handleMcpDelete(req: Request, res: Response): Promise<void> {
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader)
    ? sessionIdHeader[0]
    : sessionIdHeader;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const entry = sessions.get(sessionId)!;
  await entry.transport.handleRequest(req, res);
  sessions.delete(sessionId);
}

export function createApp(): express.Application {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: SERVER_NAME,
      version: SERVER_VERSION,
      timestamp: new Date().toISOString(),
      sessions: sessions.size,
    });
  });

  app.post("/mcp", apiKeyMiddleware, (req, res) => {
    void handleMcpPost(req, res);
  });

  app.get("/mcp", apiKeyMiddleware, (req, res) => {
    void handleMcpGet(req, res);
  });

  app.delete("/mcp", apiKeyMiddleware, (req, res) => {
    void handleMcpDelete(req, res);
  });

  return app;
}

export function startServer(): void {
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp();

  app.listen(port, "0.0.0.0", () => {
    logger.info(`${SERVER_NAME} listening`, {
      port,
      mcpEndpoint: `/mcp`,
      healthEndpoint: `/health`,
      apiKeyEnabled: Boolean(process.env.MCP_SERVER_API_KEY),
    });
  });
}
