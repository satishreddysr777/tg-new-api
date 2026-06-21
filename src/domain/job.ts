export type JobStatus = "Draft" | "Published";

/** A hiring requisition. */
export interface Job {
  id: string;
  jobCode: string; // JOB-####
  title: string;
  clientId: string | null;
  hiringManager: string | null;
  department: string | null;
  engagementType: string | null; // "Direct hire" | "Contract"
  location: string | null;
  headcount: number;
  compType: string | null; // "Yearly" | "Hourly"
  compMin: string | null;
  compMax: string | null;
  stack: string[];
  summary: string | null;
  responsibilities: string | null;
  status: JobStatus;
  createdAt: string;
}

/** Job joined with its client's display name (for listings). */
export interface JobWithClient extends Job {
  clientName: string | null;
}
