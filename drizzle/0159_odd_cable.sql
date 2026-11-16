CREATE TABLE "llm_lane_widths" (
	"lane_key" text PRIMARY KEY NOT NULL,
	"width" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
