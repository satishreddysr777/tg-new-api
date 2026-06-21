CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_code" text NOT NULL,
	"title" text NOT NULL,
	"client_id" uuid,
	"hiring_manager" text,
	"department" text,
	"engagement_type" text,
	"location" text,
	"headcount" integer DEFAULT 1 NOT NULL,
	"comp_type" text,
	"comp_min" text,
	"comp_max" text,
	"stack" text[] DEFAULT '{}' NOT NULL,
	"summary" text,
	"responsibilities" text,
	"status" text DEFAULT 'Draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_job_code_unique" UNIQUE("job_code")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;