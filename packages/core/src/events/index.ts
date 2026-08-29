export {
  ConsoleEmitter,
  NoopEmitter,
  RecordingEmitter,
  type DomainEvent,
  type EventEmitter,
} from "./emitter";

export { createEventEmitter, type EventEmitterConfig } from "./factory";

export {
  BOOKING_EXCEPTION_RAISED,
  emitExceptionRaised,
  type ExceptionRaisedInput,
} from "./booking-events";
