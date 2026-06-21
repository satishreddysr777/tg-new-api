import { Type } from "@sinclair/typebox";

const Nullable = (t: ReturnType<typeof Type.String>) =>
  Type.Union([t, Type.Null()]);

const StatusSchema = Type.Union([
  Type.Literal("Draft"),
  Type.Literal("Published"),
]);

export const JobObject = Type.Object({
  id: Type.String(),
  jobCode: Type.String(),
  title: Type.String(),
  clientId: Nullable(Type.String()),
  clientName: Nullable(Type.String()),
  hiringManager: Nullable(Type.String()),
  department: Nullable(Type.String()),
  engagementType: Nullable(Type.String()),
  location: Nullable(Type.String()),
  headcount: Type.Integer(),
  compType: Nullable(Type.String()),
  compMin: Nullable(Type.String()),
  compMax: Nullable(Type.String()),
  stack: Type.Array(Type.String()),
  summary: Nullable(Type.String()),
  responsibilities: Nullable(Type.String()),
  status: Type.String(),
  createdAt: Type.String(),
});

export const JobListResponse = Type.Object({
  jobs: Type.Array(JobObject),
});

export const NextJobCodeResponse = Type.Object({
  code: Type.String(),
});

export const UpdateJobBody = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    status: Type.Optional(StatusSchema),
    clientId: Type.Optional(Type.String()),
    hiringManager: Type.Optional(Type.String({ maxLength: 120 })),
    department: Type.Optional(Type.String({ maxLength: 80 })),
    engagementType: Type.Optional(Type.String({ maxLength: 40 })),
    location: Type.Optional(Type.String({ maxLength: 120 })),
    headcount: Type.Optional(Type.Integer({ minimum: 1, maximum: 999 })),
    compType: Type.Optional(Type.String({ maxLength: 20 })),
    compMin: Type.Optional(Type.String({ maxLength: 40 })),
    compMax: Type.Optional(Type.String({ maxLength: 40 })),
    stack: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 30 }),
    ),
    summary: Type.Optional(Type.String({ maxLength: 2000 })),
    responsibilities: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

export const CreateJobBody = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 160 }),
    status: StatusSchema,
    clientId: Type.Optional(Type.String()),
    hiringManager: Type.Optional(Type.String({ maxLength: 120 })),
    department: Type.Optional(Type.String({ maxLength: 80 })),
    engagementType: Type.Optional(Type.String({ maxLength: 40 })),
    location: Type.Optional(Type.String({ maxLength: 120 })),
    headcount: Type.Optional(Type.Integer({ minimum: 1, maximum: 999 })),
    compType: Type.Optional(Type.String({ maxLength: 20 })),
    compMin: Type.Optional(Type.String({ maxLength: 40 })),
    compMax: Type.Optional(Type.String({ maxLength: 40 })),
    stack: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 30 }),
    ),
    summary: Type.Optional(Type.String({ maxLength: 2000 })),
    responsibilities: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);
