import { Type } from "@sinclair/typebox";

const Nullable = (t: ReturnType<typeof Type.String>) =>
  Type.Union([t, Type.Null()]);

const StageSchema = Type.Union([
  Type.Literal("Applied"),
  Type.Literal("Screening"),
  Type.Literal("Interview"),
  Type.Literal("Offer"),
  Type.Literal("Hired"),
  Type.Literal("Rejected"),
]);

const ExperienceItem = Type.Object({
  title: Type.String({ maxLength: 160 }),
  company: Type.String({ maxLength: 160 }),
  period: Type.String({ maxLength: 80 }),
  detail: Type.String({ maxLength: 600 }),
});

export const ApplicationObject = Type.Object({
  id: Type.String(),
  applicationCode: Type.String(),
  jobId: Type.String(),
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

export const ApplicationListResponse = Type.Object({
  applications: Type.Array(ApplicationObject),
});

export const CreateApplicationBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    stage: Type.Optional(StageSchema),
    email: Type.Optional(Type.String({ maxLength: 254 })),
    phone: Type.Optional(Type.String({ maxLength: 40 })),
    location: Type.Optional(Type.String({ maxLength: 120 })),
    source: Type.Optional(Type.String({ maxLength: 60 })),
    years: Type.Optional(Type.Integer({ minimum: 0, maximum: 80 })),
    compAsk: Type.Optional(Type.String({ maxLength: 40 })),
    matchPct: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    summary: Type.Optional(Type.String({ maxLength: 2000 })),
    skills: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 40 }),
    ),
    linkedin: Type.Optional(Type.String({ maxLength: 200 })),
    experience: Type.Optional(Type.Array(ExperienceItem, { maxItems: 20 })),
  },
  { additionalProperties: false },
);

export const UpdateStageBody = Type.Object(
  { stage: StageSchema },
  { additionalProperties: false },
);
