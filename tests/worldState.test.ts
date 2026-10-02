import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase, getDatabase, closeDatabase, persistDatabase } from "../src/db/database.js";
import {
    getWorldState,
    advanceWorld,
    resumeGame,
    getWorldTickSeconds,
    getMaxTicksPerResume,
    FiredEvent
} from "../src/world/worldState.js";

const TEST_DB_PATH = "./data/test_grimoire.db";

async function resetTestDatabase() {
    const fs = await import("fs");
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
    }
    await initDatabase(TEST_DB_PATH);
}

function createGame(db: any): number {
    db.run("INSERT INTO games DEFAULT VALUES");
    const result = db.exec("SELECT last_insert_rowid() as id");
    return result[0].values[0][0];
}

describe("Living World - World State", () => {
    beforeEach(async () => {
        await resetTestDatabase();
    });

    afterEach(async () => {
        closeDatabase();
    });

    it("should initialize world state for a new game", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        const state = await getWorldState(gameId);
        expect(state.worldState.turnCounter).toBe(0);
        expect(state.worldState.threatLevel).toBe(0);
        expect(state.situations.length).toBe(2);
        expect(state.recentEvents.length).toBe(0);
    });

    it("should seed default situations: bandits and merchant reward", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        const state = await getWorldState(gameId);
        const situationNames = state.situations.map(s => s.name);
        expect(situationNames).toContain("Bandits march on the village");
        expect(situationNames).toContain("A grateful merchant prepares a reward");

        const bandits = state.situations.find(s => s.name === "Bandits march on the village");
        const merchant = state.situations.find(s => s.name === "A grateful merchant prepares a reward");
        expect(bandits?.countdown).toBe(5);
        expect(merchant?.countdown).toBe(3);
    });
});

describe("Living World - Tick Mechanics", () => {
    beforeEach(async () => {
        await resetTestDatabase();
    });

    afterEach(async () => {
        closeDatabase();
    });

    it("advancing 1 tick should decrement countdowns", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        const { firedEvents, worldState } = await advanceWorld(gameId, 1);

        expect(worldState.turnCounter).toBe(1);
        expect(firedEvents.length).toBe(0);

        const state = await getWorldState(gameId);
        const bandits = state.situations.find(s => s.name === "Bandits march on the village");
        const merchant = state.situations.find(s => s.name === "A grateful merchant prepares a reward");
        expect(bandits?.countdown).toBe(4);
        expect(merchant?.countdown).toBe(2);
    });

    it("advancing N ticks should fire bandits event exactly at tick 5", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        const { firedEvents, worldState } = await advanceWorld(gameId, 5);

        expect(worldState.turnCounter).toBe(5);
        expect(firedEvents.length).toBe(2);
        const banditsEvent = firedEvents.find(e => e.situationName === "Bandits march on the village");
        expect(banditsEvent).toBeDefined();
        expect(banditsEvent?.eventType).toBe("bandits_arrive");

        const state = await getWorldState(gameId);
        const bandits = state.situations.find(s => s.name === "Bandits march on the village");
        expect(bandits).toBeUndefined();
        const merchant = state.situations.find(s => s.name === "A grateful merchant prepares a reward");
        expect(merchant).toBeUndefined();
    });

    it("advancing 6 ticks should fire both events (merchant at 3, bandits at 5)", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        const { firedEvents, worldState } = await advanceWorld(gameId, 6);

        expect(worldState.turnCounter).toBe(6);
        expect(firedEvents.length).toBe(2);

        const eventNames = firedEvents.map(e => e.situationName).sort();
        expect(eventNames).toEqual(["A grateful merchant prepares a reward", "Bandits march on the village"]);

        const state = await getWorldState(gameId);
        expect(state.situations.length).toBe(0);
    });

    it("fired bandits event should apply effects: threat_level +3, location description updated, NPC disposition changed", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 5);

        const state = await getWorldState(gameId);
        expect(state.worldState.threatLevel).toBe(3);

        const locationDesc = db.exec("SELECT description FROM locations WHERE id = 3")[0].values[0][0];
        expect(locationDesc).toContain("Bandit campfires glow");

        const npcDisposition = db.exec("SELECT disposition FROM npcs WHERE name = 'Captain Varek'")[0].values[0][0];
        expect(npcDisposition).toBe(-10);
    });

    it("fired merchant event should apply effects: item granted, location description updated, NPC disposition changed", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 3);

        const state = await getWorldState(gameId);
        expect(state.worldState.threatLevel).toBe(0);

        const inventory = db.exec("SELECT item_name FROM inventory WHERE game_id = ?", [gameId]);
        expect(inventory[0]?.values?.some((row: any) => row[0] === "Merchant's Token")).toBe(true);

        const locationDesc = db.exec("SELECT description FROM locations WHERE id = 5")[0].values[0][0];
        expect(locationDesc).toContain("Merchant's Token");

        const npcDisposition = db.exec("SELECT disposition FROM npcs WHERE name = 'Gareth the Innkeeper'")[0].values[0][0];
        expect(npcDisposition).toBe(5);
    });

    it("world_events should be logged and persist across server restart", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 6);

        const stateBeforeRestart = await getWorldState(gameId);
        expect(stateBeforeRestart.recentEvents.length).toBe(2);

        closeDatabase();

        await initDatabase(TEST_DB_PATH);
        const stateAfterRestart = await getWorldState(gameId);
        expect(stateAfterRestart.recentEvents.length).toBe(2);
        expect(stateAfterRestart.worldState.turnCounter).toBe(6);
        expect(stateAfterRestart.worldState.threatLevel).toBe(3);
    });

    it("advance_world with 0 ticks should return current state without changes", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        const { firedEvents, worldState } = await advanceWorld(gameId, 0);

        expect(firedEvents.length).toBe(0);
        expect(worldState.turnCounter).toBe(0);
    });
});

