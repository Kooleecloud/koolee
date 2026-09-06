import "server-only";

import type { DomainEvent, EventEmitter } from "@koolee/core";

import { inngest } from "@/lib/inngest-client";

/**
 * The Inngest-backed `EventEmitter` core is handed at runtime construction.
 *
 * This is the only place in the repo that turns a domain event into a queue
 * send. Core decides that something happened and calls `emit`; it knows
 * nothing about Inngest, which is what let the exception alert move out of a
 * single route handler and onto every path that raises one.
 *
 * `DomainEvent.id` maps straight onto Inngest's idempotency id.
 */
export class InngestEmitter implements EventEmitter {
  async emit(event: DomainEvent): Promise<void> {
    await inngest.send({
      ...(event.id === undefined ? {} : { id: event.id }),
      name: event.name,
      data: event.data,
    });
  }
}

/** One instance is enough — the client underneath is already shared. */
export const inngestEmitter = new InngestEmitter();
