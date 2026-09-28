import { describe, expect, it } from "vitest";

import { shippingEnvProblems } from "../../app.config";

const COMPLETE = {
  EAS_BUILD: "true",
  EAS_BUILD_PROFILE: "preview",
  EXPO_PUBLIC_API_URL: "https://native.dev.agent.koolee.cloud",
  EXPO_PUBLIC_SUPABASE_URL: "https://jpvlzoikcivxepgyrkho.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x",
};

describe("shippingEnvProblems", () => {
  it("lets a complete environment ship", () => {
    expect(shippingEnvProblems(COMPLETE)).toEqual([]);
  });

  it("names every missing value on a shipping profile", () => {
    for (const profile of ["preview", "preview-simulator", "beta", "production"]) {
      expect(
        shippingEnvProblems({ EAS_BUILD: "true", EAS_BUILD_PROFILE: profile }),
      ).toEqual([
        "EXPO_PUBLIC_API_URL is not set",
        "EXPO_PUBLIC_SUPABASE_URL is not set",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY is not set",
      ]);
    }
  });

  it("refuses a laptop address or plain http, which no tester's phone can reach", () => {
    expect(
      shippingEnvProblems({ ...COMPLETE, EXPO_PUBLIC_API_URL: "http://localhost:3011" }),
    ).toEqual([
      "EXPO_PUBLIC_API_URL points at a development machine (http://localhost:3011)",
    ]);
    expect(
      shippingEnvProblems({
        ...COMPLETE,
        EXPO_PUBLIC_SUPABASE_URL: "http://10.0.2.2:54321",
      }),
    ).toEqual([
      "EXPO_PUBLIC_SUPABASE_URL points at a development machine (http://10.0.2.2:54321)",
    ]);
    expect(
      shippingEnvProblems({
        ...COMPLETE,
        EXPO_PUBLIC_API_URL: "http://dev.agent.koolee.cloud",
      }),
    ).toEqual(["EXPO_PUBLIC_API_URL is not https (http://dev.agent.koolee.cloud)"]);
  });

  it("stays out of the way of development builds and of everything off the build server", () => {
    expect(
      shippingEnvProblems({ EAS_BUILD: "true", EAS_BUILD_PROFILE: "development" }),
    ).toEqual([]);
    expect(shippingEnvProblems({ EAS_BUILD_PROFILE: "preview" })).toEqual([]);
    expect(shippingEnvProblems({})).toEqual([]);
  });
});
