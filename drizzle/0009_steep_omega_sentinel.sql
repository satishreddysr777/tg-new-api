ALTER TABLE "applications" ALTER COLUMN "stage" SET DEFAULT 'Applied';
--> statement-breakpoint
UPDATE "applications" SET "stage" = 'Applied' WHERE "stage" = 'New';