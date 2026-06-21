CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_code" text NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"location" text,
	"source" text,
	"years" integer,
	"comp_ask" text,
	"match_pct" integer,
	"stage" text DEFAULT 'New' NOT NULL,
	"summary" text,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"linkedin" text,
	"experience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_application_code_unique" UNIQUE("application_code")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;