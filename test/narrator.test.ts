import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  return {
    BedrockRuntimeClient: vi.fn(() => ({
      send: mockSend,
    })),
    InvokeModelCommand: vi.fn((args) => args),
  };
});

describe("narrator", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    process.env.NARRATION_ENABLED = "true";
    process.env.AWS_REGION = "us-east-1";
    process.env.BEDROCK_MODEL_ID = "test-model";
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
  });

  afterEach(() => {
    delete process.env.NARRATION_ENABLED;
    delete process.env.AWS_REGION;
    delete process.env.BEDROCK_MODEL_ID;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  it("should call Bedrock with correct context for move event", async () => {
    const { narrate } = await import("../src/ai/narrator.js");

    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({
        content: [{ text: "You stride confidently northward into the dark woods, the ancient trees closing around you." }]
      }))
    });

    const context = {
      location: {
        name: "dark_woods",
        description: "Ancient trees loom overhead...",
        exits: ["south", "north"],
      },
      event: {
        type: "move" as const,
        description: "Moved north to dark_woods",
        success: true,
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      recentLog: ["Game started. TestHero begins their journey at the crossroads."],
    };

    const result = await narrate(context);

    expect(result).toBe("You stride confidently northward into the dark woods, the ancient trees closing around you.");
    expect(mockSend).toHaveBeenCalledTimes(1);
    
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs).toBeDefined();
    expect(callArgs.modelId).toBe("test-model");
    const body = JSON.parse(new TextDecoder().decode(callArgs.body));
    expect(body.messages[0].content).toContain("Moved north to dark_woods");
    expect(body.messages[0].content).toContain("dark_woods");
    expect(body.messages[0].content).toContain("TestHero");
  });

  it("should call Bedrock with correct context for roll_check event", async () => {
    const { narrate } = await import("../src/ai/narrator.js");

    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({
        content: [{ text: "Your blade flashes true, the goblin's guard crumbling before your might." }]
      }))
    });

    const context = {
      location: {
        name: "crossroads",
        description: "You stand at a crossroads...",
        exits: ["north", "east"],
      },
      event: {
        type: "roll_check" as const,
        description: "strength check: rolled 14 + 1 = 15 vs 12",
        success: true,
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      recentLog: [],
    };

    const result = await narrate(context);

    expect(result).toBe("Your blade flashes true, the goblin's guard crumbling before your might.");
    expect(mockSend).toHaveBeenCalledTimes(1);
    
    const callArgs = mockSend.mock.calls[0][0];
    const body = JSON.parse(new TextDecoder().decode(callArgs.body));
    expect(body.messages[0].content).toContain("strength check");
    expect(body.messages[0].content).toContain("14 + 1 = 15");
    expect(body.messages[0].content).toContain("vs 12");
  });

  it("should return fallback narration when NARRATION_ENABLED is false", async () => {
    process.env.NARRATION_ENABLED = "false";
    
    const { narrate } = await import("../src/ai/narrator.js");

    const context = {
      location: {
        name: "crossroads",
        description: "You stand at a crossroads...",
        exits: ["north", "east"],
      },
      event: {
        type: "move" as const,
        description: "Moved north to dark_woods",
        success: true,
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      recentLog: [],
    };

    const result = await narrate(context);

    expect(result).toContain("You travel north toward dark_woods");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("should return fallback narration when credentials are missing", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    
    const { narrate } = await import("../src/ai/narrator.js");

    const context = {
      location: {
        name: "crossroads",
        description: "You stand at a crossroads...",
        exits: ["north", "east"],
      },
      event: {
        type: "look" as const,
        description: "You look around",
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      recentLog: [],
    };

    const result = await narrate(context);

    expect(result).toContain("You look around");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("should return fallback narration when Bedrock call throws", async () => {
    const { narrate } = await import("../src/ai/narrator.js");

    mockSend.mockRejectedValue(new Error("Bedrock unavailable"));

    const context = {
      location: {
        name: "crossroads",
        description: "You stand at a crossroads...",
        exits: ["north", "east"],
      },
      event: {
        type: "pick_up" as const,
        description: "Picked up a shiny coin",
        success: true,
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      recentLog: [],
    };

    const result = await narrate(context);

    expect(result).toContain("You pick up a shiny coin");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("generateNPCReply", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    process.env.NARRATION_ENABLED = "true";
    process.env.AWS_REGION = "us-east-1";
    process.env.BEDROCK_MODEL_ID = "test-model";
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
  });

  afterEach(() => {
    delete process.env.NARRATION_ENABLED;
    delete process.env.AWS_REGION;
    delete process.env.BEDROCK_MODEL_ID;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  it("should call Bedrock with NPC context including memory summary", async () => {
    const { generateNPCReply } = await import("../src/ai/narrator.js");

    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({
        content: [{ text: "\"Ah, TestHero! Good to see you again. What brings you to my tavern?\"" }]
      }))
    });

    const context = {
      npc: {
        id: 1,
        name: "Gareth the Innkeeper",
        home_location_id: 7,
        personality: "A jovial, rotund man with a booming laugh and a stained apron.",
        disposition: 20
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      location: {
        id: 7,
        name: "tavern",
        description: "The village tavern, warm and smelling of ale.",
        exits: { south: 5 }
      },
      playerLine: "Hello there!",
      memorySummary: "Player said: \"Hello\"; Gareth the Innkeeper replied: \"Welcome!\"",
      recentLog: ["Moved east to village_square"]
    };

    const result = await generateNPCReply(context);

    expect(result).toBe("\"Ah, TestHero! Good to see you again. What brings you to my tavern?\"");
    expect(mockSend).toHaveBeenCalledTimes(1);
    
    const callArgs = mockSend.mock.calls[0][0];
    const body = JSON.parse(new TextDecoder().decode(callArgs.body));
    expect(body.messages[0].content).toContain("Gareth the Innkeeper");
    expect(body.messages[0].content).toContain("Player said: \"Hello\"");
    expect(body.messages[0].content).toContain("MEMORY WITH THIS PLAYER");
  });

  it("should call Bedrock with NPC context including prior memory entries", async () => {
    const { generateNPCReply } = await import("../src/ai/narrator.js");

    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({
        content: [{ text: "\"You again? I told you, the woods are no place for wanderers.\"" }]
      }))
    });

    const context = {
      npc: {
        id: 2,
        name: "Old Mara",
        home_location_id: 2,
        personality: "A wizened hermit who lives in a moss-covered hut.",
        disposition: -20
      },
      character: {
        name: "TestHero",
        hp_current: 8,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      location: {
        id: 2,
        name: "dark_woods",
        description: "Ancient trees loom overhead...",
        exits: { south: 1, north: 4 }
      },
      playerLine: "Can you help me find the cave?",
      memorySummary: "Player said: \"Who are you?\"; Old Mara replied: \"None of your business.\"; Player said: \"I meant no offense\"; Old Mara replied: \"Offense is in the eye of the beholder.\"",
      recentLog: ["Moved north to dark_woods"]
    };

    const result = await generateNPCReply(context);

    expect(result).toBe("\"You again? I told you, the woods are no place for wanderers.\"");
    expect(mockSend).toHaveBeenCalledTimes(1);
    
    const callArgs = mockSend.mock.calls[0][0];
    const body = JSON.parse(new TextDecoder().decode(callArgs.body));
    expect(body.messages[0].content).toContain("Old Mara");
    expect(body.messages[0].content).toContain("None of your business");
    expect(body.messages[0].content).toContain("DISPOSITION");
  });

  it("should return fallback NPC reply when NARRATION_ENABLED is false", async () => {
    process.env.NARRATION_ENABLED = "false";
    
    const { generateNPCReply } = await import("../src/ai/narrator.js");

    const context = {
      npc: {
        id: 3,
        name: "Captain Varek",
        home_location_id: 3,
        personality: "A stern, battle-scarred guard captain.",
        disposition: 0
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      location: {
        id: 3,
        name: "village_gate",
        description: "A wooden palisade surrounds the sleeping village.",
        exits: { west: 1, east: 5 }
      },
      playerLine: "May I pass?",
      memorySummary: "",
      recentLog: []
    };

    const result = await generateNPCReply(context);

    // Should return a neutral fallback response (randomly selected from array)
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("should return disposition-appropriate fallback when credentials missing", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    
    const { generateNPCReply } = await import("../src/ai/narrator.js");

    const context = {
      npc: {
        id: 1,
        name: "Gareth the Innkeeper",
        home_location_id: 7,
        personality: "A jovial innkeeper.",
        disposition: 50
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      location: {
        id: 7,
        name: "tavern",
        description: "The village tavern.",
        exits: { south: 5 }
      },
      playerLine: "I need a room",
      memorySummary: "",
      recentLog: []
    };

    const result = await generateNPCReply(context);

    // Should be friendly/ally response (randomly selected)
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("should return hostile fallback for hostile NPC", async () => {
    process.env.NARRATION_ENABLED = "false";
    
    const { generateNPCReply } = await import("../src/ai/narrator.js");

    const context = {
      npc: {
        id: 2,
        name: "Old Mara",
        home_location_id: 2,
        personality: "A wizened hermit.",
        disposition: -80
      },
      character: {
        name: "TestHero",
        hp_current: 10,
        hp_max: 10,
        strength: 12,
        wits: 10,
        charm: 8,
      },
      location: {
        id: 2,
        name: "dark_woods",
        description: "Ancient trees loom overhead.",
        exits: { south: 1, north: 4 }
      },
      playerLine: "Hello",
      memorySummary: "",
      recentLog: []
    };

    const result = await generateNPCReply(context);

    // Should be hostile response (randomly selected)
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});