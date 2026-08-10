"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addAgentZones, removeAgentZone } from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

/**
 * Agent coverage: which ZIPs each agent works.
 *
 * This is the only input auto-assignment has beyond workload, so the failure
 * modes are stated rather than swallowed — an out-of-coverage ZIP is refused
 * with the reason, not silently dropped into a table nobody reads again.
 */

export interface ZoneActionState {
  error?: string;
  ok?: string;
}

const addSchema = z.object({
  agentUserId: z.string().uuid(),
  zips: z.array(z.string()).min(1),
});

export async function addZones(
  _prev: ZoneActionState,
  form: FormData,
): Promise<ZoneActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  // One field, comma- or space-separated: assigning a neighbourhood is one
  // paste, not one submit per ZIP.
  const parsed = addSchema.safeParse({
    agentUserId: String(form.get("agentUserId") ?? ""),
    zips: String(form.get("zips") ?? "")
      .split(/[\s,]+/)
      .map((z) => z.trim())
      .filter(Boolean),
  });
  if (!parsed.success) {
    return { error: "Pick an agent and enter at least one ZIP." };
  }

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  try {
    const result = await addAgentZones(core, parsed.data);
    if (!result.ok) return { error: result.error };
    revalidatePath("/zones");
    return {
      ok: `Added ${result.zips.length} ZIP${result.zips.length === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    console.error("[zones] add failed", error);
    return { error: "Could not save those ZIPs. Try again." };
  }
}

export async function removeZone(
  _prev: ZoneActionState,
  form: FormData,
): Promise<ZoneActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const agentUserId = String(form.get("agentUserId") ?? "");
  const zip = String(form.get("zip") ?? "");
  if (!agentUserId || !zip) return { error: "Missing agent or ZIP." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  try {
    const removed = await removeAgentZone(core, { agentUserId, zip });
    if (!removed) return { error: "That ZIP was already off this agent." };
    revalidatePath("/zones");
    return { ok: `Removed ${zip}.` };
  } catch (error) {
    console.error("[zones] remove failed", error);
    return { error: "Could not remove that ZIP. Try again." };
  }
}
