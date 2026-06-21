ALTER TABLE "employees" ADD COLUMN "pay_rate" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "employment_type" "employment_type";--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "manager_name" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "bill_rate" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "pay_rate" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "end_date" timestamp with time zone;