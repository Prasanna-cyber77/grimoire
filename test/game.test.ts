import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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

describe("NPC system", () => {
  it("should seed 3 NPCs at their home locations", async () => {
    const { createGame, getNPCsAtLocation } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    // Move to tavern (location 7) to find Gareth
    const { moveCharacter } = await import("../src/db/repository.js");
    await moveCharacter(gameId, "north"); // crossroads -> dark_woods
    await moveCharacter(gameId, "north"); // dark_woods -> ancient_clearing
    await moveCharacter(gameId, "north"); // ancient_clearing -> dark_cave (wrong path)
    
    // Better path: crossroads -> east -> village_gate -> east -> village_square -> north -> tavern
    const state2 = await createGame("TestHero2");
    const gameId2 = state2.gameId;
    await moveCharacter(gameId2, "east"); // crossroads -> village_gate
    await moveCharacter(gameId2, "east"); // village_gate -> village_square
    await moveCharacter(gameId2, "north"); // village_square -> tavern

    const npcsAtTavern = await getNPCsAtLocation(7, gameId2);
    expect(npcsAtTavern.length).toBe(1);
    expect(npcsAtTavern[0].name).toBe("Gareth the Innkeeper");
    expect(npcsAtTavern[0].dispositionLabel).toBe("neutral");
  });

  it("should get NPCs at village_gate (Captain Varek)", async () => {
    const { createGame, getNPCsAtLocation, moveCharacter } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;
    await moveCharacter(gameId, "east"); // crossroads -> village_gate

    const npcs = await getNPCsAtLocation(3, gameId);
    expect(npcs.length).toBe(1);
    expect(npcs[0].name).toBe("Captain Varek");
  });

  it("should get NPCs at dark_woods (Old Mara)", async () => {
    const { createGame, getNPCsAtLocation, moveCharacter } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;
    await moveCharacter(gameId, "north"); // crossroads -> dark_woods

    const npcs = await getNPCsAtLocation(2, gameId);
    expect(npcs.length).toBe(1);
    expect(npcs[0].name).toBe("Old Mara");
  });

  it("talk_to should record player line and NPC reply in npc_memory", async () => {
    const { createGame, talkToNPC, getNPCMemory, moveCharacter } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;
    await moveCharacter(gameId, "east"); // crossroads -> village_gate

    // Mock generateNPCReply to return a simple response
    const mockGenerateReply = vi.fn().mockResolvedValue("\"Halt! State your business.\"");

    const result = await talkToNPC(gameId, "Captain Varek", "I seek passage.", mockGenerateReply);

    expect(result.success).toBe(true);
    expect(result.npcName).toBe("Captain Varek");
    expect(result.reply).toBe("\"Halt! State your business.\"");
    expect(result.disposition).toBe(0);
    expect(result.dispositionLabel).toBe("neutral");

    // Check memory was recorded (2 entries: player line + NPC reply)
    const memory = await getNPCMemory(gameId, 3); // Captain Varek is NPC id 3
    expect(memory.length).toBe(2);
  });

  it("give_item_to_npc should move item from inventory and raise disposition by 10", async () => {
    const { createGame, giveItemToNPC, getGameState, pickUpItem, moveCharacter } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;
    
    // Go to tavern and pick up an item to give
    await moveCharacter(gameId, "east"); // crossroads -> village_gate
    await moveCharacter(gameId, "east"); // village_gate -> village_square
    await moveCharacter(gameId, "north"); // village_square -> tavern
    
    // Pick up an item first (character starts with rusty dagger, so pick up something else)
    await pickUpItem(gameId, "a shiny coin");

    const mockGenerateReply = vi.fn().mockResolvedValue("\"A generous gift! Thank you, friend.\"");

    const result = await giveItemToNPC(gameId, "Gareth the Innkeeper", "a shiny coin", mockGenerateReply);

    expect(result.success).toBe(true);
    expect(result.npcName).toBe("Gareth the Innkeeper");
    expect(result.disposition).toBe(10); // Started at 0, +10 = 10
    expect(result.dispositionLabel).toBe("neutral"); // 10 is still neutral (>10 is friendly)
    expect(result.reply).toBe("\"A generous gift! Thank you, friend.\"");

    // Check item removed from inventory
    const finalState = await getGameState(gameId);
    expect(finalState!.inventory).not.toContain("a shiny coin");
  });

  it("give_item_to_npc should fail if item not in inventory", async () => {
    const { createGame, giveItemToNPC, moveCharacter } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;
    await moveCharacter(gameId, "east");
    await moveCharacter(gameId, "east");
    await moveCharacter(gameId, "north");

    const mockGenerateReply = vi.fn().mockResolvedValue("Thanks!");

    const result = await giveItemToNPC(gameId, "Gareth the Innkeeper", "nonexistent item", mockGenerateReply);

    expect(result.success).toBe(false);
    expect(result.message).toContain("don't have");
  });

  it("PERSISTENCE: NPC memory and disposition survive database reinitialization", async () => {
    const { 
      createGame, 
      talkToNPC, 
      giveItemToNPC, 
      getNPCMemory, 
      getNPCByName,
      moveCharacter,
      initializeDatabase,
      pickUpItem
    } = await import("../src/db/repository.js");
    
    const state = await createGame("PersistentHero");
    const gameId = state.gameId;
    
    // Go to tavern
    await moveCharacter(gameId, "east");
    await moveCharacter(gameId, "east");
    await moveCharacter(gameId, "north");
    
    // Pick up item to give (character starts with rusty dagger, so pick up something else)
    await pickUpItem(gameId, "a shiny coin");
    
    // Talk to NPC
    const mockReply = vi.fn().mockResolvedValue("\"Welcome, traveler.\"");
    await talkToNPC(gameId, "Gareth the Innkeeper", "Hello there!", mockReply);
    
    // Give item to NPC (raises disposition by 10)
    const mockReply2 = vi.fn().mockResolvedValue("\"Much obliged!\"");
    await giveItemToNPC(gameId, "Gareth the Innkeeper", "a shiny coin", mockReply2);
    
    // Verify state before restart
    let memory = await getNPCMemory(gameId, 1); // Gareth is NPC id 1
    expect(memory.length).toBe(4); // player line, NPC reply, player gave item, NPC reply
    
    let npc = await getNPCByName("Gareth the Innkeeper");
    const dispositionBeforeRestart = npc!.disposition;
    expect(dispositionBeforeRestart).toBeGreaterThan(0);
    
    // Reinitialize database (simulates server restart)
    await initializeDatabase();
    
    // Verify state persisted after restart
    memory = await getNPCMemory(gameId, 1);
    expect(memory.length).toBe(4);
    
    npc = await getNPCByName("Gareth the Innkeeper");
    expect(npc!.disposition).toBe(dispositionBeforeRestart); // Disposition persisted!
  });

  it("talk_to should fail if NPC not at current location", async () => {
    const { createGame, talkToNPC } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;
    // Player at crossroads (location 1), Gareth is at tavern (location 7)

    const mockReply = vi.fn().mockResolvedValue("Hello");
    const result = await talkToNPC(gameId, "Gareth the Innkeeper", "Hello", mockReply);

    expect(result.success).toBe(false);
    expect(result.message).toContain("isn't here");
  });

  it("talk_to should fail for unknown NPC", async () => {
    const { createGame, talkToNPC } = await import("../src/db/repository.js");
    
    const state = await createGame("TestHero");
    const gameId = state.gameId;

    const mockReply = vi.fn().mockResolvedValue("Hello");
    const result = await talkToNPC(gameId, "Unknown NPC", "Hello", mockReply);

    expect(result.success).toBe(false);
    expect(result.message).toContain("no one named");
  });
});