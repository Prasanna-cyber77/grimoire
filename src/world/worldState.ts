import { getDatabase, persistDatabase } from "../db/database.js";

export interface WorldState {
    turnCounter: number;
    threatLevel: number;
    lastPlayed: string;
}

export interface OngoingSituation {
    id: number;
    name: string;
    description: string;
    countdown: number;
    effectType: string;
    effectData: any;
}

export interface WorldEvent {
    id: number;
    turnNumber: number;
    eventType: string;
    description: string;
    createdAt: string;
}

export interface FiredEvent {
    situationName: string;
    eventType: string;
    description: string;
    effects: any;
}

export interface RecapResult {
    recap: string;
    firedEvents: FiredEvent[];
    newWorldState: WorldState;
    ticksAdvanced: number;
}

function getEnvNumber(name: string, defaultValue: number): number {
    const val = process.env[name];
    if (val === undefined) return defaultValue;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

export function getWorldTickSeconds(): number {
    return getEnvNumber("WORLD_TICK_SECONDS", 3600);
}

export function getMaxTicksPerResume(): number {
    return getEnvNumber("MAX_TICKS_PER_RESUME", 100);
}

async function ensureWorldStateInitialized(gameId: number): Promise<void> {
    const db = await getDatabase();
    const existing = db.exec("SELECT 1 FROM world_state WHERE game_id = ?", [gameId]);
    if (existing.length === 0 || existing[0].values.length === 0) {
        const now = new Date().toISOString();
        db.run("INSERT INTO world_state (game_id, turn_counter, threat_level, last_played) VALUES (?, 0, 0, ?)", [gameId, now]);
        seedDefaultSituations(db, gameId);
        persistDatabase();
    }
}

function seedDefaultSituations(db: any, gameId: number): void {
    const situations = [
        {
            name: "Bandits march on the village",
            description: "A band of brigands has been spotted approaching the village. They will arrive and make their presence known.",
            countdown: 5,
            effectType: "bandits_arrive",
            effectData: JSON.stringify({ threatIncrease: 3, locationId: 3, npcName: "Captain Varek", dispositionChange: -10 })
        },
        {
            name: "A grateful merchant prepares a reward",
            description: "A merchant you helped is preparing a token of gratitude. It will be ready for collection soon.",
            countdown: 3,
            effectType: "merchant_reward",
            effectData: JSON.stringify({ itemName: "Merchant's Token", locationId: 5, npcName: "Gareth the Innkeeper", dispositionChange: 5 })
        }
    ];
    const stmt = db.prepare("INSERT INTO ongoing_situations (game_id, name, description, countdown, effect_type, effect_data) VALUES (?, ?, ?, ?, ?, ?)");
    for (const s of situations) {
        stmt.run([gameId, s.name, s.description, s.countdown, s.effectType, s.effectData]);
    }
    stmt.free();
}

export async function getWorldState(gameId: number): Promise<{
    worldState: WorldState;
    situations: OngoingSituation[];
    recentEvents: WorldEvent[];
}> {
    const db = await getDatabase();
    await ensureWorldStateInitialized(gameId);

    const wsResult = db.exec("SELECT turn_counter, threat_level, last_played FROM world_state WHERE game_id = ?", [gameId]);
    const worldState: WorldState = {
        turnCounter: wsResult[0].values[0][0],
        threatLevel: wsResult[0].values[0][1],
        lastPlayed: wsResult[0].values[0][2]
    };

    const sitResult = db.exec(
        "SELECT id, name, description, countdown, effect_type, effect_data FROM ongoing_situations WHERE game_id = ? ORDER BY countdown ASC",
        [gameId]
    );
    const situations: OngoingSituation[] = sitResult[0]?.values?.map((row: any) => ({
        id: row[0],
        name: row[1],
        description: row[2],
        countdown: row[3],
        effectType: row[4],
        effectData: JSON.parse(row[5])
    })) || [];

    const evtResult = db.exec(
        "SELECT id, turn_number, event_type, description, created_at FROM world_events WHERE game_id = ? ORDER BY turn_number DESC LIMIT 20",
        [gameId]
    );
    const recentEvents: WorldEvent[] = evtResult[0]?.values?.map((row: any) => ({
        id: row[0],
        turnNumber: row[1],
        eventType: row[2],
        description: row[3],
        createdAt: row[4]
    })) || [];

    return { worldState, situations, recentEvents };
}

async function applySituationEffect(db: any, gameId: number, situation: OngoingSituation, turnCounter: number): Promise<FiredEvent> {
    const effectData = situation.effectData;
    let description = "";
    const effects: any = {};

    switch (situation.effectType) {
        case "bandits_arrive": {
            const threatIncrease = effectData.threatIncrease || 3;
            db.run("UPDATE world_state SET threat_level = threat_level + ? WHERE game_id = ?", [threatIncrease, gameId]);
            effects.threatLevelChange = threatIncrease;

            const locationId = effectData.locationId || 3;
            const banditText = "\n\nBandit campfires glow in the distance beyond the palisade. The air smells of smoke and threat.";
            db.run("UPDATE locations SET description = description || ? WHERE id = ?", [banditText, locationId]);
            effects.locationUpdated = locationId;

            const npcName = effectData.npcName || "Captain Varek";
            const dispositionChange = effectData.dispositionChange || -10;
            db.run("UPDATE npcs SET disposition = disposition + ? WHERE name = ?", [dispositionChange, npcName]);
            effects.npcDispositionChange = { npc: npcName, change: dispositionChange };

            description = `Bandits have arrived at the village gate. Threat level increased by ${threatIncrease}. ${npcName}'s disposition changed by ${dispositionChange}.`;
            break;
        }
        case "merchant_reward": {
            const itemName = effectData.itemName || "Merchant's Token";
            db.run("INSERT INTO inventory (game_id, item_name) VALUES (?, ?)", [gameId, itemName]);
            effects.itemGranted = itemName;

            const locationId = effectData.locationId || 5;
            const rewardText = `\n\nA small parcel awaits collection at the merchant's stall — ${itemName}.`;
            db.run("UPDATE locations SET description = description || ? WHERE id = ?", [rewardText, locationId]);
            effects.locationUpdated = locationId;

            const npcName = effectData.npcName || "Gareth the Innkeeper";
            const dispositionChange = effectData.dispositionChange || 5;
            db.run("UPDATE npcs SET disposition = disposition + ? WHERE name = ?", [dispositionChange, npcName]);
            effects.npcDispositionChange = { npc: npcName, change: dispositionChange };

            description = `A reward (${itemName}) has been left for collection at the village square. ${npcName}'s disposition changed by ${dispositionChange}.`;
            break;
        }
        default:
            description = `Unknown situation effect: ${situation.effectType}`;
    }

    db.run(
        "INSERT INTO world_events (game_id, turn_number, event_type, description) VALUES (?, ?, ?, ?)",
        [gameId, turnCounter, situation.effectType, description]
    );

    return {
        situationName: situation.name,
        eventType: situation.effectType,
        description,
        effects
    };
}

export async function advanceWorld(gameId: number, ticks: number): Promise<{
    firedEvents: FiredEvent[];
    worldState: WorldState;
}> {
    if (ticks <= 0) {
        const state = await getWorldState(gameId);
        return { firedEvents: [], worldState: state.worldState };
    }

    const db = await getDatabase();
    await ensureWorldStateInitialized(gameId);

    const allFiredEvents: FiredEvent[] = [];

    for (let i = 0; i < ticks; i++) {
        const wsResult = db.exec("SELECT turn_counter, threat_level FROM world_state WHERE game_id = ?", [gameId]);
        const currentTurn = wsResult[0].values[0][0];
        const newTurn = currentTurn + 1;

        db.run("UPDATE world_state SET turn_counter = ? WHERE game_id = ?", [newTurn, gameId]);

        const sitResult = db.exec(
            "SELECT id, name, description, countdown, effect_type, effect_data FROM ongoing_situations WHERE game_id = ? AND countdown > 0",
            [gameId]
        );
        const activeSituations: OngoingSituation[] = sitResult[0]?.values?.map((row: any) => ({
            id: row[0],
            name: row[1],
            description: row[2],
            countdown: row[3],
            effectType: row[4],
            effectData: JSON.parse(row[5])
        })) || [];

        for (const situation of activeSituations) {
            const newCountdown = situation.countdown - 1;
            if (newCountdown <= 0) {
                const firedEvent = await applySituationEffect(db, gameId, situation, newTurn);
                allFiredEvents.push(firedEvent);
                db.run("DELETE FROM ongoing_situations WHERE id = ?", [situation.id]);
            } else {
                db.run("UPDATE ongoing_situations SET countdown = ? WHERE id = ?", [newCountdown, situation.id]);
            }
        }
    }

    const now = new Date().toISOString();
    db.run("UPDATE world_state SET last_played = ? WHERE game_id = ?", [now, gameId]);
    persistDatabase();

    const finalStateResult = db.exec("SELECT turn_counter, threat_level, last_played FROM world_state WHERE game_id = ?", [gameId]);
    const worldState: WorldState = {
        turnCounter: finalStateResult[0].values[0][0],
        threatLevel: finalStateResult[0].values[0][1],
        lastPlayed: finalStateResult[0].values[0][2]
    };

    return { firedEvents: allFiredEvents, worldState };
}

export async function resumeGame(gameId: number): Promise<RecapResult> {
    const db = await getDatabase();
    await ensureWorldStateInitialized(gameId);

    const wsResult = db.exec("SELECT last_played FROM world_state WHERE game_id = ?", [gameId]);
    const lastPlayedStr = wsResult[0].values[0][0];
    const lastPlayed = new Date(lastPlayedStr).getTime();
    const now = Date.now();
    const elapsedSeconds = (now - lastPlayed) / 1000;
    const ticksToAdvance = Math.floor(elapsedSeconds / getWorldTickSeconds());
    const cappedTicks = Math.min(ticksToAdvance, getMaxTicksPerResume());

    if (cappedTicks <= 0) {
        const state = await getWorldState(gameId);
        return {
            recap: "No time has passed since you were last here. The world waits, unchanged.",
            firedEvents: [],
            newWorldState: state.worldState,
            ticksAdvanced: 0
        };
    }

    const { firedEvents, worldState } = await advanceWorld(gameId, cappedTicks);

    let recap: string;
    if (firedEvents.length > 0) {
        const context = {
            firedEvents,
            ticksElapsed: cappedTicks,
            previousTurn: worldState.turnCounter - cappedTicks,
            newTurn: worldState.turnCounter,
            threatLevel: worldState.threatLevel
        };
        recap = await generateWhileYouWereAwayRecap(context);
    } else {
        recap = `You were away for ${cappedTicks} tick${cappedTicks !== 1 ? "s" : ""}. The world turned, but no major events occurred.`;
    }

    return {
        recap,
        firedEvents,
        newWorldState: worldState,
        ticksAdvanced: cappedTicks
    };
}

interface RecapContext {
    firedEvents: FiredEvent[];
    ticksElapsed: number;
    previousTurn: number;
    newTurn: number;
    threatLevel: number;
}

async function generateWhileYouWereAwayRecap(context: RecapContext): Promise<string> {
    const config = {
        enabled: process.env.NARRATION_ENABLED !== "false",
        region: process.env.AWS_REGION || "us-east-1",
        modelId: process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-sonnet-20240229-v1:0"
    };

    if (!config.enabled) {
        return fallbackRecap(context);
    }

    const hasCreds = !!(process.env.AWS_ACCESS_KEY_ID ||
        process.env.AWS_SECRET_ACCESS_KEY ||
        process.env.AWS_SESSION_TOKEN ||
        process.env.AWS_PROFILE ||
        process.env.AWS_ROLE_ARN);

    if (!hasCreds) {
        console.warn("[World Recap] AWS credentials not configured, falling back to deterministic text");
        return fallbackRecap(context);
    }

    try {
        const systemPrompt = buildRecapSystemPrompt();
        const userPrompt = buildRecapUserPrompt(context);
        const { BedrockRuntimeClient, InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");
        const client = new BedrockRuntimeClient({ region: config.region });
        const body = JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 300,
            temperature: 0.7,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }]
        });
        const command = new InvokeModelCommand({
            modelId: config.modelId,
            body: new TextEncoder().encode(body),
            contentType: "application/json",
            accept: "application/json"
        });
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.content[0]?.text?.trim() || fallbackRecap(context);
    } catch (error) {
        console.warn("[World Recap] Bedrock call failed, falling back:", error instanceof Error ? error.message : String(error));
        return fallbackRecap(context);
    }
}

