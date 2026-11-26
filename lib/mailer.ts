import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound mail goes through Zoho Mail SMTP on port 587 (STARTTLS).
 * Ports 465 and 25 are blocked egress on this VPS, so do not "fix" this by
 * switching to 465. Everything is env-driven so the E2E harness can point it
 * at a local SMTP sink.
 */
export const MAIL_FROM =
  process.env.MAIL_FROM?.trim() || "ST0NE QUIZ <contact@autoanaf.ro>";

/** Public origin used to build the links inside emails. */
export function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

const g = globalThis as unknown as { __stoneMailer?: Transporter };

function transport(): Transporter {
  if (g.__stoneMailer) return g.__stoneMailer;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error("MAIL_NOT_CONFIGURED");
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD ?? "";
  const t = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: Boolean(user) && port !== 465,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  g.__stoneMailer = t;
  return t;
}

export async function sendMail(msg: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!mailConfigured()) throw new Error("MAIL_NOT_CONFIGURED");
  await transport().sendMail({ from: MAIL_FROM, ...msg });
}
