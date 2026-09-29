import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { initializeDatabase, getLatestGameId, createGame, getGameState, moveCharacter, lookAround, pickUpItem, dropItem, rollCheck, getCurrentSceneDescription } from "./db/repository.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

await initializeDatabase();

const server = new McpServer({
  name: "grimoire",
  version: "0.1.0",
});

async function resolveGameId(gameId?: number): Promise<number> {
  if (gameId !== undefined) return gameId;
  const latest = await getLatestGameId();
  if (latest === null) throw new Error("No active game. Create one with new_game.");
  return latest;
}

server.tool(
  "new_game",
  "Create a new game with a character at the crossroads.",
  {
    characterName: z.string().min(1).max(50)
  },
  async ({ characterName }) => {
    const state = await createGame(characterName);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(state, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "get_state",
  "Get the current game state including character, location, inventory, and story log.",
  {
    gameId: z.number().int().positive().optional()
  },
  async ({ gameId }) => {
    try {
      const state = await getGameState(await resolveGameId(gameId));
      if (!state) {
        return {
          content: [{ type: "text", text: "Game not found" }],
          isError: true
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(state, null, 2) }]
      };
    } catch (err) {
      console.error("get_state error:", err);
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true
      };
    }
  }
);

server.tool(
  "move",
  "Move in a direction (north, south, east, west) from the current location.",
  {
    direction: z.enum(["north", "south", "east", "west"]),
    gameId: z.number().int().positive().optional()
  },
  async ({ direction, gameId }) => {
    const result = await moveCharacter(await resolveGameId(gameId), direction);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "look",
  "Look at the current location description and visible exits.",
  {
    gameId: z.number().int().positive().optional()
  },
  async ({ gameId }) => {
    const result = await lookAround(await resolveGameId(gameId));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "pick_up",
  "Pick up an item and add it to inventory.",
  {
    item: z.string().min(1),
    gameId: z.number().int().positive().optional()
  },
  async ({ item, gameId }) => {
    const result = await pickUpItem(await resolveGameId(gameId), item);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "drop",
  "Drop an item from inventory.",
  {
    item: z.string().min(1),
    gameId: z.number().int().positive().optional()
  },
  async ({ item, gameId }) => {
    const result = await dropItem(await resolveGameId(gameId), item);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "roll_check",
  "Roll a d20 + stat modifier vs difficulty for strength, wits, or charm.",
  {
    skill: z.enum(["strength", "wits", "charm"]),
    difficulty: z.number().int().min(1).max(30),
    gameId: z.number().int().positive().optional()
  },
  async ({ skill, difficulty, gameId }) => {
    const result = await rollCheck(await resolveGameId(gameId), skill, difficulty);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "describe_scene",
  "Returns the current scene description for the character's location.",
  {
    gameId: z.number().int().positive().optional()
  },
  async ({ gameId }) => {
    const text = await getCurrentSceneDescription(await resolveGameId(gameId));
    return {
      content: [{ type: "text", text }]
    };
  }
);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

server.connect(transport);

const app = express();

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
  Promise.resolve(transport.handleRequest(req, res, body)).catch((err) => {
    console.error("MCP request error:", err);
  });
});

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