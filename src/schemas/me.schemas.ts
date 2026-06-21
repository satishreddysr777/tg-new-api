import { Type } from "@sinclair/typebox";

const Nullable = (t: ReturnType<typeof Type.String>) =>
  Type.Union([t, Type.Null()]);

/**
 * The signed-in user's own profile. Mirrors the public employee shape (no
 * password hash) and is used by the portal to gate onboarding and prefill the
 * onboarding form.
 */
export const MeResponse = Type.Object({
  id: Type.String(),
  email: Type.String(),
  name: Type.String(),
  role: Type.String(),
  phoneHint: Type.String(),
  clientId: Nullable(Type.String()),
  clientName: Nullable(Type.String()),
  employeeCode: Nullable(Type.String()),
  title: Nullable(Type.String()),
  employmentType: Nullable(Type.String()),
  status: Nullable(Type.String()),
  billRate: Nullable(Type.String()),
  payRate: Nullable(Type.String()),
  managerName: Nullable(Type.String()),
  location: Nullable(Type.String()),
  startDate: Nullable(Type.String()),
  endDate: Nullable(Type.String()),
  stack: Type.Array(Type.String()),
  createdAt: Type.String(),
});

/** What a new hire submits on the onboarding screen. */
export const CompleteOnboardingBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    phone: Type.String({ minLength: 4, maxLength: 40 }),
    location: Type.String({ minLength: 1, maxLength: 120 }),
    stack: Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
      maxItems: 30,
    }),
  },
  { additionalProperties: false },
);

// ── Open roles (internal mobility) ───────────────────────────────────────────

/** A published role as the employee portal shows it, with a fit score. */
export const PortalRoleObject = Type.Object({
  jobCode: Type.String(),
  title: Type.String(),
  clientName: Nullable(Type.String()),
  department: Nullable(Type.String()),
  engagementType: Nullable(Type.String()),
  location: Nullable(Type.String()),
  compType: Nullable(Type.String()),
  compMin: Nullable(Type.String()),
  compMax: Nullable(Type.String()),
  stack: Type.Array(Type.String()),
  summary: Nullable(Type.String()),
  responsibilities: Nullable(Type.String()),
  matchPct: Type.Integer(),
  applied: Type.Boolean(),
  createdAt: Type.String(),
});

export const PortalRoleListResponse = Type.Object({
  roles: Type.Array(PortalRoleObject),
});

/** Optional extras an employee can attach when applying to a role. */
export const PortalApplyBody = Type.Object(
  {
    summary: Type.Optional(Type.String({ maxLength: 2000 })),
    compAsk: Type.Optional(Type.String({ maxLength: 40 })),
    linkedin: Type.Optional(Type.String({ maxLength: 200 })),
    // Optional résumé upload (base64). resumeData ≈ 1.37× the file size.
    resumeName: Type.Optional(Type.String({ maxLength: 255 })),
    resumeMime: Type.Optional(Type.String({ maxLength: 100 })),
    resumeData: Type.Optional(Type.String({ maxLength: 8_000_000 })),
  },
  { additionalProperties: false },
);

export const PortalApplyResponse = Type.Object({
  ok: Type.Boolean(),
  applicationCode: Type.String(),
});

// ── My applications ──────────────────────────────────────────────────────────

const ExperienceItem = Type.Object({
  title: Type.String(),
  company: Type.String(),
  period: Type.String(),
  detail: Type.String(),
});

/** One of the employee's own applications, joined with its job. */
export const PortalApplicationObject = Type.Object({
  id: Type.String(),
  applicationCode: Type.String(),
  jobId: Type.String(),
  jobCode: Type.String(),
  jobTitle: Type.String(),
  jobClientName: Nullable(Type.String()),
  name: Type.String(),
  email: Nullable(Type.String()),
  phone: Nullable(Type.String()),
  location: Nullable(Type.String()),
  source: Nullable(Type.String()),
  years: Type.Union([Type.Integer(), Type.Null()]),
  compAsk: Nullable(Type.String()),
  matchPct: Type.Union([Type.Integer(), Type.Null()]),
  stage: Type.String(),
  summary: Nullable(Type.String()),
  skills: Type.Array(Type.String()),
  linkedin: Nullable(Type.String()),
  resumeName: Nullable(Type.String()),
  experience: Type.Array(ExperienceItem),
  appliedAt: Type.String(),
  createdAt: Type.String(),
});

export const PortalApplicationListResponse = Type.Object({
  applications: Type.Array(PortalApplicationObject),
});
