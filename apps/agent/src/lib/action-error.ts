import { CoreError } from "@koolee/core";

/**
 * Turning a thrown thing into something true for the person holding the phone.
 *
 * TWO KINDS OF FAILURE, AND CONFLATING THEM LIES TO SOMEBODY AT A DOOR.
 *
 *  - A DOMAIN REFUSAL is the server saying no on purpose, and it already
 *    carries the sentence explaining why: "This booking was cancelled", "Your
 *    bags are with the airline", "That truck is already out with Nina
 *    Petrov". Every one is a `CoreError` with a stable `code` and a message
 *    written to be read by a human.
 *  - A TRANSPORT FAILURE is a dropped connection, a timeout, a crash. Nobody
 *    knows anything, and "check your connection" is the honest instruction.
 *
 * THE BUG THIS EXISTS TO REMOVE. Both action files answered BOTH cases with
 * "Couldn't start pickup. Check your connection and try again." — so a driver
 * whose booking had been cancelled underneath them was told their PHONE was
 * broken. They reasonably went on tapping, and on retrying, and eventually
 * drove to a door for a pickup that was not happening. The refusal was
 * correct, the reason existed, and the one screen that could have shown it
 * threw it away.
 *
 * WHY THE BASE CLASS AND NOT A LIST. The task actions matched two subclasses
 * and the shift actions matched four, which meant every refusal type nobody
 * remembered to add — `BookingNotActionableError` among them, the one that
 * fires on a cancelled booking — was silently mistranslated into a connection
 * problem. `CoreError` is by construction the domain's deliberate refusals,
 * and every one of their messages is safe to show: `InvalidInputError` stays
 * coarse on purpose, and `NotFoundError` says "not found" rather than
 * anything about ownership. A refusal added tomorrow surfaces correctly the
 * day it is written, which is the opposite of how this bug happened.
 *
 * A refusal is NOT logged as an error. It is the system working, and a
 * console full of correct refusals is a console nobody reads.
 */
export function actionErrorMessage(
  error: unknown,
  fallback: string,
  logPrefix: string,
): string {
  if (error instanceof CoreError) return error.message;
  console.error(logPrefix, fallback, error);
  return `${fallback} Check your connection and try again.`;
}
