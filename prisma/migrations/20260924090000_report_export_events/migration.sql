-- spec.md §8 promises the consultant a trail covering portal views AND consultant-side exports.
-- Exports were recorded only into metric_events, on which the app role holds INSERT and no SELECT
-- by design (that revoked SELECT is the table's tenant isolation), so nothing in the product could
-- show them. This is the first-class, org-scoped, consultant-readable export log that the PDF
-- route's own docstring named as the end state.
--
-- Keyed on the report, not the link: a report can be exported before it is ever shared and after
-- every link is revoked. The exporter is nullable and SET NULL so the trail outlives the person.
CREATE TABLE "report_export_events" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "reportId"     TEXT NOT NULL,
  "exportedById" TEXT,
  "exportedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_export_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_export_events_orgId_idx" ON "report_export_events"("orgId");
CREATE INDEX "report_export_events_reportId_idx" ON "report_export_events"("reportId");
ALTER TABLE "report_export_events"
  ADD CONSTRAINT "report_export_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "consultant_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "report_export_events_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "report_export_events_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same isolation as every org-owned table; scripts/verify-rls.ts enumerates and would fail without it.
ALTER TABLE "report_export_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_export_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "report_export_events"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- Append-only for the application: a trail that can be edited is not a trail. Explicit rather than
-- relying on whatever default privileges grant, so the intent survives a change to the defaults.
GRANT SELECT, INSERT ON "report_export_events" TO closecheck_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "report_export_events" FROM closecheck_app;
