-- spec.md §9: the base subscription includes unlimited Tier A screening; a credit is the price of
-- a FULL audit, and full begins at the first Tier B/C entry. Consumption used to happen in
-- createAudit, before any tier ran, which charged the pre-LOI screen §9 says is free. Recording
-- WHEN an audit's credit was consumed is what lets consumption move to the first billable action
-- and stay idempotent across every action that can be the first.
ALTER TABLE "audits" ADD COLUMN "creditConsumedAt" TIMESTAMP(3);

-- Audits created while consumption happened at creation already have a ledger row; mark them so
-- they are never charged a second time on their next Tier B/C entry.
UPDATE "audits" a
SET "creditConsumedAt" = l."createdAt"
FROM "audit_credit_ledger" l
WHERE l."auditId" = a.id
  AND l.reason IN ('AUDIT_CONSUMED', 'OVERAGE')
  AND a."creditConsumedAt" IS NULL;