function buildRecapSystemPrompt(): string {
    return `You are a Dungeon Master giving a "While You Were Away" recap to a player returning to a tabletop RPG.
The world has advanced deterministically while they were gone. Your job is to narrate the events that occurred in a vivid, immersive second-person style (2-4 sentences).
You are given a structured list of events that fired. DO NOT invent new events or contradict the facts.
Each event includes its effects (threat level changes, items granted, NPC disposition changes, location updates).
Weave these facts into a cohesive narrative. Present tense. Second person ("You..."). No meta-commentary.`;
}

function buildRecapUserPrompt(context: RecapContext): string {
    const { firedEvents, ticksElapsed, previousTurn, newTurn, threatLevel } = context;
    let prompt = `WORLD STATE:
- Turn advanced from ${previousTurn} to ${newTurn} (${ticksElapsed} tick${ticksElapsed !== 1 ? "s" : ""} elapsed)
- Current threat level: ${threatLevel}/10

EVENTS THAT FIRED WHILE YOU WERE AWAY:
`;
    for (const event of firedEvents) {
        prompt += `- ${event.situationName}: ${event.description}\n`;
        if (Object.keys(event.effects).length > 0) {
            prompt += `  Effects: ${JSON.stringify(event.effects)}\n`;
        }
    }
    prompt += `\nWrite a "While you were away..." recap (2-4 sentences, second person, present tense).`;
    return prompt;
}

function fallbackRecap(context: RecapContext): string {
    const { firedEvents, ticksElapsed } = context;
    if (firedEvents.length === 0) {
        return `You were away for ${ticksElapsed} tick${ticksElapsed !== 1 ? "s" : ""}. The world turned, but no major events occurred.`;
    }
    let recap = `While you were away (${ticksElapsed} tick${ticksElapsed !== 1 ? "s" : ""} passed):\n`;
    for (const event of firedEvents) {
        recap += `- ${event.situationName}: ${event.description}\n`;
    }
    return recap.trim();
}