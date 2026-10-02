import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export interface NarrationContext {
  location: {
    name: string;
    description: string;
    exits: string[];
  };
  event: {
    type: "move" | "look" | "roll_check" | "pick_up" | "drop" | "describe_scene";
    description: string;
    success?: boolean;
  };
  character: {
    name: string;
    hp_current: number;
    hp_max: number;
    strength: number;
    wits: number;
    charm: number;
  };
  recentLog: string[];
}

export interface NPCReplyContext {
  npc: {
    id: number;
    name: string;
    home_location_id: number;
    personality: string;
    disposition: number;
  };
  character: {
    name: string;
    hp_current: number;
    hp_max: number;
    strength: number;
    wits: number;
    charm: number;
  };
  location: {
    id: number;
    name: string;
    description: string;
    exits: Record<string, number>;
  };
  playerLine: string;
  memorySummary: string;
  recentLog: string[];
}

export interface NarratorConfig {
  enabled: boolean;
  region: string;
  modelId: string;
}

function getConfig(): NarratorConfig {
  return {
    enabled: process.env.NARRATION_ENABLED !== "false",
    region: process.env.AWS_REGION || "us-east-1",
    modelId: process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-sonnet-20240229-v1:0",
  };
}

function hasCredentials(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.AWS_SESSION_TOKEN ||
    process.env.AWS_PROFILE ||
    process.env.AWS_ROLE_ARN
  );
}

function buildSystemPrompt(): string {
  return `You are a Dungeon Master narrating a tabletop RPG. 
Your ONLY job is to write vivid, immersive second-person narration (2-3 sentences) around the FACTS provided in the context.
NEVER invent, imply, or contradict any of the following:
- Location names, descriptions, or exits
- Character stats, HP, inventory
- Outcomes of dice rolls (success/failure, exact totals)
- Items picked up or dropped
- Story log events

If the context says "you moved north to dark_woods", you narrate the journey.
If the context says "strength check: rolled 14 + 1 = 15 vs DC 12 (success)", you describe the successful feat.
If the context says "you picked up a rusty dagger", you describe picking it up.
Keep it to 2-3 sentences. Second person ("You..."). Present tense. No meta-commentary.`;
}

function buildNPCSystemPrompt(): string {
  return `You are an NPC in a tabletop RPG. Speak in character as the NPC described.
Your reply MUST reflect:
- Your personality and disposition toward the player
- Your memory of past interactions with this player (provided in context)
- Current game state (location, player stats)
- NEVER contradict established facts or invent new game mechanics
- NEVER change your disposition score - that is handled by game rules
- Keep replies to 2-3 sentences. First person ("I...", "My..."). Present tense. No meta-commentary.

Disposition guide:
- hostile (-100 to -50): Openly threatening, insulting, or violent
- wary (-49 to -10): Suspicious, curt, uncooperative
- neutral (-9 to 9): Guarded but polite, transactional
- friendly (10 to 50): Warm, helpful, shares information freely
- ally (51 to 100): Loyal, protective, goes out of their way to help`;
}

function buildUserPrompt(context: NarrationContext): string {
  const { location, event, character, recentLog } = context;

  let prompt = `CURRENT LOCATION: ${location.name}
DESCRIPTION: ${location.description}
EXITS: ${location.exits.join(", ")}

CHARACTER: ${character.name} (HP: ${character.hp_current}/${character.hp_max}, STR: ${character.strength}, WIT: ${character.wits}, CHA: ${character.charm})

EVENT: ${event.type.toUpperCase()}
${event.description}
`;

  if (event.success !== undefined) {
    prompt += `OUTCOME: ${event.success ? "SUCCESS" : "FAILURE"}\n`;
  }

  if (recentLog.length > 0) {
    prompt += `\nRECENT HISTORY:\n${recentLog.slice(-3).map((e) => `- ${e}`).join("\n")}\n`;
  }

  prompt += `\nWrite 2-3 sentences of vivid second-person narration for this moment.`;

  return prompt;
}

function buildNPCUserPrompt(context: NPCReplyContext): string {
  const { npc, character, location, playerLine, memorySummary, recentLog } = context;

  let dispositionLabel = "neutral";
  if (npc.disposition <= -50) dispositionLabel = "hostile";
  else if (npc.disposition <= -10) dispositionLabel = "wary";
  else if (npc.disposition <= 10) dispositionLabel = "neutral";
  else if (npc.disposition <= 50) dispositionLabel = "friendly";
  else dispositionLabel = "ally";

  let prompt = `NPC: ${npc.name}
PERSONALITY: ${npc.personality}
DISPOSITION: ${npc.disposition} (${dispositionLabel})
HOME LOCATION: ${location.name}

PLAYER: ${character.name} (HP: ${character.hp_current}/${character.hp_max}, STR: ${character.strength}, WIT: ${character.wits}, CHA: ${character.charm})
CURRENT LOCATION: ${location.name} - ${location.description}

PLAYER SAYS: "${playerLine}"

MEMORY WITH THIS PLAYER:`;
  
  if (memorySummary) {
    prompt += `\n${memorySummary}`;
  } else {
    prompt += `\n(No prior interactions)`;
  }

  if (recentLog.length > 0) {
    prompt += `\n\nRECENT EVENTS:\n${recentLog.slice(-3).map((e) => `- ${e}`).join("\n")}`;
  }

  prompt += `\n\nReply as ${npc.name} in character (2-3 sentences).`;

  return prompt;
}

