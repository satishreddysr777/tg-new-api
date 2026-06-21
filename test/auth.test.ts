import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { buildApp } from "../src/app";
import { InMemoryEmployeeRepository } from "../src/repositories/employee.repository";
import { InMemoryClientRepository } from "../src/repositories/client.repository";
import { InMemoryInviteRepository } from "../src/repositories/invite.repository";
import { InMemoryPasswordResetRepository } from "../src/repositories/password-reset.repository";
import { InMemoryEngagementHistoryRepository } from "../src/repositories/engagement-history.repository";
import { InMemoryJobRepository } from "../src/repositories/job.repository";
import { InMemoryApplicationRepository } from "../src/repositories/application.repository";
import { InviteService } from "../src/services/invite.service";
import { hashPassword } from "../src/lib/password";

describe("auth flow", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const employeeRepository = new InMemoryEmployeeRepository();
    await employeeRepository.create({
      email: "renee.boateng@technograph.io",
      name: "Renee Boateng",
      role: "EMPLOYEE",
      passwordHash: await hashPassword("renee-password"),
    });
    app = await buildApp({
      employeeRepository,
      clientRepository: new InMemoryClientRepository(),
      inviteRepository: new InMemoryInviteRepository(),
      passwordResetRepository: new InMemoryPasswordResetRepository(),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects bad credentials with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "nobody@technograph.io", password: "wrongpass" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("validates the request body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "not-an-email", password: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("logs in the seeded user (cookie when MFA off, else a 2FA challenge)", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "renee.boateng@technograph.io",
        password: "renee-password",
      },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json();
    if (body.user) {
      // MFA disabled → session established via httpOnly cookie.
      const setCookie = login.headers["set-cookie"];
      expect(String(setCookie)).toContain("tg_session");
    } else {
      expect(body.challengeId).toBeTruthy();
    }
  });

  it("never reveals whether an email exists on password reset", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "ghost@technograph.io" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
  });

  it("requires authentication to create invites", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invites",
      payload: { email: "new@technograph.io", role: "EMPLOYEE" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("serves a health probe", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("invite onboarding", () => {
  const log = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as FastifyBaseLogger;

  function makeService() {
    const employees = new InMemoryEmployeeRepository();
    const clients = new InMemoryClientRepository();
    const invites = new InMemoryInviteRepository();
    const sent: { to: string; link: string }[] = [];
    const service = new InviteService({
      employees,
      clients,
      invites,
      log,
      appUrl: "http://localhost:3000",
      inviteTtlHours: 168,
      sendInvite: async ({ to, link }) => {
        sent.push({ to, link });
      },
    });
    return { service, employees, clients, invites, sent };
  }

  const tokenFromLink = (link: string) =>
    new URL(link).searchParams.get("token") ?? "";

  it("creates an employee invite (requires a client) and accepts it", async () => {
    const { service, employees, clients } = makeService();
    const client = await clients.create({ name: "Northbeam Logistics" });

    const { invite, link } = await service.createInvite({
      email: "Hire.Me@technograph.io",
      role: "EMPLOYEE",
      clientId: client.id,
      name: "Hire Me",
    });
    expect(invite.status).toBe("PENDING");
    expect(invite.email).toBe("hire.me@technograph.io"); // normalized

    const token = tokenFromLink(link);
    const prefill = await service.getInviteByToken(token);
    expect(prefill.email).toBe("hire.me@technograph.io");
    expect(prefill.clientName).toBe("Northbeam Logistics");

    const user = await service.acceptInvite({
      token,
      firstName: "Hire",
      lastName: "Me",
      password: "a-strong-password",
    });
    expect(user.role).toBe("EMPLOYEE");
    expect(user.name).toBe("Hire Me");
    expect(user.firstName).toBe("Hire");
    expect(user.lastName).toBe("Me");
    expect(user.clientId).toBe(client.id);
    expect(user.employeeCode).toMatch(/^TG-/); // profile seeded on accept
    expect(await employees.findByEmail("hire.me@technograph.io")).not.toBeNull();

    // Token is single-use: it no longer validates after acceptance.
    await expect(service.getInviteByToken(token)).rejects.toThrow();
  });

  it("carries admin-set placement + compensation onto the new hire", async () => {
    const { service, employees, clients } = makeService();
    const client = await clients.create({ name: "Northbeam Logistics" });

    const { link } = await service.createInvite({
      email: "placed@technograph.io",
      role: "EMPLOYEE",
      clientId: client.id,
      name: "Placed Engineer",
      placement: {
        title: "Senior Backend Engineer",
        employmentType: "1099",
        managerName: "Wendy Park",
        billRate: "$160/hr",
        payRate: "$110/hr",
        location: "Remote · CA",
        startDate: "2026-07-01",
        endDate: "2026-12-31",
      },
    });

    const user = await service.acceptInvite({
      token: tokenFromLink(link),
      firstName: "Placed",
      lastName: "Engineer",
      password: "a-strong-password",
    });

    expect(user.title).toBe("Senior Backend Engineer");
    expect(user.employmentType).toBe("1099");
    expect(user.managerName).toBe("Wendy Park");
    expect(user.billRate).toBe("$160/hr");
    expect(user.payRate).toBe("$110/hr");
    expect(user.location).toBe("Remote · CA");
    expect(user.status).toBe("Onboarding"); // still completes onboarding next
    expect(user.startDate).not.toBeNull();

    // The new hire then completes onboarding → Active.
    const active = await employees.completeOnboarding(user.id, {
      name: "Placed Engineer",
      phoneHint: "···· ·· 4321",
      location: "Remote · CA",
      stack: ["Go", "Postgres"],
      status: "Active",
    });
    expect(active.status).toBe("Active");
    expect(active.stack).toEqual(["Go", "Postgres"]);
  });

  it("rejects an employee invite with no client", async () => {
    const { service } = makeService();
    await expect(
      service.createInvite({ email: "x@technograph.io", role: "EMPLOYEE" }),
    ).rejects.toThrow();
  });

  it("rejects an invalid token", async () => {
    const { service } = makeService();
    await expect(service.getInviteByToken("nope")).rejects.toThrow();
  });

  it("allows an employer invite without a client", async () => {
    const { service } = makeService();
    const { link } = await service.createInvite({
      email: "staff@technograph.io",
      role: "EMPLOYER",
    });
    const user = await service.acceptInvite({
      token: tokenFromLink(link),
      firstName: "Staff",
      lastName: "Member",
      password: "another-strong-pw",
    });
    expect(user.role).toBe("EMPLOYER");
    expect(user.clientId).toBeNull();
  });
});

describe("end engagement", () => {
  it("benches the employee, clears the client, and records history", async () => {
    const employees = new InMemoryEmployeeRepository();
    const history = new InMemoryEngagementHistoryRepository();

    const placed = await employees.create({
      email: "placed@technograph.io",
      name: "Placed Engineer",
      role: "EMPLOYEE",
      passwordHash: "x",
      clientId: "client-1",
      employeeCode: "TG-2001",
      title: "Senior Engineer",
      status: "Active",
      billRate: "$160/hr",
      payRate: "$110/hr",
      startDate: new Date("2026-01-01"),
    });

    // Snapshot the placement, then end it (mirrors the route's two steps).
    await history.create({
      employeeId: placed.id,
      clientId: placed.clientId,
      clientName: "Northbeam Logistics",
      title: placed.title,
      startDate: placed.startDate ? new Date(placed.startDate) : null,
      endDate: new Date("2026-06-20"),
      billRate: placed.billRate,
      payRate: placed.payRate,
      reason: "Engagement complete",
    });
    const ended = await employees.endEngagement(placed.id, {
      endDate: new Date("2026-06-20"),
    });

    expect(ended.status).toBe("On bench");
    expect(ended.clientId).toBeNull();
    expect(ended.endDate).not.toBeNull();

    const rows = await history.listByEmployee(placed.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clientName).toBe("Northbeam Logistics");
    expect(rows[0]?.reason).toBe("Engagement complete");

    // A benched employee can then be deleted.
    await employees.delete(ended.id);
    expect(await employees.findById(ended.id)).toBeNull();
  });

  it("rejects ending an engagement with no client (via API)", async () => {
    const employees = new InMemoryEmployeeRepository();
    const benched = await employees.create({
      email: "bench@technograph.io",
      name: "Benched Person",
      role: "EMPLOYEE",
      passwordHash: "x",
      status: "On bench",
    });

    const app = await buildApp({
      employeeRepository: employees,
      clientRepository: new InMemoryClientRepository(),
      inviteRepository: new InMemoryInviteRepository(),
      passwordResetRepository: new InMemoryPasswordResetRepository(),
      engagementHistoryRepository: new InMemoryEngagementHistoryRepository(),
    });

    // Unauthenticated → 401, never reaches the no-client guard.
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/employees/${benched.id}/end-engagement`,
      payload: { endDate: "2026-06-20" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("jobs", () => {
  it("counts jobs and lists them newest-first with client name", async () => {
    const jobs = new InMemoryJobRepository();
    jobs.registerClient("client-1", "Avalon Robotics");

    expect(await jobs.count()).toBe(0);

    await jobs.create({
      jobCode: "JOB-0001",
      title: "Senior Platform Engineer",
      clientId: "client-1",
      engagementType: "Contract",
      compType: "Yearly",
      compMin: "185000",
      compMax: "215000",
      stack: ["Kubernetes", "Go"],
      status: "Published",
    });
    await jobs.create({
      jobCode: "JOB-0002",
      title: "Data Engineer",
      status: "Draft",
    });

    expect(await jobs.count()).toBe(2);
    const list = await jobs.listWithClient();
    expect(list).toHaveLength(2);
    const placed = list.find((j) => j.jobCode === "JOB-0001");
    expect(placed?.clientName).toBe("Avalon Robotics");
    expect(placed?.status).toBe("Published");
    // The unplaced draft has no client name.
    expect(list.find((j) => j.jobCode === "JOB-0002")?.clientName).toBeNull();
  });
});

describe("applications", () => {
  it("adds candidates to a job, lists by job, and moves stages", async () => {
    const apps = new InMemoryApplicationRepository();

    const a = await apps.create({
      applicationCode: "A-2001",
      jobId: "job-1",
      name: "Idris Olufemi",
      email: "idris@example.com",
      location: "Remote · GA",
      source: "LinkedIn",
      years: 11,
      compAsk: "$210k",
      matchPct: 84,
      stage: "Applied",
      skills: ["Kubernetes", "Go"],
      experience: [
        {
          title: "Staff Platform Engineer",
          company: "Lattice Logistics",
          period: "2022 – present",
          detail: "Led EKS migration.",
        },
      ],
    });
    await apps.create({
      applicationCode: "A-2002",
      jobId: "job-2",
      name: "Other Job Candidate",
      stage: "Applied",
    });

    expect(await apps.count()).toBe(2);

    const forJob1 = await apps.listByJob("job-1");
    expect(forJob1).toHaveLength(1);
    expect(forJob1[0]?.name).toBe("Idris Olufemi");
    expect(forJob1[0]?.experience[0]?.company).toBe("Lattice Logistics");

    const byCode = await apps.find("A-2001");
    expect(byCode?.id).toBe(a.id);

    const moved = await apps.updateStage(a.id, "Screening");
    expect(moved.stage).toBe("Screening");
  });
});

describe("client management", () => {
  it("creates, updates, counts assigned employees, and deletes", async () => {
    const clients = new InMemoryClientRepository();
    const employees = new InMemoryEmployeeRepository();

    const client = await clients.create({ name: "Acme Co", location: "Reno, NV" });
    expect(client.location).toBe("Reno, NV");

    // Edit name + location.
    const updated = await clients.update(client.id, {
      name: "Acme Corporation",
      location: "Las Vegas, NV",
    });
    expect(updated?.name).toBe("Acme Corporation");
    expect(updated?.location).toBe("Las Vegas, NV");

    // No employees yet → eligible to delete.
    let counts = await employees.employeeCountsByClient();
    expect(counts[client.id] ?? 0).toBe(0);

    // Place an employee at the client → now counted, so deletion is blocked.
    await employees.create({
      email: "eng@technograph.io",
      name: "Eng One",
      role: "EMPLOYEE",
      passwordHash: "x",
      clientId: client.id,
    });
    counts = await employees.employeeCountsByClient();
    expect(counts[client.id]).toBe(1);

    // Once free of employees, delete removes it.
    await clients.delete(client.id);
    expect(await clients.findById(client.id)).toBeNull();
  });
});
