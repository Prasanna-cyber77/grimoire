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

## Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

In the Inspector:
1. Click "List Tools" - you should see `describe_scene`
2. Click "Call Tool" on `describe_scene` (no arguments needed)
3. The tool returns:
   > You stand at a crossroads outside a sleeping village. A dirt road forks north into dark woods and east toward flickering torchlight.

## Health Check

```bash
curl http://localhost:3000/health
# Returns: ok (200)
```

## License

MIT