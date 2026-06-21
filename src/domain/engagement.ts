/** A past placement, recorded when an engagement is ended. */
export interface EngagementHistory {
  id: string;
  employeeId: string | null; // null once the employee is deleted
  clientId: string | null;
  clientName: string; // snapshot — survives client deletion
  title: string | null;
  startDate: string | null; // ISO
  endDate: string; // ISO
  billRate: string | null;
  payRate: string | null;
  reason: string | null;
  createdAt: string;
}
