import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("ManualMonthlyLab shared runtime payload wiring", () => {
  it("prefers artifact-backed read_result payload when deriving the active Stage 1 manual contract", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("displayedReadResult?.payload");
    expect(source).toContain("activePayload: displayedReadResult?.payload");
  });

  it("labels raw source payload as context only instead of presenting it as the active lab contract", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("Active lab payload and prefill context");
    expect(source).toContain("sourcePayloadContextOnly");
    expect(source).toContain("sourcePayloadContextUpdatedAt");
    expect(source).toContain("prefillSeed");
  });

  it("opens the manual editor in a modal shell instead of only rendering inline", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain('ModalShell title="Lab-home Manual Usage"');
    expect(source).toContain("{showManualEditor && labReady ? (");
    expect(source).toContain("Manual editor");
    expect(source).toContain("Use the `Manual editor` button above, next to `Appliances`, to open the popup");
  });

  it("does not immediately close the manual editor during transport load", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain('setStatus("Manual payload loaded from the isolated lab home.")');
    expect(source).not.toContain('setShowManualEditor(false);\n        setStatus("Manual payload loaded from the isolated lab home.")');
  });

  it("supports customer, auto, and admin custom monthly date-source modes in the lab popup", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");
    const editorSource = readRepoFile("components/manual/ManualUsageEntry.tsx");

    expect(source).toContain("Manual editor");
    expect(editorSource).toContain("CUSTOMER_DATES");
    expect(editorSource).toContain("AUTO_DATES");
    expect(editorSource).toContain("ADMIN_CUSTOM_DATES");
  });
});