describe("Living World - resume_game", () => {
    beforeEach(async () => {
        await resetTestDatabase();
    });

    afterEach(async () => {
        closeDatabase();
    });

    it("should advance correct number of ticks based on elapsed time", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 2);

        const db2 = await getDatabase();
        const pastTime = new Date(Date.now() - 3600 * 1000).toISOString();
        db2.run("UPDATE world_state SET last_played = ? WHERE game_id = ?", [pastTime, gameId]);
        persistDatabase();

        process.env.WORLD_TICK_SECONDS = "3600";

        const result = await resumeGame(gameId);

        expect(result.ticksAdvanced).toBe(1);
        expect(result.newWorldState.turnCounter).toBe(3);
        expect(result.firedEvents.length).toBe(1);
        expect(result.firedEvents[0].situationName).toBe("A grateful merchant prepares a reward");
    });

    it("should respect MAX_TICKS_PER_RESUME cap", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 0);

        const db2 = await getDatabase();
        const pastTime = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
        db2.run("UPDATE world_state SET last_played = ? WHERE game_id = ?", [pastTime, gameId]);
        persistDatabase();

        process.env.WORLD_TICK_SECONDS = "3600";
        process.env.MAX_TICKS_PER_RESUME = "5";

        const result = await resumeGame(gameId);

        expect(result.ticksAdvanced).toBe(5);
        expect(result.newWorldState.turnCounter).toBe(5);
        expect(result.firedEvents.length).toBe(2);
    });

    it("should return recap referencing fired events", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 0);

        const db2 = await getDatabase();
        const pastTime = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
        db2.run("UPDATE world_state SET last_played = ? WHERE game_id = ?", [pastTime, gameId]);
        persistDatabase();

        process.env.WORLD_TICK_SECONDS = "3600";
        process.env.MAX_TICKS_PER_RESUME = "100";
        process.env.NARRATION_ENABLED = "false";

        const result = await resumeGame(gameId);

        expect(result.ticksAdvanced).toBe(6);
        expect(result.firedEvents.length).toBe(2);
        expect(result.recap).toContain("While you were away");
        expect(result.recap).toContain("Bandits march on the village");
        expect(result.recap).toContain("A grateful merchant prepares a reward");
    });

    it("should return 'no time passed' recap when no ticks elapsed", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        process.env.WORLD_TICK_SECONDS = "3600";

        const result = await resumeGame(gameId);

        expect(result.ticksAdvanced).toBe(0);
        expect(result.firedEvents.length).toBe(0);
        expect(result.recap).toContain("No time has passed");
    });
});

