import Fastify, { type FastifyInstance } from "fastify";
import {
  TypeBoxTypeProvider,
  TypeBoxValidatorCompiler,
} from "@fastify/type-provider-typebox";

import "./config/typebox-formats"; // registers `email` format (side effect)
import { config } from "./config/env";
import configPlugin from "./plugins/config";
import errorHandler from "./plugins/error-handler";
import security from "./plugins/security";
import jwtPlugin from "./plugins/jwt";
import authorizePlugin from "./plugins/authorize";
import swaggerPlugin from "./plugins/swagger";
import healthRoutes from "./routes/health.routes";
import authRoutes from "./routes/auth.routes";
import inviteRoutes from "./routes/invite.routes";
import clientRoutes from "./routes/clients.routes";
import employeeRoutes from "./routes/employees.routes";
import meRoutes from "./routes/me.routes";
import jobRoutes from "./routes/jobs.routes";
import applicationRoutes from "./routes/applications.routes";
import careerRoutes from "./routes/career.routes";
import contactRoutes from "./routes/contact.routes";
import {
  DrizzleEmployeeRepository,
  type EmployeeRepository,
} from "./repositories/employee.repository";
import {
  DrizzleClientRepository,
  type ClientRepository,
} from "./repositories/client.repository";
import {
  DrizzleInviteRepository,
  type InviteRepository,
} from "./repositories/invite.repository";
import {
  DrizzlePasswordResetRepository,
  type PasswordResetRepository,
} from "./repositories/password-reset.repository";
import {
  DrizzleEngagementHistoryRepository,
  type EngagementHistoryRepository,
} from "./repositories/engagement-history.repository";
import {
  DrizzleJobRepository,
  type JobRepository,
} from "./repositories/job.repository";
import {
  DrizzleApplicationRepository,
  type ApplicationRepository,
} from "./repositories/application.repository";
import {
  DrizzleContactMessageRepository,
  type ContactMessageRepository,
} from "./repositories/contact-message.repository";
import { ChallengeStore } from "./repositories/challenge.store";
import { db, queryClient } from "./db/client";

declare module "fastify" {
  interface FastifyInstance {
    // The single identity + auth + workforce store.
    employees: EmployeeRepository;
    clients: ClientRepository;
    invites: InviteRepository;
    passwordResets: PasswordResetRepository;
    engagementHistory: EngagementHistoryRepository;
    jobs: JobRepository;
    applications: ApplicationRepository;
    contactMessages: ContactMessageRepository;
    challenges: ChallengeStore;
  }
}

const API_PREFIX = "/api/v1";

export interface BuildAppOptions {
  /**
   * Override the stores. Tests inject in-memory repositories so they never
   * touch a live database. Default to the Drizzle/Supabase-backed stores.
   */
  employeeRepository?: EmployeeRepository;
  clientRepository?: ClientRepository;
  inviteRepository?: InviteRepository;
  passwordResetRepository?: PasswordResetRepository;
  engagementHistoryRepository?: EngagementHistoryRepository;
  jobRepository?: JobRepository;
  applicationRepository?: ApplicationRepository;
  contactMessageRepository?: ContactMessageRepository;
}

/**
 * Composition root. Builds a fully-wired Fastify instance but does not listen —
 * keeping build and listen separate makes the app trivially testable.
 */
export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(),
    trustProxy: true,
    disableRequestLogging: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  // --- cross-cutting plugins (order matters) ---
  await app.register(configPlugin);
  await app.register(errorHandler);
  await app.register(security);
  await app.register(jwtPlugin);
  await app.register(authorizePlugin);
  await app.register(swaggerPlugin);

  // --- shared singletons ---
  const ownsDatabase = !options.employeeRepository;
  const employeeRepository =
    options.employeeRepository ?? new DrizzleEmployeeRepository(db);
  const clientRepository =
    options.clientRepository ?? new DrizzleClientRepository(db);
  const inviteRepository =
    options.inviteRepository ?? new DrizzleInviteRepository(db);
  const passwordResetRepository =
    options.passwordResetRepository ?? new DrizzlePasswordResetRepository(db);
  const engagementHistoryRepository =
    options.engagementHistoryRepository ??
    new DrizzleEngagementHistoryRepository(db);
  const jobRepository = options.jobRepository ?? new DrizzleJobRepository(db);
  const applicationRepository =
    options.applicationRepository ?? new DrizzleApplicationRepository(db);
  const contactMessageRepository =
    options.contactMessageRepository ??
    new DrizzleContactMessageRepository(db);

  app.decorate("employees", employeeRepository);
  app.decorate("clients", clientRepository);
  app.decorate("invites", inviteRepository);
  app.decorate("passwordResets", passwordResetRepository);
  app.decorate("engagementHistory", engagementHistoryRepository);
  app.decorate("jobs", jobRepository);
  app.decorate("applications", applicationRepository);
  app.decorate("contactMessages", contactMessageRepository);
  app.decorate(
    "challenges",
    new ChallengeStore(config.MFA_CHALLENGE_TTL_SECONDS),
  );

  // Close the DB pool with the app, but only if we created it.
  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      await queryClient.end({ timeout: 5 });
    });
  }

  // --- routes ---
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: API_PREFIX });
  await app.register(inviteRoutes, { prefix: API_PREFIX });
  await app.register(clientRoutes, { prefix: API_PREFIX });
  await app.register(employeeRoutes, { prefix: API_PREFIX });
  await app.register(meRoutes, { prefix: API_PREFIX });
  await app.register(jobRoutes, { prefix: API_PREFIX });
  await app.register(applicationRoutes, { prefix: API_PREFIX });
  await app.register(careerRoutes, { prefix: API_PREFIX });
  await app.register(contactRoutes, { prefix: API_PREFIX });

  await app.ready();
  return app;
}

function buildLoggerOptions() {
  const base = { level: config.LOG_LEVEL };
  if (config.isProduction) return base;
  return {
    ...base,
    transport: {
      target: "pino-pretty",
      options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
    },
  };
}
