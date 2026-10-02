import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { 
  initializeDatabase, 
  getLatestGameId, 
  createGame, 
  getGameState, 
  moveCharacter, 
  lookAround, 
  pickUpItem, 
  dropItem, 
  rollCheck, 
  getCurrentSceneDescription,
  logEvent,
  getNPCsAtLocation,
  talkToNPC,
  giveItemToNPC,
  NPCReplyContext,
} from "./db/repository.js";
import { persistDatabase } from "./db/database.js";
import { narrate, generateNPCReply, NarrationContext, NPCReplyContext as NPCReplyContextType } from "./ai/narrator.js";

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

async function buildNarrationContext(
  gameId: number,
  eventType: NarrationContext["event"]["type"],
  eventDescription: string,
  success?: boolean
): Promise<NarrationContext> {
  const state = await getGameState(gameId);
  if (!state) {
    throw new Error("Game not found");
  }

  const recentLog = state.storyLog.slice(-3);
  const exits = Object.keys(state.location.exits);

  return {
    location: {
      name: state.location.name,
      description: state.location.description,
      exits,
    },
    event: {
      type: eventType,
      description: eventDescription,
      success,
    },
    character: {
      name: state.character.name,
      hp_current: state.character.hp_current,
      hp_max: state.character.hp_max,
      strength: state.character.strength,
      wits: state.character.wits,
      charm: state.character.charm,
    },
    recentLog,
  };
}

async function narrateAndLog(
  gameId: number,
  eventType: NarrationContext["event"]["type"],
  eventDescription: string,
  success?: boolean
): Promise<string> {
  const context = await buildNarrationContext(gameId, eventType, eventDescription, success);
  const narration = await narrate(context);
  await logEvent(gameId, narration);
  persistDatabase();
  return narration;
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
    const resolvedGameId = await resolveGameId(gameId);
    const result = await moveCharacter(resolvedGameId, direction);
    let narration = "";
    if (result.success) {
      narration = await narrateAndLog(
        resolvedGameId,
        "move",
        `Moved ${direction} to ${result.location?.name}`,
        true
      );
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ ...result, narration }, null, 2) }]
    };
  }
);

server.tool(
  "look",
  "Look at the current location description, visible exits, and NPCs present.",
  {
    gameId: z.number().int().positive().optional()
  },
  async ({ gameId }) => {
    const resolvedGameId = await resolveGameId(gameId);
    const result = await lookAround(resolvedGameId);
    const narration = await narrateAndLog(
      resolvedGameId,
      "look",
      `You look around the ${result.description.split(".")[0].toLowerCase()}`
    );
    return {
      content: [{ type: "text", text: JSON.stringify({ ...result, narration }, null, 2) }]
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
    const resolvedGameId = await resolveGameId(gameId);
    const result = await pickUpItem(resolvedGameId, item);
    let narration = "";
    if (result.success) {
      narration = await narrateAndLog(
        resolvedGameId,
        "pick_up",
        `Picked up ${item}`,
        true
      );
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ ...result, narration }, null, 2) }]
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
    const resolvedGameId = await resolveGameId(gameId);
    const result = await dropItem(resolvedGameId, item);
    let narration = "";
    if (result.success) {
      narration = await narrateAndLog(
        resolvedGameId,
        "drop",
        `Dropped ${item}`,
        true
      );
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ ...result, narration }, null, 2) }]
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
    const resolvedGameId = await resolveGameId(gameId);
    const result = await rollCheck(resolvedGameId, skill, difficulty);
    const narration = await narrateAndLog(
      resolvedGameId,
      "roll_check",
      `${skill} check: rolled ${result.roll} + ${result.modifier} = ${result.total} vs ${difficulty}`,
      result.success
    );
    return {
      content: [{ type: "text", text: JSON.stringify({ ...result, narration }, null, 2) }]
    };
  }
);

server.tool(
  "describe_scene",
  "Returns the current scene description for the character's location, including NPCs present.",
  {
    gameId: z.number().int().positive().optional()
  },
  async ({ gameId }) => {
    const resolvedGameId = await resolveGameId(gameId);
    const text = await getCurrentSceneDescription(resolvedGameId);
    const narration = await narrateAndLog(
      resolvedGameId,
      "describe_scene",
      text
    );
    return {
      content: [{ type: "text", text: JSON.stringify({ description: text, narration }, null, 2) }]
    };
  }
);

server.tool(
  "get_npcs",
  "Get NPCs present at the player's current location with their disposition labels.",
  {
    gameId: z.number().int().positive().optional()
  },
  async ({ gameId }) => {
    const resolvedGameId = await resolveGameId(gameId);
    const state = await getGameState(resolvedGameId);
    if (!state) {
      return {
        content: [{ type: "text", text: "Game not found" }],
        isError: true
      };
    }
    const npcs = await getNPCsAtLocation(state.location.id, resolvedGameId);
    return {
      content: [{ type: "text", text: JSON.stringify({ npcs }, null, 2) }]
    };
  }
);

server.tool(
  "talk_to",
  "Speak to an NPC at the current location. Records the conversation in NPC memory and generates an in-character reply.",
  {
    npcName: z.string().min(1),
    line: z.string().min(1),
    gameId: z.number().int().positive().optional()
  },
  async ({ npcName, line, gameId }) => {
    const resolvedGameId = await resolveGameId(gameId);
    const result = await talkToNPC(resolvedGameId, npcName, line, generateNPCReply);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "give_item_to_npc",
  "Give an item from your inventory to an NPC at the current location. Raises their disposition and generates a thankful reply.",
  {
    npcName: z.string().min(1),
    item: z.string().min(1),
    gameId: z.number().int().positive().optional()
  },
  async ({ npcName, item, gameId }) => {
    const resolvedGameId = await resolveGameId(gameId);
    const result = await giveItemToNPC(resolvedGameId, npcName, item, generateNPCReply);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
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