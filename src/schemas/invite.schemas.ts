import { Type } from "@sinclair/typebox";

const RoleSchema = Type.Union([
  Type.Literal("EMPLOYEE"),
  Type.Literal("EMPLOYER"),
  Type.Literal("ADMIN"),
]);

const EmploymentTypeSchema = Type.Union([
  Type.Literal("W-2"),
  Type.Literal("1099"),
]);

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const CreateInviteBody = Type.Object(
  {
    email: Type.String({ format: "email", maxLength: 254 }),
    role: RoleSchema,
    clientId: Type.Optional(Type.String()),
    name: Type.Optional(Type.String({ maxLength: 120 })),
    // Placement + compensation (employee invites only).
    title: Type.Optional(Type.String({ maxLength: 120 })),
    employmentType: Type.Optional(EmploymentTypeSchema),
    managerName: Type.Optional(Type.String({ maxLength: 120 })),
    billRate: Type.Optional(Type.String({ maxLength: 40 })),
    payRate: Type.Optional(Type.String({ maxLength: 40 })),
    location: Type.Optional(Type.String({ maxLength: 120 })),
    startDate: Type.Optional(Type.String({ format: "date" })),
    endDate: Type.Optional(Type.String({ format: "date" })),
  },
  { additionalProperties: false },
);

export const InviteObject = Type.Object({
  id: Type.String(),
  email: Type.String(),
  role: Type.String(),
  clientId: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  title: NullableString,
  employmentType: NullableString,
  managerName: NullableString,
  billRate: NullableString,
  payRate: NullableString,
  location: NullableString,
  startDate: NullableString,
  endDate: NullableString,
  invitedBy: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  expiresAt: Type.String(),
  acceptedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const CreateInviteResponse = Type.Object({
  invite: InviteObject,
  link: Type.String(),
});

export const InviteListResponse = Type.Object({
  invites: Type.Array(InviteObject),
});

export const ClientObject = Type.Object({
  id: Type.String(),
  name: Type.String(),
  location: NullableString,
  contactEmail: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

/** A client in the list, annotated with how many employees are placed there. */
export const ClientListItem = Type.Composite([
  ClientObject,
  Type.Object({ employeeCount: Type.Integer() }),
]);

export const ClientListResponse = Type.Object({
  clients: Type.Array(ClientListItem),
});

export const CreateClientBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    location: Type.Optional(Type.String({ maxLength: 160 })),
    contactEmail: Type.Optional(Type.String({ format: "email", maxLength: 254 })),
  },
  { additionalProperties: false },
);

export const UpdateClientBody = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    location: Type.Optional(Type.String({ maxLength: 160 })),
    contactEmail: Type.Optional(Type.String({ format: "email", maxLength: 254 })),
  },
  { additionalProperties: false },
);
