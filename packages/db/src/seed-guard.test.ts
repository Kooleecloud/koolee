import { describe, expect, it } from "vitest";

import {
  assertSeedTargetAllowed,
  HostedSeedRefusedError,
  isLocalDatabaseHost,
  SEED_ALLOW_HOSTED_ENV,
} from "./seed-guard";

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const COMPOSE = "postgresql://koolee:koolee@postgres:5432/koolee";
const HOSTED =
  "postgresql://postgres.abcdefghijklmnop:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

describe("isLocalDatabaseHost", () => {
  it("admits the Supabase CLI stack, compose and the docker host bridge", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "LOCALHOST",
      "[::1]",
      "host.docker.internal",
      "postgres",
      "koolee-postgres",
    ]) {
      expect(isLocalDatabaseHost(host), host).toBe(true);
    }
  });

  it("refuses anything that merely looks private", () => {
    // The tempting pattern — "anything on a private range is mine" — would
    // admit a bastion or an SSH tunnel to production, which is the case the
    // guard exists to stop.
    for (const host of [
      "aws-0-us-east-1.pooler.supabase.com",
      "db.abcdefghijklmnop.supabase.co",
      "10.0.0.5",
      "192.168.1.20",
      "127.0.0.1.evil.example.com",
      "notlocalhost",
    ]) {
      expect(isLocalDatabaseHost(host), host).toBe(false);
    }
  });
});

describe("assertSeedTargetAllowed", () => {
  it("allows a local target with no override in the environment", () => {
    expect(assertSeedTargetAllowed(LOCAL, {})).toEqual({
      kind: "local",
      host: "127.0.0.1",
    });
    expect(assertSeedTargetAllowed(COMPOSE, {})).toEqual({
      kind: "local",
      host: "postgres",
    });
  });

  it("refuses a hosted target, naming the host and what would be destroyed", () => {
    expect(() => assertSeedTargetAllowed(HOSTED, {})).toThrow(HostedSeedRefusedError);
    try {
      assertSeedTargetAllowed(HOSTED, {});
      expect.unreachable("should have refused");
    } catch (error) {
      const refusal = error as HostedSeedRefusedError;
      expect(refusal.host).toBe("aws-0-us-east-1.pooler.supabase.com");
      expect(refusal.message).toContain("aws-0-us-east-1.pooler.supabase.com");
      expect(refusal.message).toContain("airline_cutoffs");
      expect(refusal.message).toContain("pricing rule");
      expect(refusal.message).toContain(SEED_ALLOW_HOSTED_ENV);
    }
  });

  it("lets the operator state the intent out loud", () => {
    for (const value of ["1", "true", "yes"]) {
      expect(assertSeedTargetAllowed(HOSTED, { [SEED_ALLOW_HOSTED_ENV]: value })).toEqual(
        {
          kind: "hosted-allowed",
          host: "aws-0-us-east-1.pooler.supabase.com",
        },
      );
    }
  });

  it("treats an override of 0/false/blank as not set", () => {
    for (const value of ["0", "false", "", "  "]) {
      expect(() =>
        assertSeedTargetAllowed(HOSTED, { [SEED_ALLOW_HOSTED_ENV]: value }),
      ).toThrow(HostedSeedRefusedError);
    }
  });

  it("treats an unparseable connection string as not local", () => {
    // An unknown target is not a local target. Refusing is the safe reading.
    expect(() => assertSeedTargetAllowed("not a url", {})).toThrow(
      HostedSeedRefusedError,
    );
  });

  it("does not read process.env when an environment is passed", () => {
    // The seed passes nothing and gets process.env; the tests pass an explicit
    // object so a developer with SEED_ALLOW_HOSTED exported cannot make the
    // refusal tests pass for the wrong reason.
    const before = process.env[SEED_ALLOW_HOSTED_ENV];
    process.env[SEED_ALLOW_HOSTED_ENV] = "1";
    try {
      expect(() => assertSeedTargetAllowed(HOSTED, {})).toThrow(HostedSeedRefusedError);
    } finally {
      if (before === undefined) delete process.env[SEED_ALLOW_HOSTED_ENV];
      else process.env[SEED_ALLOW_HOSTED_ENV] = before;
    }
  });
});
