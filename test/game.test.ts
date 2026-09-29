import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DB_PATH = path.join(__dirname, "test-grimoire.db");

function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

beforeAll(async () => {
  cleanupTestDb();
  process.env.DB_PATH = TEST_DB_PATH;
  const { initializeDatabase } = await import("../src/db/repository.js");
  await initializeDatabase();
});

afterAll(() => {
  cleanupTestDb();
  delete process.env.DB_PATH;
});

beforeEach(async () => {
  cleanupTestDb();
  const { initializeDatabase } = await import("../src/db/repository.js");
  await initializeDatabase();
});

describe("roll_check math and success/failure with fixed seed", () => {
  it("should return correct roll, modifier, total, and success for strength", async () => {
    const { createGame, rollCheck } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const rng = () => 10;
    const result = await rollCheck(gameId, "strength", 15, rng);

    expect(result.roll).toBe(10);
    expect(result.modifier).toBe(1);
    expect(result.total).toBe(11);
    expect(result.difficulty).toBe(15);
    expect(result.success).toBe(false);
    expect(result.skill).toBe("strength");
  });

  it("should succeed when total >= difficulty", async () => {
    const { createGame, rollCheck } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const rng = () => 18;
    const result = await rollCheck(gameId, "strength", 15, rng);

    expect(result.roll).toBe(18);
    expect(result.modifier).toBe(1);
    expect(result.total).toBe(19);
    expect(result.success).toBe(true);
  });

  it("should use correct modifier for wits (10 -> 0)", async () => {
    const { createGame, rollCheck } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const rng = () => 15;
    const result = await rollCheck(gameId, "wits", 15, rng);

    expect(result.modifier).toBe(0);
    expect(result.total).toBe(15);
    expect(result.success).toBe(true);
  });

  it("should use correct modifier for charm (8 -> -1)", async () => {
    const { createGame, rollCheck } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const rng = () => 15;
    const result = await rollCheck(gameId, "charm", 15, rng);

    expect(result.modifier).toBe(-1);
    expect(result.total).toBe(14);
    expect(result.success).toBe(false);
  });

  it("should throw for unknown skill", async () => {
    const { createGame, rollCheck } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    await expect(rollCheck(gameId, "dexterity", 15, () => 10)).rejects.toThrow("Unknown skill");
  });
});

describe("state changes: new_game -> move -> pick_up, then get_state reflects them", () => {
  it("should create game, move, pick up item, and get_state reflects all changes", async () => {
    const { createGame, getGameState, moveCharacter, pickUpItem } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    expect(state.character.name).toBe("TestHero");
    expect(state.location.name).toBe("crossroads");
    expect(state.inventory).toContain("a rusty dagger");

    const moveResult = await moveCharacter(gameId, "north");
    expect(moveResult.success).toBe(true);
    expect(moveResult.location?.name).toBe("dark_woods");

    const pickupResult = await pickUpItem(gameId, "a shiny coin");
    expect(pickupResult.success).toBe(true);

    const finalState = await getGameState(gameId);
    expect(finalState).not.toBeNull();
    expect(finalState!.location.name).toBe("dark_woods");
    expect(finalState!.inventory).toContain("a rusty dagger");
    expect(finalState!.inventory).toContain("a shiny coin");
    expect(finalState!.storyLog.some(entry => entry.includes("Moved north"))).toBe(true);
    expect(finalState!.storyLog.some(entry => entry.includes("Picked up a shiny coin"))).toBe(true);
  });

  it("should fail to move in invalid direction", async () => {
    const { createGame, moveCharacter } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const result = await moveCharacter(gameId, "west");
    expect(result.success).toBe(false);
    expect(result.message).toContain("can't go west");
  });

  it("should fail to pick up duplicate item", async () => {
    const { createGame, pickUpItem } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const result1 = await pickUpItem(gameId, "a shiny coin");
    expect(result1.success).toBe(true);

    const result2 = await pickUpItem(gameId, "a shiny coin");
    expect(result2.success).toBe(false);
    expect(result2.message).toContain("already have");
  });
});

describe("persistence: create a game, stop, restart server, confirm get_state still returns that game", () => {
  it("should persist game state across database reinitialization", async () => {
    const { createGame, getGameState, initializeDatabase } = await import("../src/db/repository.js");
    
    const state = await createGame("PersistentHero");
    const gameId = state.gameId;

    await initializeDatabase();

    const retrievedState = await getGameState(gameId);
    expect(retrievedState).not.toBeNull();
    expect(retrievedState!.gameId).toBe(gameId);
    expect(retrievedState!.character.name).toBe("PersistentHero");
    expect(retrievedState!.location.name).toBe("crossroads");
    expect(retrievedState!.inventory).toContain("a rusty dagger");
    expect(retrievedState!.storyLog.some(entry => entry.includes("Game started"))).toBe(true);
  });

  it("should return latest game when gameId omitted", async () => {
    const { createGame, getGameState, getLatestGameId } = await import("../src/db/repository.js");
    
    await createGame("FirstHero");
    const state2 = await createGame("SecondHero");
    
    const latestId = await getLatestGameId();
    expect(latestId).toBe(state2.gameId);

    const state = await getGameState();
    expect(state).not.toBeNull();
    expect(state!.character.name).toBe("SecondHero");
  });
});

describe("look and describe_scene", () => {
  it("should return current location description and exits", async () => {
    const { createGame, lookAround } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const result = await lookAround(gameId);
    expect(result.description).toContain("crossroads");
    expect(result.exits).toContain("north");
    expect(result.exits).toContain("east");
  });
});

describe("drop item", () => {
  it("should drop item from inventory", async () => {
    const { createGame, pickUpItem, dropItem, getGameState } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    await pickUpItem(gameId, "a shiny coin");
    const dropResult = await dropItem(gameId, "a shiny coin");
    expect(dropResult.success).toBe(true);

    const finalState = await getGameState(gameId);
    expect(finalState!.inventory).not.toContain("a shiny coin");
  });

  it("should fail to drop item not in inventory", async () => {
    const { createGame, dropItem } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const result = await dropItem(gameId, "nonexistent item");
    expect(result.success).toBe(false);
    expect(result.message).toContain("don't have");
  });
});