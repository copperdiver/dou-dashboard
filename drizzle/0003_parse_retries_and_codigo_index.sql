DROP INDEX "denials_act_codigo_key";--> statement-breakpoint
ALTER TABLE "source_pages" ADD COLUMN "parse_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_pages" ADD COLUMN "parse_next_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "denials_act_codigo_idx" ON "denials" USING btree ("act_id","codigo") WHERE "denials"."codigo" is not null;