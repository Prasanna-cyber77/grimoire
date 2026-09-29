# Grimoire

Grimoire is a self-hosted MCP server (Streamable HTTP, spec 2025-11-25+) that lets Amazon Alexa+ run a persistent, voice-only tabletop RPG as the Dungeon Master. The server is the game's brain and memory (authoritative state, rules, and dice, all deterministic in code); Amazon Bedrock is its imagination (narration and NPC dialogue seeded with the true game state); Alexa+ is its voice.

## GitHub Topics

mcp, model-context-protocol, alexa-plus, amazon-bedrock, typescript, rpg, voice-ai, dungeon-master, hackathon

## Install

```bash
npm install
npm run build
```

## Run Locally

```bash
# Development with hot reload
npm run dev

# Production
npm start
```

The server will start on `http://localhost:3000` (or the PORT from `.env`).

- MCP endpoint: `http://localhost:3000/mcp`
- Health endpoint: `http://localhost:3000/health`

## Run in Docker

```bash
docker build -t grimoire .
docker run -p 3000:3000 --env-file .env grimoire
```

## MCP Tools (Phase 1)

The server exposes the following MCP tools:

| Tool | Description | Parameters |
|------|-------------|------------|
| `new_game` | Create a new game with a character at the crossroads | `characterName` (string, 1-50 chars) |
| `get_state` | Get current game state (character, location, inventory, story log) | `gameId` (optional, integer) |
| `move` | Move in a direction from current location | `direction` (north/south/east/west), `gameId` (optional) |
| `look` | Look at current location description and exits | `gameId` (optional) |
| `pick_up` | Pick up an item and add to inventory | `item` (string), `gameId` (optional) |
| `drop` | Drop an item from inventory | `item` (string), `gameId` (optional) |
| `roll_check` | Roll d20 + stat modifier vs difficulty | `skill` (strength/wits/charm), `difficulty` (1-30), `gameId` (optional) |
| `describe_scene` | Get current location description | `gameId` (optional) |

All tools accept an optional `gameId`. If omitted, the most recently created game is used.

## Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

In the Inspector:
1. Click "List Tools" - you should see all 8 tools
2. Call `new_game` with `{"characterName": "Aragorn"}`
3. Call `get_state` to see the character sheet and starting location
4. Call `move` with `{"direction": "north"}` to travel to the dark woods
5. Call `pick_up` with `{"item": "a shiny coin"}` to add to inventory
6. Call `roll_check` with `{"skill": "strength", "difficulty": 15}` to test dice
7. Call `describe_scene` to get the current location description

## Health Check

```bash
curl http://localhost:3000/health
# Returns: ok (200)
```

## Run Tests

```bash
npm test
```

Tests cover:
- Roll check math and success/failure with fixed seed
- State changes: new_game -> move -> pick_up, then get_state reflects them
- Persistence: create a game, stop, restart server, and confirm get_state still returns that game
- Look, drop, and describe_scene functionality

## Data Model

- **Character**: name, hp_current, hp_max, strength, wits, charm
- **Locations**: crossroads, dark_woods, village_gate, ancient_clearing, village_square, dark_cave, tavern (with fixed connections)
- **Inventory**: list of item names tied to the game
- **Story Log**: append-only list of short text entries recording what happened

State persists in SQLite (`./data/grimoire.db` by default, configurable via `DB_PATH` env var).

## License

MIT