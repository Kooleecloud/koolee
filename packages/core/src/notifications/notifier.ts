/**
 * Notification seam.
 *
 * Twilio (SMS) and Resend (email) are interfaces plus a console fallback —
 * neither is really integrated. The fallback is the default so nothing in the
 * codebase has to branch on "are notifications configured".
 */

export interface SmsMessage {
  /** E.164. */
  to: string;
  body: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. HTML templating is out of scope for the scaffold. */
  body: string;
}

export interface Notifier {
  sendSms(message: SmsMessage): Promise<void>;
  sendEmail(message: EmailMessage): Promise<void>;
}

/**
 * Default implementation: logs and returns. Used whenever Twilio/Resend
 * credentials are absent, which includes every fresh clone.
 */
export class ConsoleNotifier implements Notifier {
  readonly #prefix: string;

  constructor(prefix = "notify") {
    this.#prefix = prefix;
  }

  sendSms(message: SmsMessage): Promise<void> {
    console.log(`[${this.#prefix}:sms] → ${message.to}: ${message.body}`);
    return Promise.resolve();
  }

  sendEmail(message: EmailMessage): Promise<void> {
    console.log(
      `[${this.#prefix}:email] → ${message.to}: ${message.subject}\n${message.body}`,
    );
    return Promise.resolve();
  }
}

/** Records everything sent, for assertions. */
export class RecordingNotifier implements Notifier {
  readonly sms: SmsMessage[] = [];
  readonly emails: EmailMessage[] = [];

  sendSms(message: SmsMessage): Promise<void> {
    this.sms.push(message);
    return Promise.resolve();
  }

  sendEmail(message: EmailMessage): Promise<void> {
    this.emails.push(message);
    return Promise.resolve();
  }

  reset(): void {
    this.sms.length = 0;
    this.emails.length = 0;
  }
}

/**
 * TODO(twilio): implement against the Twilio Messaging API using
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID.
 * Real integration is explicitly out of scope for this scaffold.
 *
 * TODO(resend): same for transactional email via RESEND_API_KEY.
 */

/** Ops alerting seam — Sentry in production, console until then. */
export interface OpsAlerter {
  alert(event: {
    severity: "info" | "warning" | "critical";
    title: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
}

export class ConsoleOpsAlerter implements OpsAlerter {
  alert(event: {
    severity: "info" | "warning" | "critical";
    title: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    const line = `[ops:${event.severity}] ${event.title}`;
    if (event.severity === "critical") console.error(line, event.detail ?? "");
    else if (event.severity === "warning") console.warn(line, event.detail ?? "");
    else console.log(line, event.detail ?? "");
    return Promise.resolve();
  }
}

/**
 * TODO(sentry): forward `critical` and `warning` to Sentry via SENTRY_DSN, and
 * page on `critical`. A missed cutoff alert nobody sees is not an alert.
 */
