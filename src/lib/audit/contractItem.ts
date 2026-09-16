// Contract-shaped Tier B items get the extra structured fields (docs/spec.md §4). Matched by title
// rather than a schema flag, per .claude/skills/audit-methodology/SKILL.md's guidance to keep the
// tier *model* and tier *content* changes separate — this is a display decision, not a new field on
// TemplateItem. Shared between the audit page (which shows/hides the fields) and the updateFinding
// server action (which uses the same check to decide whether a submission is allowed to touch
// structuredData at all) so the two can't drift out of sync.
export function isContractItem(title: string): boolean {
  return /contract/i.test(title);
}
