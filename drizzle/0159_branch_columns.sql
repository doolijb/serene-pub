ALTER TABLE "lorebook_entries" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "lorebook_branch_id" integer;--> statement-breakpoint
ALTER TABLE "lorebook_entries" ADD CONSTRAINT "lorebook_entries_branch_id_lorebook_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."lorebook_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_branch_id_lorebook_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."lorebook_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_branch_id_lorebook_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."lorebook_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_lorebook_branch_id_lorebook_branches_id_fk" FOREIGN KEY ("lorebook_branch_id") REFERENCES "public"."lorebook_branches"("id") ON DELETE set null ON UPDATE no action;