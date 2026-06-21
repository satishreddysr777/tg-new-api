import type { EmploymentType, Role } from "./employee";

export type InviteStatus = "PENDING" | "ACCEPTED" | "REVOKED";

/** A pending onboarding invitation. `tokenHash` never leaves the repository. */
export interface Invite {
  id: string;
  email: string;
  tokenHash: string;
  role: Role;
  clientId: string | null;
  name: string | null;
  // Placement + compensation the admin set up front (null for staff invites);
  // copied onto the employee record when the invite is accepted.
  title: string | null;
  employmentType: EmploymentType | null;
  managerName: string | null;
  billRate: string | null;
  payRate: string | null;
  location: string | null;
  startDate: string | null; // ISO
  endDate: string | null; // ISO
  invitedBy: string | null;
  status: InviteStatus;
  expiresAt: string; // ISO
  acceptedAt: string | null;
  createdAt: string;
}

/** Public shape used to prefill the onboarding form (no token, no ids). */
export interface InvitePrefill {
  email: string;
  role: Role;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  clientName: string | null;
}
