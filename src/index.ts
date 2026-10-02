import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "./db/database.js";
import { advanceWorld, getWorldState, resumeGame, getWorldTickSeconds, getMaxTicksPerResume } from "./world/worldState.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = new McpServer({
    name: "grimoire",
    version: "0.1.0",
});

function getLocationDescription(db: any, locationName: string): string {
    const result = db.exec("SELECT description FROM locations WHERE name = ?", [locationName]);
    if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0];
    }
    return "You see nothing but darkness.";
}

function getLocationExits(db: any, locationName: string): string[] {
    const result = db.exec("SELECT exits FROM locations WHERE name = ?", [locationName]);
    if (result.length > 0 && result[0].values.length > 0) {
        const exits = JSON.parse(result[0].values[0][0]);
        return Object.keys(exits);
    }
    return [];
}

server.tool(
    "describe_scene",
    "Returns the current scene description for the crossroads outside the village.",
    {},
    async () => {
        const db = await getDatabase();
        const description = getLocationDescription(db, "crossroads");
        const exits = getLocationExits(db, "crossroads");
        return {
            content: [
                {
                    type: "text",
                    text: `${description} Exits lead ${exits.join(", ")}.`
                },
            ],
        };
    }
);

server.tool(
    "look",
    "Look around at your current location. Takes an optional location name (defaults to crossroads).",
    {
        location: z.string().optional().describe("Name of the location to look at (default: crossroads)")
    },
    async ({ location = "crossroads" }) => {
        const db = await getDatabase();
        const description = getLocationDescription(db, location);
        const exits = getLocationExits(db, location);
        return {
            content: [
                {
                    type: "text",
                    text: `${description} Exits lead ${exits.join(", ")}.`
                },
            ],
        };
    }
);

server.tool(
    "get_world_state",
    "Get the current world state including turn counter, threat level, ongoing situations, and recent world events.",
    {
        gameId: z.number().optional().describe("Game ID (default: 1)")
    },
    async ({ gameId = 1 }) => {
        const state = await getWorldState(gameId);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(state, null, 2)
                },
            ],
        };
    }
);

server.tool(
    "advance_world",
    "Advance the world by a specified number of ticks (deterministic, for demo/testing). Returns fired events and new world state.",
    {
        ticks: z.number().int().positive().describe("Number of ticks to advance"),
        gameId: z.number().optional().describe("Game ID (default: 1)")
    },
    async ({ ticks, gameId = 1 }) => {
        const result = await advanceWorld(gameId, ticks);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                },
            ],
        };
    }
);

server.tool(
    "resume_game",
    "Resume the game: compute elapsed ticks since last_played, advance world (capped by MAX_TICKS_PER_RESUME), and return a 'while you were away' recap.",
    {
        gameId: z.number().optional().describe("Game ID (default: 1)")
    },
    async ({ gameId = 1 }) => {
        const result = await resumeGame(gameId);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                },
            ],
        };
    }
);

server.tool(
    "world_config",
    "Get the current world configuration (tick rate and max ticks per resume).",
    {},
    async () => {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        worldTickSeconds: getWorldTickSeconds(),
                        maxTicksPerResume: getMaxTicksPerResume()
                    }, null, 2)
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