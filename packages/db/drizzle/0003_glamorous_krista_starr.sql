-- The superseded 0003 (plaintext `destination` column) reached some databases
-- before this regenerated version replaced it. The table is a pure rate-limit
-- log with 24h retention: dropping it destroys the plaintext PII rows, and the
-- only behavioural effect is resetting in-flight rate-limit windows — the same
-- harmless effect as rotating OTP_LOG_HMAC_KEY.
DROP TABLE IF EXISTS "otp_send_log";--> statement-breakpoint
CREATE TABLE "otp_send_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"destination_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "otp_send_log_user_created_idx" ON "otp_send_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_send_log_dest_hash_created_idx" ON "otp_send_log" USING btree ("destination_hash","created_at");