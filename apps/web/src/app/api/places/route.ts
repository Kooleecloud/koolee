import { NextResponse } from "next/server";
import { GooglePlacesClient, MIN_AUTOCOMPLETE_INPUT } from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { readDraft } from "@/lib/booking-draft";
import { optionalEnv } from "@/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The address step's Places proxy — the ONLY thing that ever holds the Maps
 * key.
 *
 * The browser half of Places wants a key restricted by HTTP referrer, which
 * is a key anybody can read out of the bundle and spend. So the funnel calls
 * this, this calls Google with a server-restricted key, and
 * `GOOGLE_MAPS_SERVER_KEY` never leaves the server. Nothing key-bearing is in
 * the client bundle; grep the build output for the variable name and you will
 * not find it.
 *
 * TWO ACTIONS, ONE ROUTE, because they share a guard and a session:
 *
 *   { action: "suggest", input, sessionToken }  → PlaceSuggestion[]
 *   { action: "details", placeId, sessionToken } → PlaceAddress | null
 *
 * WHAT GUARDS IT. This route spends money on a metered API and is reachable
 * without a password, because the funnel is anonymous until the verify step.
 * Three things keep it boring:
 *
 *  1. **A draft cookie OR a signed-in account.** Somebody who has walked the
 *     funnel far enough to be typing an address has a draft; the cookie is
 *     httpOnly and same-site, so this is not a token to steal, just a cost of
 *     entry. A signed-in customer is a stronger claim than a draft and had to
 *     be admitted too — the account page's "Add an address" form uses the same
 *     autocomplete, has no booking in progress, and was getting a flat 403
 *     with no visible symptom beyond suggestions that never appeared.
 *  2. **A length floor and ceiling** — under three characters is not an
 *     address, and every keystroke that reaches Google is billed.
 *  3. **Session tokens**, minted per typing session by the browser and passed
 *     through unchanged. With one, Google bills a whole session as a single
 *     autocomplete plus a single details call; without one, every keystroke
 *     is its own billable request.
 *
 * NOTHING HERE IS A GATE. Autocomplete assists the address field and never
 * replaces it: a 503 from this route leaves a perfectly ordinary text input,
 * which is what the step was until this slice.
 */

const MAX_INPUT_LENGTH = 200;
const MAX_PLACE_ID_LENGTH = 255;
const MAX_SESSION_TOKEN_LENGTH = 64;

function client(): GooglePlacesClient | null {
  const apiKey = optionalEnv("GOOGLE_MAPS_SERVER_KEY");
  return apiKey ? new GooglePlacesClient({ apiKey }) : null;
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

export async function POST(request: Request) {
  const places = client();
  // 204, not 500: "this environment has no Maps key" is a configuration, not a
  // fault, and the field it belongs to works without it.
  if (!places) return new NextResponse(null, { status: 204 });

  // Either claim is enough. Checked in this order because the funnel is the
  // hot path and reads a cookie, where the account check resolves a session.
  const draft = await readDraft();
  if (!draft.draftId) {
    const authUser = await getAuthUser();
    if (!authUser || authUser.isAnonymous) {
      return NextResponse.json(
        { error: "Start a booking or sign in first." },
        { status: 403 },
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const payload = body as {
    action?: unknown;
    input?: unknown;
    placeId?: unknown;
    sessionToken?: unknown;
  };
  const sessionToken = str(payload.sessionToken, MAX_SESSION_TOKEN_LENGTH) ?? undefined;

  if (payload.action === "suggest") {
    const input = str(payload.input, MAX_INPUT_LENGTH);
    if (!input || input.trim().length < MIN_AUTOCOMPLETE_INPUT) {
      return NextResponse.json({ suggestions: [] });
    }
    const suggestions = await places.autocomplete(input, sessionToken);
    return NextResponse.json({ suggestions });
  }

  if (payload.action === "details") {
    const placeId = str(payload.placeId, MAX_PLACE_ID_LENGTH);
    if (!placeId) {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    const address = await places.details(placeId, sessionToken);
    return NextResponse.json({ address });
  }

  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
