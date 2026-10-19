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