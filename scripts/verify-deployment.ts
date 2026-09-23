/**
 * One command that checks whether a deployment is actually wired up, instead of asking an operator
 * to eyeball twelve runbook steps.
 *
 * docs/deployment.md is a sequence of manual steps whose failures are mostly silent: role passwords
 * left on the migration defaults, templates published two versions behind, a storage backend that
 * answers but is the wrong bucket, a Stripe price id that no longer exists. None of those announce
 * themselves — the app boots and serves, and the problem surfaces later as a support conversation
 * or, for the storage cases, as documents nobody can find.
 *
 * WHAT THIS IS NOT. It is not a health check and not a substitute for the launch gates in
 * docs/releases.md §5 — those turn on evidence a human has to produce (a real charge, a real
 * refund, a stranger receiving an invite). This answers the narrower question the runbook leaves to
 * attention: is the thing configured the way the runbook says to configure it.
 *
 * Safe to run against production. It reads, and it writes exactly one storage object under a
 * reserved prefix which it then deletes. It never prints a secret — only whether one is present and
 * whether it works.
 *
 * Run with: npm run verify:deployment
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  assertStorageUsable,
  deleteObjectIfPresentAcrossOrgs,
  describeStorage,
  getObject,
  putObject,
  storageBackend,
} from "../src/lib/storage/objectStore";

type Result = { ok: boolean; label: string; detail?: string };
const results: Result[] = [];

function record(ok: boolean, label: string, detail?: string) {
  results.push({ ok, label, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${label}${detail ? `\n          ${detail}` : ""}`);
}

function section(title: string) {
  console.log(`\n${title}`);
  console.log("-".repeat(72));
}

/** The passwords prisma/migrations/* create the narrow roles with. Any of these still in a
 * connection string means step 6 of the runbook was skipped, and the database is reachable by
 * anyone who has read the repository. */
const DEV_DEFAULT_PASSWORDS = [
  "closecheck_app_dev",
  "closecheck_auth_dev",
  "closecheck_signup_dev",
  "closecheck_portal_dev",
  "closecheck_api_dev",
  "closecheck_dev",
];

const ROLE_URLS = [
  ["DATABASE_URL", "closecheck_app"],
  ["AUTH_DATABASE_URL", "closecheck_auth"],
  ["SIGNUP_DATABASE_URL", "closecheck_signup"],
  ["PORTAL_DATABASE_URL", "closecheck_portal"],
  ["API_DATABASE_URL", "closecheck_api"],
] as const;

const isProduction = process.env.NODE_ENV === "production";

async function checkEnvironment() {
  section("Environment");

  record(!!process.env.DIRECT_DATABASE_URL, "DIRECT_DATABASE_URL is set");

  const authSecret = process.env.AUTH_SECRET;
  record(
    !!authSecret && authSecret !== "CHANGE_ME" && authSecret.length >= 16,
    "AUTH_SECRET is set and is not the placeholder",
    authSecret === "CHANGE_ME" ? "Still the .env.example placeholder — every session token is forgeable." : undefined,
  );

  const url = process.env.NEXTAUTH_URL;
  record(!!url, "NEXTAUTH_URL is set", url ? undefined : "Sign-in redirects and portal links will point at localhost.");
  if (url && isProduction) {
    record(url.startsWith("https://"), "NEXTAUTH_URL is https in production");
  }

  // Not defaulted, because getting it wrong in the permissive direction lets a caller forge the
  // address every rate limit is keyed on — see src/lib/api/rateLimit.ts.
  const hops = process.env.TRUSTED_PROXY_HOPS;
  if (hops === undefined && !isProduction) {
    console.log("  note  TRUSTED_PROXY_HOPS unset (defaults to 1; only matters once deployed)");
  } else {
    record(
      hops !== undefined,
      "TRUSTED_PROXY_HOPS is set explicitly",
      hops === undefined
        ? "Defaults to 1. Correct behind Render/Fly/one nginx; wrong anywhere else, in a way that is not visible at runtime."
        : `= ${hops}`,
    );
  }
}

