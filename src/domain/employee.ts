export type Role = "EMPLOYEE" | "EMPLOYER" | "ADMIN";
export type EmploymentType = "W-2" | "1099";
export type EmployeeStatus = "Active" | "Onboarding" | "On bench";

/**
 * A person in the system. Identity + auth live here alongside the workforce
 * profile; staff (ADMIN/EMPLOYER) leave the profile fields null.
 */
export interface Employee {
  id: string;
  email: string;
  name: string; // display name = "first last"
  firstName: string | null;
  lastName: string | null;
  role: Role;
  passwordHash: string;
  phoneHint: string; // masked, e.g. "···· ·· 0163"
  clientId: string | null; // company a placed EMPLOYEE works at
  // workforce profile (null for staff)
  employeeCode: string | null; // TG-0148
  title: string | null;
  employmentType: EmploymentType | null;
  status: EmployeeStatus | null;
  billRate: string | null;
  payRate: string | null;
  managerName: string | null;
  location: string | null;
  startDate: string | null; // ISO
  endDate: string | null; // ISO
  stack: string[];
  createdAt: string;
}

/** Shape returned to clients — never includes the password hash. */
export type PublicEmployee = Omit<Employee, "passwordHash">;

export function toPublicEmployee(employee: Employee): PublicEmployee {
  const { passwordHash: _omit, ...rest } = employee;
  void _omit;
  return rest;
}

/** Employee joined with its client's display name (for the directory). */
export interface EmployeeWithClient extends PublicEmployee {
  clientName: string | null;
}