describe("Living World - Bedrock Recap (mocked)", () => {
    beforeEach(async () => {
        await resetTestDatabase();
    });

    afterEach(async () => {
        closeDatabase();
        vi.restoreAllMocks();
    });

    it("should call Bedrock with structured fired events for recap when narration enabled", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 0);

        const db2 = await getDatabase();
        const pastTime = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
        db2.run("UPDATE world_state SET last_played = ? WHERE game_id = ?", [pastTime, gameId]);
        persistDatabase();

        process.env.WORLD_TICK_SECONDS = "3600";
        process.env.MAX_TICKS_PER_RESUME = "100";
        process.env.NARRATION_ENABLED = "true";
        process.env.AWS_ACCESS_KEY_ID = "test";
        process.env.AWS_SECRET_ACCESS_KEY = "test";
        process.env.AWS_REGION = "us-east-1";

        const { BedrockRuntimeClient } = await import("@aws-sdk/client-bedrock-runtime");
        const mockSend = vi.fn().mockResolvedValue({
            body: new TextEncoder().encode(JSON.stringify({
                content: [{ text: "While you were away, bandits arrived and a merchant left a reward." }]
            }))
        });
        vi.spyOn(BedrockRuntimeClient.prototype, "send").mockImplementation(mockSend);

        const result = await resumeGame(gameId);

        expect(mockSend).toHaveBeenCalled();
        const callArgs = mockSend.mock.calls[0][0];
        const { InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");
        expect(callArgs).toBeInstanceOf(InvokeModelCommand);
        const input = callArgs.input;
        expect(input.modelId).toBeDefined();
        const body = JSON.parse(new TextDecoder().decode(input.body));
        expect(body.system).toContain("While You Were Away");
        expect(body.messages[0].content).toContain("Bandits march on the village");
        expect(body.messages[0].content).toContain("A grateful merchant prepares a reward");
        expect(result.recap).toBe("While you were away, bandits arrived and a merchant left a reward.");
    });

    it("should fallback to plain event list when narration disabled", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 0);

        const db2 = await getDatabase();
        const pastTime = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
        db2.run("UPDATE world_state SET last_played = ? WHERE game_id = ?", [pastTime, gameId]);
        persistDatabase();

        process.env.WORLD_TICK_SECONDS = "3600";
        process.env.MAX_TICKS_PER_RESUME = "100";
        process.env.NARRATION_ENABLED = "false";

        const result = await resumeGame(gameId);

        expect(result.recap).toContain("While you were away");
        expect(result.recap).toContain("Bandits march on the village");
        expect(result.recap).toContain("A grateful merchant prepares a reward");
        expect(result.recap).not.toContain("While you were away, bandits arrived");
    });

    it("should fallback to plain event list when Bedrock credentials missing", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        await advanceWorld(gameId, 0);

        const db2 = await getDatabase();
        const pastTime = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
        db2.run("UPDATE world_state SET last_played = ? WHERE game_id = ?", [pastTime, gameId]);
        persistDatabase();

        process.env.WORLD_TICK_SECONDS = "3600";
        process.env.MAX_TICKS_PER_RESUME = "100";
        process.env.NARRATION_ENABLED = "true";
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;
        delete process.env.AWS_SESSION_TOKEN;
        delete process.env.AWS_PROFILE;
        delete process.env.AWS_ROLE_ARN;

        const result = await resumeGame(gameId);

        expect(result.recap).toContain("While you were away");
        expect(result.recap).toContain("Bandits march on the village");
        expect(result.recap).toContain("A grateful merchant prepares a reward");
    });
});

describe("Living World - look/describe_scene reflects world changes", () => {
    beforeEach(async () => {
        await resetTestDatabase();
    });

    afterEach(async () => {
        closeDatabase();
    });

    it("village_gate description should include bandit campfires after bandits event fires", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        const beforeDesc = db.exec("SELECT description FROM locations WHERE name = 'village_gate'")[0].values[0][0];
        expect(beforeDesc).not.toContain("Bandit campfires");

        await advanceWorld(gameId, 5);

        const afterDesc = db.exec("SELECT description FROM locations WHERE name = 'village_gate'")[0].values[0][0];
        expect(afterDesc).toContain("Bandit campfires glow");
    });

    it("village_square description should include reward mention after merchant event fires", async () => {
        const db = await getDatabase();
        const gameId = createGame(db);
        persistDatabase();

        const beforeDesc = db.exec("SELECT description FROM locations WHERE name = 'village_square'")[0].values[0][0];
        expect(beforeDesc).not.toContain("Merchant's Token");

        await advanceWorld(gameId, 3);

        const afterDesc = db.exec("SELECT description FROM locations WHERE name = 'village_square'")[0].values[0][0];
        expect(afterDesc).toContain("Merchant's Token");
    });
});