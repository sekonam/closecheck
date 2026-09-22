-- Evidence provenance: what a document is, who attached it, and which claim it substantiates.
--
-- All nullable. Every row written before this migration has no answer to any of these, and a
-- default would be an invented one — "uploaded by the org's first user" is not a fact.
ALTER TABLE "evidence"
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "uploadedById" TEXT,
  ADD COLUMN "label" TEXT,
  ADD COLUMN "sourceRef" JSONB;

-- ON DELETE SET NULL, not CASCADE: removing a teammate must never delete the evidence they
-- attached. The document is the engagement's, not the person's — and a Tier C attestation losing
-- its file because its author left the firm would be a data-loss bug wearing a foreign key.
ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "evidence_uploadedById_idx" ON "evidence"("uploadedById");
