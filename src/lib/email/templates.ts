/**
 * Transactional email templates (docs/roadmap.md Phase 2.5). Plain semantic HTML with inline
 * styles, no external assets (images/fonts/CSS would need a hosted asset pipeline and tank spam
 * scores for a new sending domain). Deliberately CloseCheck-neutral in tone: the consultant's brand
 * belongs on the REPORT (spec.md §2 principle 4); these are account-plumbing messages from the
 * product itself.
 */

export type RenderedEmail = { subject: string; html: string; text: string };

function appUrl(path: string): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:18px;">${escapeHtml(title)}</h1>
      ${bodyHtml}
      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">Sent by CloseCheck on behalf of your firm's account.</p>
    </div>
  </body>
</html>`;
}

export function teamInvite(params: {
  inviterName: string;
  orgName: string;
  email: string;
  tempPassword: string;
  loginUrl?: string;
}): RenderedEmail {
  const loginUrl = params.loginUrl ?? appUrl("/login");
  const subject = `${params.inviterName} invited you to ${params.orgName} on CloseCheck`;
  const text = [
    `${params.inviterName} invited you to join ${params.orgName} on CloseCheck.`,
    ``,
    `Sign in at: ${loginUrl}`,
    `Email: ${params.email}`,
    `Temporary password: ${params.tempPassword}`,
    ``,
    `Change your password after your first sign-in.`,
  ].join("\n");
  const html = layout(
    `You're invited to ${params.orgName}`,
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${escapeHtml(params.inviterName)} invited you to join <strong>${escapeHtml(params.orgName)}</strong> on CloseCheck.</p>
     <p style="margin:0 0 4px;font-size:14px;">Email: <strong>${escapeHtml(params.email)}</strong></p>
     <p style="margin:0 0 16px;font-size:14px;">Temporary password: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">${escapeHtml(params.tempPassword)}</code></p>
     <p style="margin:0 0 16px;"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">Sign in</a></p>
     <p style="margin:0;font-size:13px;color:#64748b;">Change your password after your first sign-in.</p>`,
  );
  return { subject, html, text };
}

export function portalLink(params: { businessName: string; url: string; expiresAt: Date }): RenderedEmail {
  const expires = params.expiresAt.toISOString().slice(0, 10);
  const subject = `Due-diligence report: ${params.businessName}`;
  const text = [
    `A due-diligence report for ${params.businessName} has been shared with you.`,
    ``,
    `View it here (no account needed): ${params.url}`,
    ``,
    `This link expires on ${expires}. Please don't forward it — anyone with the link can view the report.`,
  ].join("\n");
  const html = layout(
    `Report shared: ${params.businessName}`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">A due-diligence report for <strong>${escapeHtml(params.businessName)}</strong> has been shared with you. No account is needed.</p>
     <p style="margin:0 0 16px;"><a href="${escapeHtml(params.url)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">View the report</a></p>
     <p style="margin:0;font-size:13px;color:#64748b;">This link expires on ${expires}. Please don't forward it — anyone with the link can view the report.</p>`,
  );
  return { subject, html, text };
}

/** Used by billing (parent stream) once receipts wire up — exported, not yet called anywhere. */
export function receipt(params: { orgName: string; description: string; amountFormatted: string }): RenderedEmail {
  const subject = `CloseCheck receipt — ${params.description}`;
  const text = [
    `Receipt for ${params.orgName}`,
    ``,
    `${params.description}: ${params.amountFormatted}`,
    ``,
    `Manage billing from your CloseCheck settings page: ${appUrl("/settings")}`,
  ].join("\n");
  const html = layout(
    "Receipt",
    `<p style="margin:0 0 8px;font-size:14px;">Receipt for <strong>${escapeHtml(params.orgName)}</strong></p>
     <p style="margin:0 0 16px;font-size:14px;">${escapeHtml(params.description)}: <strong>${escapeHtml(params.amountFormatted)}</strong></p>
     <p style="margin:0;font-size:13px;color:#64748b;">Manage billing from your <a href="${escapeHtml(appUrl("/settings"))}" style="color:#0f172a;">CloseCheck settings page</a>.</p>`,
  );
  return { subject, html, text };
}