async function checkDatabaseRoles() {
  section("Database roles");

  for (const [envVar, role] of ROLE_URLS) {
    const value = process.env[envVar];
    if (!value) {
      record(false, `${envVar} is set`, `The ${role} role has no connection string.`);
      continue;
    }
    const usesDevPassword = DEV_DEFAULT_PASSWORDS.some((p) => value.includes(`:${p}@`));
    if (usesDevPassword && !isProduction) {
      // Expected on a development machine — the migrations create these roles with exactly these
      // passwords. Reporting it as a failure here would put five permanent FAILs in front of anyone
      // running this locally, which is how the output stops being read.
      console.log(`  note  ${envVar} uses the migration default (fine locally, fatal in production)`);
    } else {
      record(
        !usesDevPassword,
        `${envVar} is not on the migration's default password`,
        usesDevPassword
          ? `${role} still uses the password prisma/migrations creates it with, which is in the repository. Run scripts/rotate-production-role-passwords.ts.`
          : undefined,
      );
    }

    const client = new PrismaClient({ datasourceUrl: value });
    try {
      await client.$queryRaw`SELECT 1`;
      record(true, `${envVar} connects`);
    } catch (err) {
      record(false, `${envVar} connects`, err instanceof Error ? err.message.split("\n")[0] : String(err));
    } finally {
      await client.$disconnect();
    }
  }
}

async function checkSchemaAndIsolation(direct: PrismaClient) {
  section("Schema and tenant isolation");

  const pending = await direct.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NULL
  `.catch(() => null);
  record(pending !== null && Number(pending[0]?.n ?? 0) === 0, "No unfinished migrations");

  /**
   * Every org-owned table must be isolated, and there are TWO legitimate ways to do it.
   *
   * Most tables use forced row-level security. `metric_events` and `error_events` deliberately do
   * not: they are write-only telemetry, and their isolation is that the app role holds INSERT and
   * no SELECT at all (see src/lib/metrics/record.ts). Checking only for RLS reports those two as
   * unprotected, which is how a check earns a permanent place in the "known failures, ignore them"
   * column and stops being read.
   *
   * So the invariant is the real one: forced RLS, OR no SELECT for the application role.
   */
  const appRole =
    /:\/\/([^:]+):/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "closecheck_app";

  const unprotected = await direct.$queryRaw<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = c.relname AND column_name = 'orgId')
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      AND EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                  WHERE g.table_name = c.relname
                    AND g.grantee = ${appRole}
                    AND g.privilege_type = 'SELECT')
  `;
  record(
    unprotected.length === 0,
    `Every org-owned table is isolated — forced RLS, or no SELECT for ${appRole}`,
    unprotected.length
      ? `Neither: ${unprotected.map((r) => r.relname).join(", ")}. These are readable across tenants.`
      : undefined,
  );
}

async function checkTemplates(direct: PrismaClient) {
  section("Template content");

  const active = await direct.template.findMany({
    where: { isActive: true },
    select: { slug: true, version: true },
    orderBy: { slug: "asc" },
  });
  record(active.length > 0, "At least one active template exists", active.length ? undefined : "Run npm run db:seed.");
  if (active.length === 0) return;

  const versions = [...new Set(active.map((t) => t.version))];
  record(
    versions.length === 1,
    "All active templates are on the same version",
    versions.length > 1 ? `Mixed: ${active.map((t) => `${t.slug} v${t.version}`).join(", ")}` : `v${versions[0]}`,
  );

  // A publish script that was skipped leaves the newest version sitting unpublished, which looks
  // like nothing at all — the product simply runs older content.
  const highest = await direct.template.aggregate({ _max: { version: true } });
  record(
    versions[0] === highest._max.version,
    "Active templates are the newest published version",
    versions[0] !== highest._max.version
      ? `Active is v${versions[0]} but v${highest._max.version} exists. Run the remaining db:publish-* scripts in docs/deployment.md order.`
      : undefined,
  );
}

async function checkStorage() {
  section("Object storage");

  console.log(`  Backend: ${describeStorage()}`);

  try {
    await assertStorageUsable();
    record(true, "Storage backend is reachable");
  } catch (err) {
    record(false, "Storage backend is reachable", err instanceof Error ? err.message : String(err));
    return;
  }

  if (isProduction && storageBackend().kind === "local" && process.env.STORAGE_ACKNOWLEDGE_LOCAL !== "true") {
    record(
      false,
      "Production storage has been acknowledged",
      "Running on local disk. Supported only if that path is a mounted persistent volume; it gives no encryption at rest and no redundancy. Set STORAGE_ACKNOWLEDGE_LOCAL=true once you have confirmed the mount, or configure STORAGE_S3_BUCKET.",
    );
  }

  /**
   * The round trip docs/BLOCKED.md asks for: write, read, delete. This is what retires the "not yet
   * exercised against a real endpoint" caveat on the S3 backend, so it runs the real path rather
   * than probing for reachability.
   *
   * The prefix is a reserved pseudo-org so the key passes the same tenancy guard every real read
   * goes through — proving the guard admits legitimate use, not only that it refuses abuse. It
   * cannot collide with a real orgId, which is always a cuid.
   */
  const probeOrg = "_deployment-check";
  const key = `${probeOrg}/probe-${randomUUID()}.txt`;
  const payload = Buffer.from(`closecheck deployment probe ${new Date().toISOString()}`);
  try {
    await putObject(probeOrg, key, payload, "text/plain");
    const read = await getObject(probeOrg, key);
    record(read.equals(payload), "Wrote, read back and matched a real object");
    const outcome = await deleteObjectIfPresentAcrossOrgs(key);
    record(outcome === "deleted", "Deleted it again", outcome === "deleted" ? undefined : `Delete reported "${outcome}".`);
  } catch (err) {
    record(false, "Storage round trip (write, read, delete)", err instanceof Error ? err.message : String(err));
  }
}

