export type ApplicationStage =
  | "Applied"
  | "Screening"
  | "Interview"
  | "Offer"
  | "Hired"
  | "Rejected";

export const APPLICATION_STAGES: ApplicationStage[] = [
  "Applied",
  "Screening",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
];

export interface ApplicationExperience {
  title: string;
  company: string;
  period: string;
  detail: string;
}

/** A candidate applying to a job. */
export interface Application {
  id: string;
  applicationCode: string; // A-####
  jobId: string;
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  source: string | null;
  years: number | null;
  compAsk: string | null;
  matchPct: number | null;
  stage: ApplicationStage;
  summary: string | null;
  skills: string[];
  linkedin: string | null;
  resumeName: string | null; // original filename; null = no résumé
  experience: ApplicationExperience[];
  appliedAt: string; // ISO
  createdAt: string;
}

/** An application joined with the job it targets — for the employee portal. */
export interface ApplicationWithJob extends Application {
  jobTitle: string;
  jobCode: string;
  jobClientName: string | null;
}
