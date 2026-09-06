/**
 * Domain event emission seam.
 *
 * Business logic in `packages/core` decides that something happened; it must
 * not know how that fact reaches a queue. `EventEmitter` is that boundary —
 * deliberately Inngest-agnostic, so the adapter can be swapped without
 * touching a single service. The Inngest-backed implementation is built in
 * each app's runtime (its `src/lib/core.ts`), never here: core reads no
 * environment, and an event key is environment.
 *
 * Same shape as the `Notifier` seam next door, for the same reason.
 */

export interface DomainEvent {
  /** Event name, e.g. `"booking/exception_raised"`. */
  name: string;
  /**
   * Idempotency key. Two emits carrying the same id are ONE delivery to the
   * consumer — which is what collapses a webhook/return-page race, or a
   * retried job, into a single side effect.
   *
   * Generic on purpose: every queue worth using has this concept, so naming
   * it here does not make the seam Inngest-shaped.
   */
  id?: string | undefined;
  data: Record<string, unknown>;
}

export interface EventEmitter {
  emit(event: DomainEvent): Promise<void>;
}

/**
 * The default. Apps that have no queue wiring (today: agent and admin before
 * their runtime passes one in) get a working `CoreConfig` and silently drop
 * events rather than failing a booking transition over missing plumbing.
 */
export class NoopEmitter implements EventEmitter {
  async emit(): Promise<void> {
    // Intentionally nothing.
  }
}

/** Dev/diagnostic emitter: prints what would have been enqueued. */
export class ConsoleEmitter implements EventEmitter {
  async emit(event: DomainEvent): Promise<void> {
    console.info(`[event] ${event.name}${event.id ? ` (${event.id})` : ""}`, event.data);
  }
}

/** Test double. Mirrors `RecordingNotifier` — same reason, same place. */
export class RecordingEmitter implements EventEmitter {
  readonly emitted: DomainEvent[] = [];

  async emit(event: DomainEvent): Promise<void> {
    this.emitted.push(event);
  }

  /** Every emit whose name matches, in order. */
  byName(name: string): DomainEvent[] {
    return this.emitted.filter((event) => event.name === name);
  }

  clear(): void {
    this.emitted.length = 0;
  }
}
