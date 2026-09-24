import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * deleteEvidence must delete the OBJECT, not only the row.
 *
 * It did not, on the stated reasoning that the retention purge would collect the file later. The
 * purge finds files only by joining through Evidence rows, so a file whose row is gone is not
 * queued for collection — it is unreachable by everything, permanently. Demonstrated against the
 * real bucket on 2026-09-24: a document survived deletion of its row, its engagement and the
 * entire consultant organisation. These tests hold the corrected behaviour still.
 */
const deleteObject = vi.fn();
const recordError = vi.fn();
const revalidatePath = vi.fn();
const evidenceDelete = vi.fn();
let found: { storageKey: string | null; finding: { auditId: string; audit: { engagementId: string } } } | null;

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireOrgSession: async () => ({ orgId: "org1", userId: "u1" }) }));
vi.mock("@/lib/metrics/record", () => ({ recordError: (...a: unknown[]) => recordError(...a) }));
vi.mock("@/lib/storage/objectStore", () => ({
  deleteObject: (...a: unknown[]) => deleteObject(...a),
  putObject: vi.fn(),
  evidenceKey: vi.fn(),
}));
vi.mock("@/lib/db/scoped", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      evidence: {
        findUnique: async () => found,
        delete: (...a: unknown[]) => evidenceDelete(...a),
      },
    }),
}));

function form(evidenceId: string) {
  const fd = new FormData();
  fd.set("evidenceId", evidenceId);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  found = { storageKey: "org1/evidence/f1/e1-contract.pdf", finding: { auditId: "a1", audit: { engagementId: "eng1" } } };
});

describe("deleteEvidence", () => {
  it("deletes the object the row named, scoped to the org, after the row is gone", async () => {
    const { deleteEvidence } = await import("./evidence");
    await deleteEvidence(form("e1"));
    expect(evidenceDelete).toHaveBeenCalledWith({ where: { id: "e1" } });
    expect(deleteObject).toHaveBeenCalledWith("org1", "org1/evidence/f1/e1-contract.pdf");
    // Row first, then object: nothing can hand the file out while the object still exists.
    expect(evidenceDelete.mock.invocationCallOrder[0]).toBeLessThan(deleteObject.mock.invocationCallOrder[0]);
    expect(recordError).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/engagements/eng1/audits/a1");
  });

  it("records an orphan, and still succeeds, when the object delete fails after the row commit", async () => {
    deleteObject.mockRejectedValueOnce(new Error("bucket unreachable"));
    const { deleteEvidence } = await import("./evidence");
    await expect(deleteEvidence(form("e1"))).resolves.toBeUndefined();
    expect(recordError).toHaveBeenCalledTimes(1);
    const [name, err] = recordError.mock.calls[0];
    expect(name).toBe("evidence-delete-object");
    // The message has to carry the remedy: the row is gone, so only the sweep can find this now.
    expect(String((err as Error).message)).toMatch(/org1\/evidence\/f1\/e1-contract\.pdf/);
    expect(String((err as Error).message)).toMatch(/sweep-orphaned-objects/);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("touches no object for a row that names none", async () => {
    found = { storageKey: null, finding: { auditId: "a1", audit: { engagementId: "eng1" } } };
    const { deleteEvidence } = await import("./evidence");
    await deleteEvidence(form("e1"));
    expect(evidenceDelete).toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes nothing at all when the row is not visible to this org", async () => {
    found = null;
    const { deleteEvidence } = await import("./evidence");
    await expect(deleteEvidence(form("e1"))).rejects.toThrow(/Evidence not found/);
    expect(evidenceDelete).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
