CREATE TABLE "authored_components" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" jsonb NOT NULL,
	"framework" text NOT NULL,
	"entry" text NOT NULL,
	"files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"widget" jsonb NOT NULL,
	"based_on" jsonb,
	"source_hash" text NOT NULL,
	"fingerprint" text,
	"artifact_hash" text,
	"last_error" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"admin_denied" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "authored_components_id_check" CHECK ("authored_components"."id" ~ '^[a-z0-9]{10}$'),
	CONSTRAINT "authored_components_framework_check" CHECK ("authored_components"."framework" IN ('svelte', 'vanilla'))
);
--> statement-breakpoint
ALTER TABLE "authored_components" ADD CONSTRAINT "authored_components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authored_components_slug_uq" ON "authored_components" USING btree ("slug");