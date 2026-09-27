import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  apiRoutes,
  assignedTasksResponseSchema,
  bagPhotoPath,
  meResponseSchema,
  positionsRequestSchema,
  pushRegisterRequestSchema,
  pushUnregisterRequestSchema,
  sealBagRequestSchema,
  taskDetailResponseSchema,
} from "./index";

/**
 * The contract's own invariants. Parity with core/db enums is asserted in
 * apps/agent (`src/api/contract-parity.test.ts`), which can import core.
 */
describe("api contract", () => {
  it("assigns a status to every error code", () => {
    for (const code of API_ERROR_CODES) {
      expect(API_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it("parses dates as ISO strings the way JSON.stringify emits them", () => {
    const iso = new Date("2026-09-27T12:34:56.000Z").toISOString();
    const parsed = meResponseSchema.parse({
      userId: "6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b",
      email: "agent@koolee.local",
      fullName: null,
      avatarUrl: null,
      avatarStoragePath: null,
      canDrive: true,
      shift: null,
      serverTime: iso,
    });
    expect(parsed.serverTime).toBe(iso);
  });

  it("strips unknown keys so a new column never breaks an installed app", () => {
    const parsed = assignedTasksResponseSchema.parse({
      verification: [],
      pickup: [],
      serverTime: new Date(0).toISOString(),
      somethingNew: 1,
    });
    expect("somethingNew" in parsed).toBe(false);
  });

  it("refuses a seal without a photo, a weight over 99 kg, or a blank seal id", () => {
    const base = {
      bagId: "6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b",
      sealId: "SEAL-1",
      weightKg: 12.5,
      photoPath: "bags/6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b/x.jpg",
    };
    expect(sealBagRequestSchema.safeParse(base).success).toBe(true);
    expect(sealBagRequestSchema.safeParse({ ...base, photoPath: "" }).success).toBe(
      false,
    );
    expect(sealBagRequestSchema.safeParse({ ...base, weightKg: 120 }).success).toBe(
      false,
    );
    expect(sealBagRequestSchema.safeParse({ ...base, sealId: "  " }).success).toBe(false);
  });

  it("accepts one fix or a batch of up to 120 for positions", () => {
    const fix = { lat: 40.7, lng: -74.0 };
    expect(positionsRequestSchema.safeParse(fix).success).toBe(true);
    expect(positionsRequestSchema.safeParse({ fixes: [fix] }).success).toBe(true);
    expect(
      positionsRequestSchema.safeParse({ fixes: Array.from({ length: 121 }, () => fix) })
        .success,
    ).toBe(false);
  });

  it("accepts only Expo-shaped push tokens on either platform, and bounds the label", () => {
    const token = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
    expect(pushRegisterRequestSchema.safeParse({ token, platform: "ios" }).success).toBe(
      true,
    );
    expect(
      pushRegisterRequestSchema.safeParse({
        token: "ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        platform: "android",
        deviceLabel: "Pixel 9",
      }).success,
    ).toBe(true);
    // An FCM registration id, a raw APNs token, and a web platform are all
    // wrong for this route — the server's channel for them is web push.
    expect(
      pushRegisterRequestSchema.safeParse({ token: "fcm:abc", platform: "ios" }).success,
    ).toBe(false);
    expect(pushRegisterRequestSchema.safeParse({ token, platform: "web" }).success).toBe(
      false,
    );
    expect(
      pushRegisterRequestSchema.safeParse({ token, platform: "ios", deviceLabel: "" })
        .success,
    ).toBe(false);
    expect(
      pushRegisterRequestSchema.safeParse({
        token,
        platform: "ios",
        deviceLabel: "x".repeat(121),
      }).success,
    ).toBe(false);
    expect(pushUnregisterRequestSchema.safeParse({ token }).success).toBe(true);
    expect(pushUnregisterRequestSchema.safeParse({ token: "" }).success).toBe(false);
    expect(apiRoutes.pushRegister()).toBe("/api/v1/push/register");
  });

  it("discriminates task detail by kind", () => {
    expect(taskDetailResponseSchema.safeParse({ kind: "verification" }).success).toBe(
      false,
    );
    expect(taskDetailResponseSchema.safeParse({ kind: "nope" }).success).toBe(false);
  });

  it("builds storage keys under the prefix the server verifies", () => {
    expect(bagPhotoPath("bag-1", "obj-1", "image/jpeg")).toBe("bags/bag-1/obj-1.jpg");
    expect(apiRoutes.task("t 1", "pickup")).toBe("/api/v1/tasks/t%201?kind=pickup");
  });
});
