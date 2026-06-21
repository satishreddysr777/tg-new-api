import { Type } from "@sinclair/typebox";

const Nullable = (t: ReturnType<typeof Type.String>) =>
  Type.Union([t, Type.Null()]);

export const EmployeeObject = Type.Object({
  id: Type.String(),
  employeeCode: Nullable(Type.String()),
  name: Type.String(),
  email: Type.String(),
  role: Type.String(),
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
  clientId: Nullable(Type.String()),
  clientName: Nullable(Type.String()),
  createdAt: Type.String(),
});

export const EmployeeListResponse = Type.Object({
  employees: Type.Array(EmployeeObject),
});

/** Internal staff (ADMIN/EMPLOYER) selectable as a manager. */
export const ManagerObject = Type.Object({
  id: Type.String(),
  name: Type.String(),
  role: Type.String(),
});

export const ManagerListResponse = Type.Object({
  managers: Type.Array(ManagerObject),
});

/** End an employee's current placement. */
export const EndEngagementBody = Type.Object(
  {
    endDate: Type.String({ format: "date" }),
    reason: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const EngagementHistoryObject = Type.Object({
  id: Type.String(),
  employeeId: Nullable(Type.String()),
  clientId: Nullable(Type.String()),
  clientName: Type.String(),
  title: Nullable(Type.String()),
  startDate: Nullable(Type.String()),
  endDate: Type.String(),
  billRate: Nullable(Type.String()),
  payRate: Nullable(Type.String()),
  reason: Nullable(Type.String()),
  createdAt: Type.String(),
});

export const EngagementHistoryListResponse = Type.Object({
  engagements: Type.Array(EngagementHistoryObject),
});
