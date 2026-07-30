DROP INDEX "approvals_feed_idx";--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "is_republication" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "counts_as_new_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "approvals_all_feed_idx" ON "approvals" USING btree ("edition_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approvals_process_idx" ON "approvals" USING btree ("process_number_norm","edition_date");--> statement-breakpoint
CREATE INDEX "approvals_feed_idx" ON "approvals" USING btree ("edition_date" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "approvals"."counts_as_new_approval" and "approvals"."retired_at" is null;