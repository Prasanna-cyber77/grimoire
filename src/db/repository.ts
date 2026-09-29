import { getDatabase, persistDatabase, initDatabase } from "./database.js";

export interface Character {
  name: string;
  hp_current: number;
  hp_max: number;
  strength: number;
  wits: number;
  charm: number;
  current_location_id: number;
}

export interface Location {
  id: number;
  name: string;
  description: string;
  exits: Record<string, number>;
}

export interface GameState {
  gameId: number;
  character: Character;
  location: Location;
  inventory: string[];
  storyLog: string[];
}

export interface RollResult {
  roll: number;
  modifier: number;
  total: number;
  difficulty: number;
  success: boolean;
  skill: string;
}

function getStatModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

export async function createGame(characterName: string): Promise<GameState> {
  const db = await getDatabase();

  db.exec("INSERT INTO games DEFAULT VALUES");
  const gameIdResult = db.exec("SELECT last_insert_rowid() as id");
  const gameId = gameIdResult[0].values[0][0] as number;

  const startingLocationId = 1;
  const hpMax = 10;
  const stats = { strength: 12, wits: 10, charm: 8 };

  db.exec(`
    INSERT INTO characters (game_id, name, hp_current, hp_max, strength, wits, charm, current_location_id)
    VALUES (${gameId}, '${characterName.replace(/'/g, "''")}', ${hpMax}, ${hpMax}, ${stats.strength}, ${stats.wits}, ${stats.charm}, ${startingLocationId})
  `);

  db.exec(`
    INSERT INTO inventory (game_id, item_name)
    VALUES (${gameId}, 'a rusty dagger')
  `);

  db.exec(`
    INSERT INTO story_log (game_id, entry)
    VALUES (${gameId}, 'Game started. ${characterName} begins their journey at the crossroads.')
  `);

  persistDatabase();

  const state = await getGameState(gameId);
  if (!state) throw new Error("Failed to create game state");
  return state;
}

export async function getGameState(gameId?: number): Promise<GameState | null> {
  const db = await getDatabase();

  let targetGameId = gameId;
  if (!targetGameId) {
    const result = db.exec("SELECT id FROM games ORDER BY created_at DESC, id DESC LIMIT 1");
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }
    targetGameId = result[0].values[0][0] as number;
  }

  const gameResult = db.exec(`SELECT * FROM games WHERE id = ${targetGameId}`);
  if (gameResult.length === 0 || gameResult[0].values.length === 0) {
    return null;
  }

  const charResult = db.exec(`SELECT * FROM characters WHERE game_id = ${targetGameId}`);
  if (charResult.length === 0 || charResult[0].values.length === 0) {
    return null;
  }

  const charCols = charResult[0].columns;
  const charVals = charResult[0].values[0];
  const character: Character = {
    name: charVals[charCols.indexOf("name")] as string,
    hp_current: charVals[charCols.indexOf("hp_current")] as number,
    hp_max: charVals[charCols.indexOf("hp_max")] as number,
    strength: charVals[charCols.indexOf("strength")] as number,
    wits: charVals[charCols.indexOf("wits")] as number,
    charm: charVals[charCols.indexOf("charm")] as number,
    current_location_id: charVals[charCols.indexOf("current_location_id")] as number
  };

  const locResult = db.exec(`SELECT * FROM locations WHERE id = ${character.current_location_id}`);
  const locCols = locResult[0].columns;
  const locVals = locResult[0].values[0];
  const location: Location = {
    id: locVals[locCols.indexOf("id")] as number,
    name: locVals[locCols.indexOf("name")] as string,
    description: locVals[locCols.indexOf("description")] as string,
    exits: JSON.parse(locVals[locCols.indexOf("exits")] as string)
  };

  const invResult = db.exec(`SELECT item_name FROM inventory WHERE game_id = ${targetGameId}`);
  const inventory = invResult[0]?.values.map((v: any[]) => v[0] as string) || [];

  const logResult = db.exec(`SELECT entry FROM story_log WHERE game_id = ${targetGameId} ORDER BY created_at`);
  const storyLog = logResult[0]?.values.map((v: any[]) => v[0] as string) || [];

  return {
    gameId: targetGameId,
    character,
    location,
    inventory,
    storyLog
  };
}

