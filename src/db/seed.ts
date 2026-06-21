import { db, queryClient } from "./client";
import { DrizzleClientRepository } from "../repositories/client.repository";
import { DrizzleEmployeeRepository } from "../repositories/employee.repository";
import { hashPassword } from "../lib/password";
import type { EmployeeStatus, EmploymentType, Role } from "../domain/employee";

/**
 * Standalone seeding entrypoint: `npm run db:seed`.
 * Idempotent — safe to re-run. Ensures the demo clients, staff (admin +
 * employer), and the design's workforce all exist in the single employees
 * table.
 */
const CLIENTS: { name: string; location: string }[] = [
  { name: "Northbeam Logistics", location: "Oakland, CA" },
  { name: "Klein Financial", location: "New York, NY" },
  { name: "Avalon Robotics", location: "Boston, MA" },
  { name: "Halcyon Health", location: "Austin, TX" },
  { name: "Northwind Bank", location: "Charlotte, NC" },
  { name: "Lumen Health", location: "Seattle, WA" },
];

interface StaffUser {
  email: string;
  name: string;
  role: Role;
  password: string;
}

const STAFF: StaffUser[] = [
  { email: "admin@technograph.com", name: "Noé Aguilar", role: "ADMIN", password: "password" },
  { email: "wendy.park@technograph.io", name: "Wendy Park", role: "EMPLOYER", password: "wendy-password" },
];

interface SeedEmployee {
  code: string;
  name: string;
  title: string;
  client: string | null;
  type: EmploymentType;
  status: EmployeeStatus;
  rate: string;
  pay: string;
  manager: string;
  location: string;
  start: string | null;
  end: string | null;
  stack: string[];
}

const EMPLOYEES: SeedEmployee[] = [
  { code: "TG-0148", name: "Renee Boateng", title: "Sr Platform Engineer", client: "Northbeam Logistics", type: "W-2", status: "Active", rate: "$165/hr", pay: "$112/hr", manager: "Wendy Park", location: "Oakland, CA", start: "Jan 13, 2026", end: "Aug 22, 2026", stack: ["Kubernetes", "Go", "AWS · EKS", "Terraform"] },
  { code: "TG-0152", name: "Marcus Liang", title: "Staff Data Engineer", client: "Klein Financial", type: "W-2", status: "Active", rate: "$155/hr", pay: "$105/hr", manager: "Andrés Holm", location: "New York, NY", start: "Feb 03, 2026", end: "Aug 03, 2026", stack: ["Spark", "Kafka", "Scala", "Airflow"] },
  { code: "TG-0119", name: "Priya Subramanian", title: "SRE Lead", client: "Halcyon Health", type: "W-2", status: "Active", rate: "$182/hr", pay: "$124/hr", manager: "Wendy Park", location: "Remote · TX", start: "Oct 14, 2025", end: "Apr 14, 2026", stack: ["Terraform", "Datadog", "Go", "AWS"] },
  { code: "TG-0166", name: "Kai Mendoza", title: "ML Platform Engineer", client: "Avalon Robotics", type: "1099", status: "Active", rate: "$170/hr", pay: "$150/hr", manager: "Andrés Holm", location: "Boston, MA", start: "Mar 11, 2026", end: "Sep 11, 2026", stack: ["PyTorch", "Ray", "Python", "CUDA"] },
  { code: "TG-0142", name: "Hana Okonkwo", title: "Senior IAM Engineer", client: "Northwind Bank", type: "W-2", status: "Active", rate: "$158/hr", pay: "$107/hr", manager: "Wendy Park", location: "Charlotte, NC", start: "Dec 02, 2025", end: "Jun 02, 2026", stack: ["Okta", "OAuth", "Java", "SAML"] },
  { code: "TG-0174", name: "Ben Halverson", title: "Senior iOS Engineer", client: "Lumen Health", type: "W-2", status: "Onboarding", rate: "$140/hr", pay: "$95/hr", manager: "Wendy Park", location: "Remote · WA", start: "May 18, 2026", end: "Nov 18, 2026", stack: ["Swift", "SwiftUI", "Combine"] },
  { code: "TG-0095", name: "Sofía Reyes", title: "Full-stack Engineer", client: null, type: "W-2", status: "On bench", rate: "$135/hr", pay: "$92/hr", manager: "Wendy Park", location: "Austin, TX", start: null, end: null, stack: ["React", "Node", "Postgres"] },
  { code: "TG-0181", name: "Dmitri Volkov", title: "Staff Backend Engineer", client: "Klein Financial", type: "W-2", status: "Active", rate: "$175/hr", pay: "$119/hr", manager: "Andrés Holm", location: "Brooklyn, NY", start: "Apr 07, 2026", end: "Oct 07, 2026", stack: ["Go", "gRPC", "Postgres", "Redis"] },
];

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "");

const emailFor = (name: string) =>
  stripAccents(name).toLowerCase().replace(/[^a-z ]/g, "").trim().replace(/ +/g, ".") +
  "@technograph.io";

const firstName = (name: string) => stripAccents(name).split(" ")[0]!.toLowerCase();

async function main() {
  const clients = new DrizzleClientRepository(db);
  const employees = new DrizzleEmployeeRepository(db);

  // Clients (idempotent by name).
  const existingClients = await clients.list();
  const clientIdByName = new Map(existingClients.map((c) => [c.name, c.id]));
  for (const { name, location } of CLIENTS) {
    if (!clientIdByName.has(name)) {
      const created = await clients.create({ name, location });
      clientIdByName.set(name, created.id);
    }
  }

  // Staff (idempotent by email) — no workforce profile.
  for (const s of STAFF) {
    if (await employees.findByEmail(s.email)) continue;
    await employees.create({
      email: s.email,
      name: s.name,
      role: s.role,
      passwordHash: await hashPassword(s.password),
    });
  }

  // Placed engineers — one employees row each (identity + profile).
  for (const e of EMPLOYEES) {
    const email = emailFor(e.name);
    const clientId = e.client ? (clientIdByName.get(e.client) ?? null) : null;

    const existing = await employees.findByEmail(email);
    if (existing) {
      if (existing.clientId !== clientId) await employees.setClientId(existing.id, clientId);
      continue;
    }

    await employees.create({
      email,
      name: e.name,
      role: "EMPLOYEE",
      passwordHash: await hashPassword(`${firstName(e.name)}-password`),
      clientId,
      employeeCode: e.code,
      title: e.title,
      employmentType: e.type,
      status: e.status,
      billRate: e.rate,
      payRate: e.pay,
      managerName: e.manager,
      location: e.location,
      startDate: e.start ? new Date(e.start) : null,
      endDate: e.end ? new Date(e.end) : null,
      stack: e.stack,
    });
  }

  // Jobs are intentionally NOT seeded — created through the app during testing.

  // eslint-disable-next-line no-console
  console.log(
    `✓ Seed complete — ${CLIENTS.length} clients, ${STAFF.length} staff, ${EMPLOYEES.length} employees ensured.`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("✗ Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => queryClient.end());