async function checkBilling() {
  section("Billing");

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    record(true, "Stripe not configured — billing runs in grace mode", "No checkout surface is shown. Expected until the Phase 2.5 gate.");
    return;
  }

  record(!!process.env.STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_SECRET is set",
    process.env.STRIPE_WEBHOOK_SECRET ? undefined : "Without it the webhook route returns 503 and no subscription state is ever recorded.");

  if (isProduction) {
    record(key.startsWith("sk_live_"), "Stripe key is live-mode in production",
      key.startsWith("sk_live_") ? undefined : "A test-mode key in production takes no real money.");
  }

  const priceVars = [
    "STRIPE_PRICE_SOLO_MONTHLY", "STRIPE_PRICE_SOLO_ANNUAL",
    "STRIPE_PRICE_TEAM_MONTHLY", "STRIPE_PRICE_TEAM_ANNUAL",
    "STRIPE_PRICE_AUDIT_OVERAGE",
  ];
  for (const v of priceVars) {
    const id = process.env[v];
    if (!id) { record(false, `${v} is set`); continue; }
    const res = await fetch(`https://api.stripe.com/v1/prices/${id}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    record(!!res?.ok, `${v} resolves against this Stripe account`,
      res?.ok ? undefined : "The price id does not exist in the account this key belongs to — a test-mode id left behind after switching to live is the usual cause.");
  }

  const enforcement = process.env.BILLING_ENFORCEMENT === "true";
  console.log(`  Enforcement: ${enforcement ? "ON — audits are blocked without credits, overage is invoiced" : "off (ships dark, per releases.md §5)"}`);
}

async function checkEmail() {
  section("Transactional email");

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    record(true, "Resend not configured — email is LOGGED, not sent", "Invites and portal links fall back to copy-paste. Expected until the Phase 2.5 gate.");
    return;
  }
  record(!!process.env.EMAIL_FROM, "EMAIL_FROM is set");

  const res = await fetch("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);

  if (res?.status === 401) {
    // A send-only key cannot list domains. That is a valid production configuration and not a fault.
    record(true, "Resend key is accepted", "Send-restricted key: domain status cannot be read from here. Verify the sending domain in the Resend dashboard.");
    return;
  }
  if (!res?.ok) {
    record(false, "Resend key is accepted", `Resend answered ${res?.status ?? "nothing"}.`);
    return;
  }
  const body = (await res.json()) as { data?: { name: string; status: string }[] };
  const verified = (body.data ?? []).filter((d) => d.status === "verified");
  record(verified.length > 0, "At least one sending domain is verified",
    verified.length ? verified.map((d) => d.name).join(", ")
      : "Until a domain is verified, Resend delivers only to the account owner's own address — so a stranger never receives an invite, which is exactly the Phase 2.5 exit criterion.");
}

async function main() {
  console.log(`CloseCheck deployment verification — ${new Date().toISOString()}`);
  console.log(`NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}`);

  await checkEnvironment();
  await checkDatabaseRoles();

  const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
  try {
    await checkSchemaAndIsolation(direct);
    await checkTemplates(direct);
  } finally {
    await direct.$disconnect();
  }

  await checkStorage();
  await checkBilling();
  await checkEmail();

  const failed = results.filter((r) => !r.ok);
  console.log("\n" + "=".repeat(72));
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  - ${f.label}`);
    console.log("\nThis does not check the launch gates in docs/releases.md §5 — those need evidence a");
    console.log("human produces (a real charge, a real refund, a stranger receiving an invite).");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
