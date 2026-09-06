import "server-only";

import type { DomainEvent, EventEmitter } from "@koolee/core";
import { createInngestClient } from "@koolee/core/jobs";

import { env, optionalEnv } from "@/env";

/**
 * The Inngest-backed `EventEmitter` handed to `createRuntime`.
 *
 * SEND-ONLY. This app registers no Inngest functions and serves no
 * `/api/inngest` route — apps/web owns the registry, and a second serve
 * endpoint would double-register every function. What this app needs is the
 * other half: an ops override moving a booking to exception raises
 * `booking/exception_raised` from inside core, and without an emitter here
 * that raise is a noop and ops is never told.
 *
 * No signing key: that is for receiving. Cheap and I/O-free, so module scope
 * is fine.
 */
const inngest = createInngestClient({
  eventKey: optionalEnv("INNGEST_EVENT_KEY"),
  isDev: env.NODE_ENV !== "production",
});

export class InngestEmitter implements EventEmitter {
  async emit(event: DomainEvent): Promise<void> {
    await inngest.send({
      ...(event.id === undefined ? {} : { id: event.id }),
      name: event.name,
      data: event.data,
    });
  }
}

export const inngestEmitter = new InngestEmitter();
