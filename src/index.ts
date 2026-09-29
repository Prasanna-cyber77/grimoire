import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = new McpServer({
  name: "grimoire",
  version: "0.1.0",
});

server.tool(
  "describe_scene",
  "Returns the current scene description for the crossroads outside the village.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: "You stand at a crossroads outside a sleeping village. A dirt road forks north into dark woods and east toward flickering torchlight.",
        },
      ],
    };
  }
);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

server.connect(transport);

const app = express();

// Custom raw body parser for MCP endpoint
app.use("/mcp", (req, res, next) => {
  let data = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    data += chunk;
  });
  req.on("end", () => {
    (req as any).rawBody = data;
    next();
  });
});

app.all("/mcp", (req, res) => {
  const rawBody = (req as any).rawBody;
  const body = rawBody ? JSON.parse(rawBody) : undefined;
  transport.handleRequest(req, res, body);
});

// JSON parser for all other routes
app.use((req, res, next) => {
  if (req.path.startsWith("/mcp")) {
    return next();
  }
  express.json()(req, res, next);
});

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log(`Grimoire MCP server listening on http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health endpoint: http://localhost:${PORT}/health`);
});