async function callBedrock(prompt: string, systemPrompt: string, config: NarratorConfig): Promise<string> {
  const client = new BedrockRuntimeClient({ region: config.region });

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 200,
    temperature: 0.7,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  const command = new InvokeModelCommand({
    modelId: config.modelId,
    body: new TextEncoder().encode(body),
    contentType: "application/json",
    accept: "application/json",
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content[0]?.text?.trim() || "";
}

export async function narrate(context: NarrationContext): Promise<string> {
  const config = getConfig();

  if (!config.enabled) {
    return fallbackNarration(context);
  }

  if (!hasCredentials()) {
    console.warn("[Narrator] AWS credentials not configured, falling back to deterministic text");
    return fallbackNarration(context);
  }

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(context);
    const narration = await callBedrock(userPrompt, systemPrompt, config);
    return narration;
  } catch (error) {
    console.warn("[Narrator] Bedrock call failed, falling back:", error instanceof Error ? error.message : String(error));
    return fallbackNarration(context);
  }
}

export async function generateNPCReply(context: NPCReplyContext): Promise<string> {
  const config = getConfig();

  if (!config.enabled) {
    return fallbackNPCReply(context);
  }

  if (!hasCredentials()) {
    console.warn("[Narrator] AWS credentials not configured, falling back to deterministic NPC reply");
    return fallbackNPCReply(context);
  }

  try {
    const systemPrompt = buildNPCSystemPrompt();
    const userPrompt = buildNPCUserPrompt(context);
    const reply = await callBedrock(userPrompt, systemPrompt, config);
    return reply;
  } catch (error) {
    console.warn("[Narrator] Bedrock NPC call failed, falling back:", error instanceof Error ? error.message : String(error));
    return fallbackNPCReply(context);
  }
}

function fallbackNarration(context: NarrationContext): string {
  const { location, event, character } = context;

  switch (event.type) {
    case "move":
      return `You travel ${event.description.replace("Moved ", "").replace(" to ", " toward ")}. ${location.description}`;
    case "look":
      return `You look around. ${location.description} Exits lead ${location.exits.join(", ")}.`;
    case "roll_check":
      const outcome = event.success ? "succeed" : "fail";
      return `You ${outcome} at the ${event.description.toLowerCase()}. ${character.name} watches the dice settle.`;
    case "pick_up":
      return `You pick up ${event.description.replace("Picked up ", "")}. It joins your inventory.`;
    case "drop":
      return `You drop ${event.description.replace("Dropped ", "")}. It lands at your feet.`;
    case "describe_scene":
      return location.description;
    default:
      return event.description;
  }
}

function fallbackNPCReply(context: NPCReplyContext): string {
  const { npc, playerLine } = context;
  
  let dispositionLabel = "neutral";
  if (npc.disposition <= -50) dispositionLabel = "hostile";
  else if (npc.disposition <= -10) dispositionLabel = "wary";
  else if (npc.disposition <= 10) dispositionLabel = "neutral";
  else if (npc.disposition <= 50) dispositionLabel = "friendly";
  else dispositionLabel = "ally";

  const responses: Record<string, string[]> = {
    hostile: [
      `"Begone, ${context.character.name}. Your presence offends me."`,
      `"I've no time for the likes of you. Leave my sight."`,
      `"Don't test my patience, outsider."`
    ],
    wary: [
      `"What do you want? Speak quickly."`,
      `"I don't know you. Why should I trust you?"`,
      `"Hmph. Another stranger with an agenda."`
    ],
    neutral: [
      `"Can I help you with something?"`,
      `"You're new here, aren't you? What brings you to ${context.location.name}?"`,
      `"Well met, traveler. What's on your mind?"`
    ],
    friendly: [
      `"Ah, ${context.character.name}! Good to see you again. What can I do for you?"`,
      `"Welcome back! You're always welcome here."`,
      `"It's a fine day, isn't it? How may I assist?"`
    ],
    ally: [
      `"${context.character.name}! My dear friend! Anything you need, it's yours."`,
      `"I'd walk through fire for you. What do you need?"`,
      `"You've earned my trust a hundred times over. Name it."`
    ]
  };

  const options = responses[dispositionLabel] || responses.neutral;
  return options[Math.floor(Math.random() * options.length)];
}