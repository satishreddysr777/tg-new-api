CREATE TABLE "engagement_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"client_id" uuid,
	"client_name" text NOT NULL,
	"title" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone NOT NULL,
	"bill_rate" text,
	"pay_rate" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engagement_history" ADD CONSTRAINT "engagement_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_history" ADD CONSTRAINT "engagement_history_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;