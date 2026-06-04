import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("green button upload house rebinding", () => {
  it("rebinds duplicate raw uploads to the current house in both upload entrypoints", () => {
    const dropletSource = readRepoFile("scripts/droplet/green-button-upload-server.ts");
    const userRouteSource = readRepoFile("app/api/green-button/upload/route.ts");

    expect(dropletSource).toContain("findUnique({");
    expect(dropletSource).toContain("select: { id: true, homeId: true }");
    expect(dropletSource).toContain("await usagePrisma.rawGreenButton.update({");
    expect(dropletSource).toContain("homeId: house.id");
    expect(dropletSource).toContain("reboundFromHouseId");
    expect(dropletSource).toContain("homeId: previousRawHomeId, rawId: rawRecordId");

    expect(userRouteSource).toContain("findUnique({");
    expect(userRouteSource).toContain("select: { id: true, homeId: true }");
    expect(userRouteSource).toContain("await usagePrisma.rawGreenButton.update({");
    expect(userRouteSource).toContain("homeId: house.id");
    expect(userRouteSource).toContain("homeId: previousRawHomeId, rawId: rawRecord.id");
  });

  it("returns 202 before background ingest to avoid upload gateway timeouts", () => {
    const dropletTsSource = readRepoFile("scripts/droplet/green-button-upload-server.ts");
    const clientSource = readRepoFile("components/dashboard/GreenButtonUtilitiesCard.tsx");

    expect(dropletTsSource).toContain("async function runGreenButtonIngestJob");
    expect(dropletTsSource).toContain("res.status(202)");
    expect(dropletTsSource).toContain("upload.accepted_async");
    expect(clientSource).toContain("dropletResponse.status === 202");
    expect(clientSource).toContain("waitForGreenButtonReady");
  });

  it("keeps Droplet Green Button ingest cleanup sequential for single-connection pools", () => {
    const dropletTsSource = readRepoFile("scripts/droplet/green-button-upload-server.ts");
    const ingestJob = sourceBetween(
      dropletTsSource,
      "async function runGreenButtonIngestJob",
      "app.post(\"/upload\""
    );

    expect(ingestJob).not.toContain("Promise.all");
    expect(ingestJob).not.toContain("cleanupTasks");
    expect(ingestJob).toContain("deleteMany({ where: { homeId: house.id, rawId: { not: rawRecordId } } })");
  });

  it("keeps Droplet service management on one Green Button unit for port 8091", () => {
    const postPullSource = readRepoFile("deploy/droplet/post_pull.sh");
    const applyServicesSource = readRepoFile("deploy/droplet/apply_droplet_services.sh");
    const ensureServicesSource = readRepoFile("deploy/droplet/intelliwatt-ensure-services.sh");
    const greenButtonUnitSource = readRepoFile("deploy/droplet/green-button-upload-server.service");

    expect(postPullSource).toContain("disable_if_exists \"green-button-upload.service\"");
    expect(postPullSource).not.toContain("restart_if_exists \"green-button-upload.service\"");
    expect(postPullSource).toContain("restart_if_exists \"green-button-upload-server.service\"");
    expect(applyServicesSource).toContain("disable_unit_if_present \"green-button-upload.service\"");
    expect(applyServicesSource).toContain("enable --now green-button-upload-server.service");
    expect(ensureServicesSource).toContain("disable_if_installed \"green-button-upload.service\"");
    expect(ensureServicesSource).toContain("ensure_enabled_active \"green-button-upload-server.service\"");
    expect(greenButtonUnitSource).toContain("ExecStartPre=-/usr/local/bin/gb-kill-8091.sh");
    expect(greenButtonUnitSource).toContain("green-button-upload-server.ts");
    expect(greenButtonUnitSource).toContain("node_modules/.bin/tsx");
    expect(greenButtonUnitSource).not.toMatch(/ExecStart=.*green-button-upload-server\.js/);
  });
});
