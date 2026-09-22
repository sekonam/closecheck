-- What a portal access row records, so that nothing the client controls decides whether the row
-- exists at all.
--
-- The PDF route skipped logging when `Sec-Fetch-Dest: iframe` was present, to avoid double-counting
-- the embedded viewer's fetch of the page it sits in. That header is forbidden to browser scripts
-- and entirely free for anything else — curl, a script, a mail scanner — so sending it suppressed
-- the row. Ten complete report downloads left the consultant's access trail reading "never viewed",
-- on the one spec.md §8 feature a consultant points at when a buyer's advisers ask who has had
-- access.
CREATE TYPE "PortalAccessKind" AS ENUM ('PAGE', 'DOCUMENT');

-- Existing rows were all written by the page, which was the only logging caller.
ALTER TABLE "portal_access_log"
  ADD COLUMN "kind" "PortalAccessKind" NOT NULL DEFAULT 'PAGE';
