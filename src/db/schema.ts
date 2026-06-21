import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema — the single source of truth for the database shape.
 * `drizzle-kit generate` derives SQL migrations from this file.
 */
export const roleEnum = pgEnum("role", ["EMPLOYEE", "EMPLOYER", "ADMIN"]);

export const employmentTypeEnum = pgEnum("employment_type", ["W-2", "1099"]);
export const employeeStatusEnum = pgEnum("employee_status", [
  "Active",
  "Onboarding",
  "On bench",
]);

export const inviteStatusEnum = pgEnum("invite_status", [
  "PENDING",
  "ACCEPTED",
  "REVOKED",
]);

export const contactStatusEnum = pgEnum("contact_status", [
  "NEW",
  "READ",
  "ARCHIVED",
]);

/** Client companies that employees are placed at (no login of their own). */
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  location: text("location"),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Everyone in the system is an employee of Technograph — admins, talent staff
 * (EMPLOYER), and placed engineers (EMPLOYEE). This is the single identity +
 * auth + profile table; `role` distinguishes them. The profile columns
 * (employeeCode, title, rate, …) are populated for placed engineers and left
 * null for staff.
 */
export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  // identity + auth
  email: text("email").notNull().unique(),
  name: text("name").notNull(), // display name = "first last"
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: roleEnum("role").notNull().default("EMPLOYEE"),
  passwordHash: text("password_hash").notNull(),
  phoneHint: text("phone_hint").notNull().default("···· ·· 0163"),
  // the client an EMPLOYEE is placed at
  clientId: uuid("client_id").references(() => clients.id),
  // workforce profile (null for staff)
  employeeCode: text("employee_code").unique(), // e.g. TG-0148
  title: text("title"),
  employmentType: employmentTypeEnum("employment_type"),
  status: employeeStatusEnum("status"),
  billRate: text("bill_rate"), // display string, e.g. "$165/hr"
  payRate: text("pay_rate"), // display string, e.g. "$112/hr"
  managerName: text("manager_name"),
  location: text("location"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  stack: text("stack").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Pending onboarding invitations. The raw token is emailed to the invitee and
 * never stored — only its SHA-256 hash is kept, so a DB leak can't be replayed.
 */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  role: roleEnum("role").notNull(),
  // Required when role = EMPLOYEE; the client the invitee will be placed at.
  clientId: uuid("client_id").references(() => clients.id),
  name: text("name"),
  // Placement + compensation the admin sets up front; copied onto the employee
  // record when the invite is accepted. Null for staff invites.
  title: text("title"),
  employmentType: employmentTypeEnum("employment_type"),
  managerName: text("manager_name"),
  billRate: text("bill_rate"),
  payRate: text("pay_rate"),
  location: text("location"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  invitedBy: uuid("invited_by").references(() => employees.id),
  status: inviteStatusEnum("status").notNull().default("PENDING"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Single-use password-reset tokens. Like invites, only the SHA-256 hash of the
 * emailed token is stored.
 */
export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Append-only record of ended placements. When an engagement is ended the
 * client is unassigned from the employee, so the client name is snapshotted
 * here to preserve the history even if the client is later deleted.
 */
export const engagementHistory = pgTable("engagement_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: detached (set null) when the employee is deleted so the
  // placement record itself survives.
  employeeId: uuid("employee_id").references(() => employees.id),
  clientId: uuid("client_id").references(() => clients.id),
  clientName: text("client_name").notNull(),
  title: text("title"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  billRate: text("bill_rate"),
  payRate: text("pay_rate"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Hiring requisitions. `jobCode` (JOB-####) is assigned from the live job count
 * at creation, mirroring how employee codes work.
 */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobCode: text("job_code").notNull().unique(),
  title: text("title").notNull(),
  clientId: uuid("client_id").references(() => clients.id),
  hiringManager: text("hiring_manager"),
  department: text("department"),
  engagementType: text("engagement_type"), // "Direct hire" | "Contract"
  location: text("location"),
  headcount: integer("headcount").notNull().default(1),
  compType: text("comp_type"), // "Yearly" | "Hourly"
  compMin: text("comp_min"),
  compMax: text("comp_max"),
  stack: text("stack").array().notNull().default([]),
  summary: text("summary"),
  responsibilities: text("responsibilities"),
  status: text("status").notNull().default("Draft"), // "Draft" | "Published"
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One résumé experience entry, stored in the application's `experience` jsonb. */
export interface ApplicationExperience {
  title: string;
  company: string;
  period: string;
  detail: string;
}

/**
 * Candidates applying to a job. They move through the hiring pipeline by
 * `stage`. `applicationCode` (A-####) is assigned from the application count.
 */
export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationCode: text("application_code").notNull().unique(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  source: text("source"), // "LinkedIn" | "Public board" | "Referral" | …
  years: integer("years"),
  compAsk: text("comp_ask"),
  matchPct: integer("match_pct"),
  stage: text("stage").notNull().default("Applied"),
  summary: text("summary"),
  skills: text("skills").array().notNull().default([]),
  linkedin: text("linkedin"),
  resumeName: text("resume_name"), // original filename; null = no résumé
  experience: jsonb("experience")
    .$type<ApplicationExperience[]>()
    .notNull()
    .default([]),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Uploaded résumé bytes, kept in their own table (base64) so the candidate
 * board never loads the blobs. One résumé per application.
 */
export const applicationResumes = pgTable("application_resumes", {
  applicationId: uuid("application_id")
    .primaryKey()
    .references(() => applications.id),
  mime: text("mime").notNull(),
  data: text("data").notNull(), // base64-encoded file
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Inbound messages from the public marketing contact form. Anyone can create
 * one (no auth); staff read and triage them in the Employer Console. `status`
 * moves NEW → READ → ARCHIVED.
 */
export const contactMessages = pgTable("contact_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  intent: text("intent"), // "Hire talent" | "Apply for a role" | "Partner with us"
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  phone: text("phone"),
  message: text("message"),
  status: contactStatusEnum("status").notNull().default("NEW"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EmployeeRow = typeof employees.$inferSelect;
export type NewEmployeeRow = typeof employees.$inferInsert;
export type ClientRow = typeof clients.$inferSelect;
export type NewClientRow = typeof clients.$inferInsert;
export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;
export type PasswordResetRow = typeof passwordResets.$inferSelect;
export type EngagementHistoryRow = typeof engagementHistory.$inferSelect;
export type NewEngagementHistoryRow = typeof engagementHistory.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type ApplicationRow = typeof applications.$inferSelect;
export type NewApplicationRow = typeof applications.$inferInsert;
export type ApplicationResumeRow = typeof applicationResumes.$inferSelect;
export type NewApplicationResumeRow = typeof applicationResumes.$inferInsert;
export type ContactMessageRow = typeof contactMessages.$inferSelect;
export type NewContactMessageRow = typeof contactMessages.$inferInsert;
