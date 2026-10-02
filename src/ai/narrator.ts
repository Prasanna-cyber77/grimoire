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

function fallbackNarration(context: NarrationContext): string {
  const { location, event, character } = context;

  switch (event.type) {
    case "move":
      return `You travel ${event.description.replace("Moved ", "").replace(" to ", " toward ")}. ${location.description}`;
    case "look":
      return `You look around. ${location.description} Exits lead ${location.exits.join(", ")}.`;
    case "roll_check": {
      const outcome = event.success ? "succeed" : "fail";
      return `You ${outcome} at the ${event.description.toLowerCase()}. ${character.name} watches the dice settle.`;
    }
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