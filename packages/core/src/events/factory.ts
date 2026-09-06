import { ConsoleEmitter, NoopEmitter, type EventEmitter } from "./emitter";

/**
 * Which emitter to use, injected rather than read from the environment —
 * same contract as `createNotifier` and `createPaymentProvider`.
 *
 * There is deliberately no `{ kind: "inngest" }` here. The queue adapter
 * needs an event key and a client, both of which are environment, so it is
 * constructed app-side and handed to `createRuntime` as an `emitter`
 * instance. This factory covers the two credential-free choices.
 *
 * Constructing an emitter never opens a connection, so this is safe to call
 * at module scope.
 */
export type EventEmitterConfig = { kind: "noop" } | { kind: "console" };

export function createEventEmitter(config: EventEmitterConfig): EventEmitter {
  return config.kind === "console" ? new ConsoleEmitter() : new NoopEmitter();
}
