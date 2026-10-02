import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

let db: Database | null = null;
let dbPath: string | null = null;
let SQL: any = null;

async function ensureSqlJs(): Promise<any> {
  if (SQL) return SQL;
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const sqlJs = await initSqlJs({ locateFile: () => wasmPath });
  SQL = sqlJs.Database;
  return SQL;
}

export async function initDatabase(customPath?: string): Promise<Database> {
  if (db) {
    return db;
  }

  dbPath = customPath || process.env.DB_PATH || "./data/grimoire.db";

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const DbClass = await ensureSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new DbClass(new Uint8Array(fileBuffer));
  } else {
    db = new DbClass();
    initializeSchema(db!);
    persistDatabase();
  }

  return db!;
}

function initializeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS characters (
      game_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      hp_current INTEGER NOT NULL,
      hp_max INTEGER NOT NULL,
      strength INTEGER NOT NULL,
      wits INTEGER NOT NULL,
      charm INTEGER NOT NULL,
      current_location_id INTEGER NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id),
      FOREIGN KEY (current_location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      exits TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id)
    );

    CREATE TABLE IF NOT EXISTS story_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      entry TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id)
    );
  `);

  const locationCount = db.exec("SELECT COUNT(*) as count FROM locations")[0]?.values[0]?.[0] || 0;
  if (locationCount === 0) {
    seedLocations(db);
  }
}

function seedLocations(db: Database): void {
  const locations = [
    {
      id: 1,
      name: "crossroads",
      description: "You stand at a crossroads outside a sleeping village. A dirt road forks north into dark woods and east toward flickering torchlight.",
      exits: JSON.stringify({ north: 2, east: 3 })
    },
    {
      id: 2,
      name: "dark_woods",
      description: "Ancient trees loom overhead, their branches weaving a canopy that blocks out the moonlight. The path winds deeper into shadows to the north, while the crossroads lies to the south.",
      exits: JSON.stringify({ south: 1, north: 4 })
    },
    {
      id: 3,
      name: "village_gate",
      description: "A wooden palisade surrounds the sleeping village. Torches flicker on the gateposts. The main street leads east into the village square, while the crossroads is back to the west.",
      exits: JSON.stringify({ west: 1, east: 5 })
    },
    {
      id: 4,
      name: "ancient_clearing",
      description: "A clearing in the deep woods where ancient standing stones form a circle. Strange energy hums in the air. The path continues north to a dark cave, while the woods lie south.",
      exits: JSON.stringify({ south: 2, north: 6 })
    },
    {
      id: 5,
      name: "village_square",
      description: "The heart of the village. A well sits in the center, surrounded by shuttered cottages. The tavern's warm light spills from its doorway to the north. The gate lies west.",
      exits: JSON.stringify({ west: 3, north: 7 })
    },
    {
      id: 6,
      name: "dark_cave",
      description: "A yawning cave mouth opens into darkness. Faint dripping echoes from within. The clearing is back to the south.",
      exits: JSON.stringify({ south: 4 })
    },
    {
      id: 7,
      name: "tavern",
      description: "The village tavern, warm and smelling of ale and roasting meat. A fire crackles in the hearth. The village square is back to the south.",
      exits: JSON.stringify({ south: 5 })
    }
  ];

  const stmt = db.prepare("INSERT INTO locations (id, name, description, exits) VALUES (?, ?, ?, ?)");
  for (const loc of locations) {
    stmt.run([loc.id, loc.name, loc.description, loc.exits]);
  }
  stmt.free();
}

export async function getDatabase(): Promise<Database> {
  if (!db) {
    return initDatabase();
  }
  return db;
}

export function persistDatabase(): void {
  if (db && dbPath) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

export function closeDatabase(): void {
  if (db) {
    persistDatabase();
    db.close();
    db = null;
  }
}

export function getDbPath(): string | null {
  return dbPath;
}