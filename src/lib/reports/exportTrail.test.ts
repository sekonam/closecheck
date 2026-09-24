import { describe, expect, it, vi } from "vitest";
import { listReportExports, recordReportExport } from "./exportTrail";

describe("the export trail", () => {
  it("lists a report's exports newest first with the actor resolved to a display string", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "x2", reportId: "r1", exportedAt: new Date("2026-09-24T10:00:00Z"), exportedBy: { name: "Sergii P", email: "s@firm.example" } },
      { id: "x1", reportId: "r1", exportedAt: new Date("2026-09-23T10:00:00Z"), exportedBy: { name: "  ", email: "t@firm.example" } },
      // The person is gone (SET NULL): the export must still be listed, unattributed.
      { id: "x0", reportId: "r1", exportedAt: new Date("2026-09-22T10:00:00Z"), exportedBy: null },
    ]);
    const tx = { reportExportEvent: { findMany } } as never;
    const out = await listReportExports(tx, "r1");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { reportId: "r1" }, orderBy: { exportedAt: "desc" } }));
    expect(out.map((e) => e.actor)).toEqual(["Sergii P", "t@firm.example", null]);
    expect(out[0].exportedAt).toBeInstanceOf(Date);
    expect(out.map((e) => e.id)).toEqual(["x2", "x1", "x0"]);
  });

  it("records an export against the org and the report, naming the exporter", async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = { reportExportEvent: { create } } as never;
    await recordReportExport(tx, "org1", "r1", "u1");
    expect(create).toHaveBeenCalledWith({ data: { orgId: "org1", reportId: "r1", exportedById: "u1" } });
  });
});
