ALTER TABLE "pipeline_function_bindings" RENAME TO "pipeline_bindings";--> statement-breakpoint
ALTER TABLE "pipeline_bindings" RENAME COLUMN "function_key" TO "subject";--> statement-breakpoint
ALTER TABLE "pipeline_bindings" DROP CONSTRAINT "pipeline_function_bindings_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_bindings" DROP CONSTRAINT "pipeline_function_bindings_spec_id_pipeline_specs_id_fk";
--> statement-breakpoint
ALTER TABLE "pipeline_bindings" DROP CONSTRAINT "pipeline_function_bindings_updated_by_users_id_fk";
--> statement-breakpoint
DROP INDEX "pipeline_function_bindings_addr_idx";--> statement-breakpoint
ALTER TABLE "pipeline_bindings" ADD CONSTRAINT "pipeline_bindings_spec_id_pipeline_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."pipeline_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_bindings" ADD CONSTRAINT "pipeline_bindings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_bindings_addr_idx" ON "pipeline_bindings" USING btree ("scope_kind","scope_id","genre_id","subject");--> statement-breakpoint
ALTER TABLE "pipeline_bindings" ADD CONSTRAINT "pipeline_bindings_scope_check" CHECK ("pipeline_bindings"."scope_kind" IN ('instance', 'session'));