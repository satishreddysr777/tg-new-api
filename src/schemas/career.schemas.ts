import { Type } from "@sinclair/typebox";

const Nullable = (t: ReturnType<typeof Type.String>) =>
  Type.Union([t, Type.Null()]);

/** Public, careers-safe view of a published job (no client / internal fields). */
export const PublicJobObject = Type.Object({
  jobCode: Type.String(),
  title: Type.String(),
  department: Nullable(Type.String()),
  engagementType: Nullable(Type.String()),
  location: Nullable(Type.String()),
  summary: Nullable(Type.String()),
  responsibilities: Nullable(Type.String()),
  stack: Type.Array(Type.String()),
});

export const PublicJobListResponse = Type.Object({
  jobs: Type.Array(PublicJobObject),
});

const ExperienceItem = Type.Object({
  title: Type.String({ maxLength: 160 }),
  company: Type.String({ maxLength: 160 }),
  period: Type.String({ maxLength: 80 }),
  detail: Type.String({ maxLength: 600 }),
});

/** What a public applicant submits. The server sets source/stage/code. */
export const CareerApplyBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({ format: "email", maxLength: 254 }),
    phone: Type.Optional(Type.String({ maxLength: 40 })),
    location: Type.Optional(Type.String({ maxLength: 120 })),
    years: Type.Optional(Type.Integer({ minimum: 0, maximum: 80 })),
    compAsk: Type.Optional(Type.String({ maxLength: 40 })),
    summary: Type.Optional(Type.String({ maxLength: 2000 })),
    skills: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 40 }),
    ),
    linkedin: Type.Optional(Type.String({ maxLength: 200 })),
    experience: Type.Optional(Type.Array(ExperienceItem, { maxItems: 20 })),
    // Optional résumé upload (base64). resumeData ≈ 1.37× the file size.
    resumeName: Type.Optional(Type.String({ maxLength: 255 })),
    resumeMime: Type.Optional(Type.String({ maxLength: 100 })),
    resumeData: Type.Optional(Type.String({ maxLength: 8_000_000 })),
  },
  { additionalProperties: false },
);

export const CareerApplyResponse = Type.Object({
  ok: Type.Boolean(),
  applicationCode: Type.String(),
});
