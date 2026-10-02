# Grimoire

Grimoire is a self-hosted MCP server (Streamable HTTP, spec 2025-11-25+) that lets Amazon Alexa+ run a persistent, voice-only tabletop RPG as the Dungeon Master. The server is the game's brain and memory (authoritative state, rules, and dice, all deterministic in code); Amazon Bedrock is its imagination (narration and NPC dialogue seeded with the true game state); Alexa+ is its voice.

## GitHub Topics

mcp, model-context-protocol, alexa-plus, amazon-bedrock, typescript, rpg, voice-ai, dungeon-master, hackathon

## Install

```bash
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `DB_PATH` | SQLite database file path | `./data/grimoire.db` |
| `NARRATION_ENABLED` | Enable AI narration via Amazon Bedrock | `true` |
| `AWS_REGION` | AWS region for Bedrock | `us-east-1` |
| `BEDROCK_MODEL_ID` | Bedrock model ID (Claude) | `anthropic.claude-3-sonnet-20240229-v1:0` |
| `AWS_ACCESS_KEY_ID` | AWS credentials (optional, can use IAM role) | — |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials (optional, can use IAM role) | — |
| `AWS_SESSION_TOKEN` | AWS session token (optional) | — |

**Important**: Never commit real AWS credentials to version control. Use IAM roles, environment variables, or AWS config files for production deployments.

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

## MCP Tools (Phase 1 + Phase 2 + Phase 3)

The server exposes the following MCP tools. All tools that mutate state (`move`, `pick_up`, `drop`, `roll_check`, `look`, `describe_scene`, `talk_to`, `give_item_to_npc`) now return a `narration` field containing AI-generated flavor text (or deterministic fallback when Bedrock is unavailable/disabled).

| Tool | Description | Parameters | Returns |
|------|-------------|------------|---------|
| `new_game` | Create a new game with a character at the crossroads | `characterName` (string, 1-50 chars) | `GameState` |
| `get_state` | Get current game state (character, location, inventory, story log) | `gameId` (optional, integer) | `GameState` |
| `move` | Move in a direction from current location | `direction` (north/south/east/west), `gameId` (optional) | `{ success, message, location?, narration }` |
| `look` | Look at current location description, exits, and NPCs present | `gameId` (optional) | `{ description, exits, npcs[], narration }` |
| `pick_up` | Pick up an item and add to inventory | `item` (string), `gameId` (optional) | `{ success, message, narration }` |
| `drop` | Drop an item from inventory | `item` (string), `gameId` (optional) | `{ success, message, narration }` |
| `roll_check` | Roll d20 + stat modifier vs difficulty | `skill` (strength/wits/charm), `difficulty` (1-30), `gameId` (optional) | `{ roll, modifier, total, difficulty, success, skill, narration }` |
| `describe_scene` | Get current location description including NPCs present | `gameId` (optional) | `{ description, narration }` |
| `get_npcs` | Get NPCs present at the player's current location with disposition labels | `gameId` (optional) | `{ npcs[] }` |
| `talk_to` | Speak to an NPC at the current location. Records conversation in NPC memory and generates an in-character reply. | `npcName` (string), `line` (string), `gameId` (optional) | `{ success, message, npcName, reply, disposition, dispositionLabel }` |
| `give_item_to_npc` | Give an item from your inventory to an NPC at the current location. Raises their disposition and generates a thankful reply. | `npcName` (string), `item` (string), `gameId` (optional) | `{ success, message, npcName, disposition, dispositionLabel, reply }` |

All tools accept an optional `gameId`. If omitted, the most recently created game is used.

## AI Narration (Phase 2)

When `NARRATION_ENABLED=true` (default) and valid AWS credentials are configured, the server uses Amazon Bedrock (Claude) to generate vivid, immersive second-person narration for each action. The narration is **strictly grounded in the true game state** — the LLM receives only the deterministic facts (location, event outcome, character sheet, recent history) and is instructed never to invent or contradict any game facts.

If narration is disabled, credentials are missing, or the Bedrock call fails, the server gracefully falls back to deterministic descriptive text. **The server never crashes or hangs due to Bedrock issues.**

## Persistent NPCs with Memory (Phase 3)

Grimoire features persistent NPCs that remember past interactions with the player **across server restarts**.

### NPC Data Model (SQLite)
- **npc**: id, name, home_location_id, personality description, disposition score (-100 hostile to +100 ally, starts at 0 neutral)
- **npc_memory**: append-only log per NPC per game — records what the player said/did and the NPC's reply, timestamped

### Seeded NPCs
| NPC | Location | Personality | Starting Disposition |
|-----|----------|-------------|---------------------|
| Gareth the Innkeeper | Tavern (7) | Jovial, rotund man with a booming laugh. Treats everyone like an old friend but remembers every tab. | 0 (neutral) |
| Old Mara | Dark Woods (2) | Wizened hermit in a moss-covered hut. Speaks in riddles, distrusts outsiders but respects those who respect the woods. | 0 (neutral) |
| Captain Varek | Village Gate (3) | Stern, battle-scarred guard captain. Fair but rigid; earn his respect through deeds, not words. | 0 (neutral) |

### Disposition Labels
| Score Range | Label | Behavior |
|-------------|-------|----------|
| -100 to -50 | hostile | Openly threatening, insulting |
| -49 to -10 | wary | Suspicious, curt, uncooperative |
| -9 to 9 | neutral | Guarded but polite, transactional |
| 10 to 50 | friendly | Warm, helpful, shares information |
| 51 to 100 | ally | Loyal, protective, goes out of their way |

### NPC Interaction Rules
- **Deterministic**: Disposition is adjusted ONLY by coded rules (e.g., giving an item raises it by +10); Bedrock only writes dialogue, never changes state or disposition on its own
- **Persistent**: NPC memory and disposition survive server restarts (stored in SQLite)
- **Context-aware**: NPC replies reference past interactions from `npc_memory`
- **Graceful fallback**: If Bedrock is off/unavailable, NPCs return canned lines that still reflect their current disposition

## Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

In the Inspector:
1. Click "List Tools" - you should see all 11 tools
2. Call `new_game` with `{"characterName": "Aragorn"}`
3. Call `get_state` to see the character sheet and starting location
4. Call `move` with `{"direction": "east"}` to travel to the village gate
5. Call `get_npcs` to see Captain Varek
6. Call `talk_to` with `{"npcName": "Captain Varek", "line": "May I pass?"}`
7. Call `give_item_to_npc` with `{"npcName": "Captain Varek", "item": "a shiny coin"}` to raise disposition
8. Call `roll_check` with `{"skill": "strength", "difficulty": 15}` to test dice
9. Call `describe_scene` to get the current location description with NPCs

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
- NPC system: seeding, get_npcs, talk_to records memory, give_item_to_npc moves items and raises disposition
- **PERSISTENCE headline test**: talk to an NPC, give an item, restart the server, and confirm the NPC's memory and raised disposition are still there
- Fallback paths for both narration and NPC dialogue when Bedrock is disabled or unavailable
- Bedrock mocking — no real AWS calls in tests

## Data Model

- **Character**: name, hp_current, hp_max, strength, wits, charm
- **Locations**: crossroads, dark_woods, village_gate, ancient_clearing, village_square, dark_cave, tavern (with fixed connections)
- **Inventory**: list of item names tied to the game
- **Story Log**: append-only list of short text entries recording what happened
- **NPCs**: id, name, home_location_id, personality, disposition (-100 to +100)
- **NPC Memory**: append-only log per NPC per game (player lines, NPC replies, gifts given)

State persists in SQLite (`./data/grimoire.db` by default, configurable via `DB_PATH` env var).

## License

MIT