export async function moveCharacter(gameId: number, direction: string): Promise<{ success: boolean; message: string; location?: Location }> {
  const db = await getDatabase();
  const state = await getGameState(gameId);
  if (!state) {
    return { success: false, message: "Game not found" };
  }

  const exits = state.location.exits;
  const targetLocationId = exits[direction.toLowerCase()];
  if (!targetLocationId) {
    await logEvent(gameId, `Tried to go ${direction} but couldn't.`);
    return { success: false, message: `You can't go ${direction} from here.` };
  }

  db.exec(`UPDATE characters SET current_location_id = ${targetLocationId} WHERE game_id = ${gameId}`);
  db.exec(`UPDATE games SET updated_at = CURRENT_TIMESTAMP WHERE id = ${gameId}`);
  await logEvent(gameId, `Moved ${direction} to ${await getLocationName(targetLocationId)}.`);
  persistDatabase();

  const newState = await getGameState(gameId);
  return { success: true, message: `You travel ${direction}.`, location: newState!.location };
}

async function getLocationName(id: number): Promise<string> {
  const db = await getDatabase();
  const result = db.exec(`SELECT name FROM locations WHERE id = ${id}`);
  return result[0]?.values[0]?.[0] as string || "unknown";
}

export async function lookAround(gameId: number): Promise<{ description: string; exits: string[] }> {
  const state = await getGameState(gameId);
  if (!state) {
    return { description: "Game not found", exits: [] };
  }
  return {
    description: state.location.description,
    exits: Object.keys(state.location.exits)
  };
}

export async function pickUpItem(gameId: number, item: string): Promise<{ success: boolean; message: string }> {
  const db = await getDatabase();
  const state = await getGameState(gameId);
  if (!state) {
    return { success: false, message: "Game not found" };
  }

  if (state.inventory.includes(item)) {
    return { success: false, message: `You already have ${item}.` };
  }

  db.exec(`INSERT INTO inventory (game_id, item_name) VALUES (${gameId}, '${item.replace(/'/g, "''")}')`);
  await logEvent(gameId, `Picked up ${item}.`);
  persistDatabase();

  return { success: true, message: `You pick up ${item}.` };
}

export async function dropItem(gameId: number, item: string): Promise<{ success: boolean; message: string }> {
  const db = await getDatabase();
  const state = await getGameState(gameId);
  if (!state) {
    return { success: false, message: "Game not found" };
  }

  if (!state.inventory.includes(item)) {
    return { success: false, message: `You don't have ${item}.` };
  }

  db.exec(`DELETE FROM inventory WHERE game_id = ${gameId} AND item_name = '${item.replace(/'/g, "''")}'`);
  await logEvent(gameId, `Dropped ${item}.`);
  persistDatabase();

  return { success: true, message: `You drop ${item}.` };
}

export async function rollCheck(gameId: number, skill: string, difficulty: number, rng?: () => number): Promise<RollResult> {
  const state = await getGameState(gameId);
  if (!state) {
    throw new Error("Game not found");
  }

  const skillLower = skill.toLowerCase();
  let statValue = 0;
  if (skillLower === "strength") statValue = state.character.strength;
  else if (skillLower === "wits") statValue = state.character.wits;
  else if (skillLower === "charm") statValue = state.character.charm;
  else {
    throw new Error(`Unknown skill: ${skill}. Use strength, wits, or charm.`);
  }

  const modifier = getStatModifier(statValue);
  const rollFn = rng || (() => Math.floor(Math.random() * 20) + 1);
  const roll = rollFn();
  const total = roll + modifier;
  const success = total >= difficulty;

  await logEvent(gameId, `Rolled ${skill} check: ${roll} + ${modifier} = ${total} vs ${difficulty} (${success ? "success" : "failure"})`);

  return { roll, modifier, total, difficulty, success, skill };
}

async function logEvent(gameId: number, entry: string): Promise<void> {
  const db = await getDatabase();
  db.exec(`INSERT INTO story_log (game_id, entry) VALUES (${gameId}, '${entry.replace(/'/g, "''")}')`);
}

export async function getCurrentSceneDescription(gameId?: number): Promise<string> {
  const state = await getGameState(gameId);
  if (!state) {
    return "No active game. Create one with new_game.";
  }
  return state.location.description;
}

export async function initializeDatabase(customPath?: string): Promise<void> {
  await initDatabase(customPath);
}

export async function getLatestGameId(): Promise<number | null> {
  const db = await getDatabase();
  const result = db.exec("SELECT id FROM games ORDER BY created_at DESC, id DESC LIMIT 1");
  return result[0]?.values[0]?.[0] as number || null;
}