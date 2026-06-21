/** A client company that employees are placed at. */
export interface Client {
  id: string;
  name: string;
  location: string | null;
  contactEmail: string | null;
  createdAt: string;
}
