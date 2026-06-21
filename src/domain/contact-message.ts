/** A message submitted through the public marketing contact form. */
export type ContactStatus = "NEW" | "READ" | "ARCHIVED";

export interface ContactMessage {
  id: string;
  intent: string | null;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  message: string | null;
  status: ContactStatus;
  createdAt: string;
}
