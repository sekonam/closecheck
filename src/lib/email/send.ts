import { EmailStatus } from "@prisma/client";
import { withOrgScope, type ScopedTx } from "@/lib/db/scoped";

/**
 * Transactional email (docs/roadmap.md Phase 2.5). Provider: Resend, called with plain fetch — no
 * SDK dependency. Unset RESEND_API_KEY = dev fallback: the message is recorded in email_messages
 * with status LOGGED and echoed to the server console instead of delivered, so invites and portal
 * links keep working (via their existing copy-paste relays) before an email account exists.
 *
 * Every attempt — sent, failed, or logged — leaves an EmailMessage row (the org-RLS'd outbox/log
 * from migration 20260922090000), which is what makes the settings page's "what would have been
 * sent" view and the deliverability debugging story possible.
 *
 * Deliberately never throws into the caller: a provider outage must not crash a team invite whose
 * DB work already committed. Callers get the recorded status back and decide what (if anything) to
 * surface.
 */
export type SendEmailInput = {
  orgId: string;
  /** Reuse the caller's org-scoped transaction for the log row; omitted = a fresh withOrgScope. */
  tx?: ScopedTx;
  to: string;
  subject: string;
  /** Template slug for filtering the log, e.g. "team-invite" | "portal-link" | "receipt". */
  template: string;
  html: string;
  text: string;
};

export type SendEmailResult = { status: EmailStatus; error?: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 5_000;

async function recordEmail(
  input: SendEmailInput,
  data: { status: EmailStatus; providerId?: string; error?: string },
): Promise<void> {
  const write = (tx: ScopedTx) =>
    tx.emailMessage.create({
      data: {
        orgId: input.orgId,
        to: input.to,
        subject: input.subject,
        template: input.template,
        status: data.status,
        providerId: data.providerId ?? null,
        error: data.error ?? null,
      },
    });
  if (input.tx) {
    await write(input.tx);
  } else {
    await withOrgScope(input.orgId, write);
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  try {
    if (!apiKey || !from) {
      // Dev fallback — the console preview is the developer's "inbox".
      console.log(
        [
          "─".repeat(60),
          `[email:LOGGED] no RESEND_API_KEY/EMAIL_FROM configured`,
          `To:       ${input.to}`,
          `Subject:  ${input.subject}`,
          `Template: ${input.template}`,
          input.text,
          "─".repeat(60),
        ].join("\n"),
      );
      await recordEmail(input, { status: EmailStatus.LOGGED });
      return { status: EmailStatus.LOGGED };
    }

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = `Resend responded ${response.status}: ${body.slice(0, 300)}`;
      await recordEmail(input, { status: EmailStatus.FAILED, error });
      return { status: EmailStatus.FAILED, error };
    }

    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    await recordEmail(input, { status: EmailStatus.SENT, providerId: payload.id });
    return { status: EmailStatus.SENT };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Email send failed";
    // Even the log row is best-effort here — an email failure must never surface as a crashed
    // server action for work that already committed.
    await recordEmail(input, { status: EmailStatus.FAILED, error }).catch(() => {});
    return { status: EmailStatus.FAILED, error };
  }
}
