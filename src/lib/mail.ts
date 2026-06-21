import type { FastifyBaseLogger } from "fastify";
import { Resend } from "resend";
import { config } from "../config/env";
import type { Role } from "../domain/employee";

/**
 * Email delivery. Uses Resend when RESEND_API_KEY is set; otherwise logs the
 * link so the invite / reset flows are fully testable in dev without an
 * account or credentials.
 */
const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text alternative. Improves deliverability — Gmail/Outlook penalize
   *  HTML-only automated mail and are more likely to file it as spam. */
  text?: string;
  /** Address replies should go to (e.g. a monitored inbox). */
  replyTo?: string;
  /** Logged in the dev fallback so the flow stays testable. */
  link: string;
  log: FastifyBaseLogger;
}

async function send({
  to,
  subject,
  html,
  text,
  replyTo,
  link,
  log,
}: SendArgs): Promise<void> {
  if (!resend) {
    log.info({ to, subject, link }, "✉️  email (dev fallback — no RESEND_API_KEY)");
    return;
  }
  const { data, error } = await resend.emails.send({
    from: config.MAIL_FROM,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
    ...(replyTo ? { replyTo } : {}),
  });
  if (error) {
    log.error({ err: error, to }, "Failed to send email via Resend");
    throw new Error("Email delivery failed.");
  }
  // Log success too, so a delivered-but-not-received report can be traced to a
  // Resend message id (and confirms the send actually happened).
  log.info({ to, subject, id: data?.id }, "✉️  email sent via Resend");
}

const roleLabel: Record<Role, string> = {
  ADMIN: "Admin",
  EMPLOYER: "Talent team",
  EMPLOYEE: "Employee",
};

export async function sendInviteEmail(args: {
  to: string;
  link: string;
  role: Role;
  clientName?: string | null;
  inviterName?: string | null;
  log: FastifyBaseLogger;
}): Promise<void> {
  const context =
    args.role === "EMPLOYEE" && args.clientName
      ? ` to join the engagement at <strong>${args.clientName}</strong>`
      : ` to the Technograph ${roleLabel[args.role].toLowerCase()}`;
  const inviter = args.inviterName ? `${args.inviterName} invited you` : "You've been invited";
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #14140f;">
      <h2 style="font-size: 20px;">Welcome to Technograph</h2>
      <p>${inviter}${context}. Set up your account to get started — the link expires soon.</p>
      <p style="margin: 28px 0;">
        <a href="${args.link}" style="background:#c26b2c;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;">Activate your account</a>
      </p>
      <p style="font-size:12px;color:#6b6b63;">Or paste this link into your browser:<br>${args.link}</p>
    </div>`;
  await send({
    to: args.to,
    subject: "You're invited to Technograph",
    html,
    link: args.link,
    log: args.log,
  });
}

/** Confirmation to a candidate who applied through the public careers page. */
export async function sendApplicationReceivedEmail(args: {
  to: string;
  applicantName: string;
  jobTitle: string;
  applicationCode: string;
  roleUrl: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  const first = args.applicantName.split(" ")[0] || "there";
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #14140f;">
      <h2 style="font-size: 20px;">Application received</h2>
      <p>Hi ${first}, thanks for applying to <strong>${args.jobTitle}</strong> at Technograph.</p>
      <p>Your application reference is <strong>${args.applicationCode}</strong>. Our talent team will review it and be in touch if there's a fit.</p>
      <p style="font-size:12px;color:#6b6b63;">You're receiving this because you applied at ${args.roleUrl}.</p>
    </div>`;
  await send({
    to: args.to,
    subject: `We received your application — ${args.jobTitle}`,
    html,
    link: args.roleUrl,
    log: args.log,
  });
}

/** Alert to the hiring team that a new candidate applied. */
export async function sendApplicationAlertEmail(args: {
  to: string | string[];
  applicantName: string;
  applicantEmail: string;
  jobTitle: string;
  applicationCode: string;
  boardUrl: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #14140f;">
      <h2 style="font-size: 20px;">New application</h2>
      <p><strong>${args.applicantName}</strong> applied to <strong>${args.jobTitle}</strong>.</p>
      <p style="font-size:13px;color:#3a3a33;">Email: ${args.applicantEmail}<br>Reference: ${args.applicationCode}</p>
      <p style="margin: 24px 0;">
        <a href="${args.boardUrl}" style="background:#c26b2c;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;">Review on the board</a>
      </p>
    </div>`;
  await send({
    to: args.to,
    subject: `New applicant for ${args.jobTitle} — ${args.applicantName}`,
    html,
    link: args.boardUrl,
    log: args.log,
  });
}

/** Confirmation to someone who submitted the public contact form. */
export async function sendContactReceivedEmail(args: {
  to: string;
  name: string;
  appUrl: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  console.log("Sending contact confirmation email to", args.to);
  const first = args.name.split(" ")[0] || "there";
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #14140f;">
      <h2 style="font-size: 20px;">Thanks for reaching out</h2>
      <p>Hi ${first}, we've received your message and a member of our team will get back to you.</p>
      <p style="font-size:12px;color:#6b6b63;">You're receiving this because you contacted Technograph at ${args.appUrl}.</p>
    </div>`;
  const text = `Hi ${first},

Thanks for reaching out to Technograph. We've received your message and a member of our team will get back to you.

You're receiving this because you contacted us at ${args.appUrl}.`;
  await send({
    to: args.to,
    subject: "We received your message — Technograph",
    html,
    text,
    // Replies to the auto-confirmation reach the team, not a no-reply void.
    replyTo: config.HIRING_NOTIFY_EMAIL.trim() || undefined,
    link: args.appUrl,
    log: args.log,
  });
}

/** Alert to the team that a new contact request came in. */
export async function sendContactAlertEmail(args: {
  to: string | string[];
  name: string;
  email: string;
  intent?: string;
  company?: string;
  phone?: string;
  message?: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  const row = (label: string, value?: string) =>
    value ? `<p style="margin:4px 0;font-size:13px;color:#3a3a33;"><strong>${label}:</strong> ${value}</p>` : "";
  const body = args.message
    ? `<p style="margin:16px 0 4px;font-size:13px;color:#3a3a33;"><strong>Message:</strong></p>
       <p style="margin:0;white-space:pre-wrap;color:#14140f;">${args.message}</p>`
    : "";
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #14140f;">
      <h2 style="font-size: 20px;">New contact request</h2>
      ${row("Intent", args.intent)}
      ${row("Name", args.name)}
      ${row("Email", args.email)}
      ${row("Company", args.company)}
      ${row("Phone", args.phone)}
      ${body}
    </div>`;
  await send({
    to: args.to,
    subject: `New contact request — ${args.name}`,
    html,
    link: `mailto:${args.email}`,
    log: args.log,
  });
}

export async function sendPasswordResetEmail(args: {
  to: string;
  link: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #14140f;">
      <h2 style="font-size: 20px;">Reset your password</h2>
      <p>We received a request to reset your Technograph password. This link expires in 30 minutes.</p>
      <p style="margin: 28px 0;">
        <a href="${args.link}" style="background:#c26b2c;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;">Choose a new password</a>
      </p>
      <p style="font-size:12px;color:#6b6b63;">If you didn't request this, you can safely ignore this email.</p>
    </div>`;
  await send({
    to: args.to,
    subject: "Reset your Technograph password",
    html,
    link: args.link,
    log: args.log,
  });
}
