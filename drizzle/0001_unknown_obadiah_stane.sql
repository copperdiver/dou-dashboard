-- Enum values are added with IF NOT EXISTS: the migration must also
-- apply cleanly to a database where an earlier version of it already
-- partially ran.
ALTER TYPE "public"."decision_kind" ADD VALUE IF NOT EXISTS 'archived' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."parse_status" ADD VALUE IF NOT EXISTS 'running' BEFORE 'ok';--> statement-breakpoint
DROP INDEX IF EXISTS "denials_codigo_key";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "denials_act_codigo_key" ON "denials" USING btree ("act_id","codigo") WHERE "denials"."codigo" is not null;
