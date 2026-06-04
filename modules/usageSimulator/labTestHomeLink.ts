import "server-only";
import { usagePrisma } from "@/lib/db/usageClient";

export type LabTestHomeLink = {
  ownerUserId: string;
  testHomeHouseId: string;
  sourceUserId: string | null;
  sourceHouseId: string | null;
  status: string;
  statusMessage: string | null;
  lastReplacedAt: Date | null;
};

const namedLabLinkTableAvailability: Partial<Record<"gapfill" | "onePath", boolean>> = {};

function getNamedLabLinkModel(kind: "gapfill" | "onePath"): any | null {
  try {
    const model =
      kind === "onePath"
        ? (usagePrisma as any).onePathLabTestHomeLink
        : (usagePrisma as any).gapfillLabTestHomeLink;
    if (!model) return null;
    if (
      typeof model.findUnique !== "function" ||
      typeof model.upsert !== "function" ||
      typeof model.update !== "function"
    ) {
      return null;
    }
    return model;
  } catch {
    return null;
  }
}

async function getNamedLabLinkModelIfAvailable(kind: "gapfill" | "onePath"): Promise<any | null> {
  const cached = namedLabLinkTableAvailability[kind];
  if (cached === false) return null;

  const model = getNamedLabLinkModel(kind);
  if (!model) {
    namedLabLinkTableAvailability[kind] = false;
    return null;
  }

  if (cached === true) return model;

  const tableName = kind === "onePath" ? "OnePathLabTestHomeLink" : "GapfillLabTestHomeLink";
  try {
    const rows = await (usagePrisma as any).$queryRaw`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ${tableName}
      LIMIT 1
    `;
    const available = Array.isArray(rows) && rows.length > 0;
    namedLabLinkTableAvailability[kind] = available;
    return available ? model : null;
  } catch {
    namedLabLinkTableAvailability[kind] = false;
    return null;
  }
}

export async function getLabTestHomeLink(ownerUserId: string): Promise<LabTestHomeLink | null> {
  const model = await getNamedLabLinkModelIfAvailable("gapfill");
  if (!model) return null;
  const row = await model
    .findUnique({
      where: { ownerUserId },
      select: {
        ownerUserId: true,
        testHomeHouseId: true,
        sourceUserId: true,
        sourceHouseId: true,
        status: true,
        statusMessage: true,
        lastReplacedAt: true,
      },
    })
    .catch(() => null);
  if (!row) return null;
  return row as LabTestHomeLink;
}

export async function getOnePathLabTestHomeLink(ownerUserId: string): Promise<LabTestHomeLink | null> {
  const model = await getNamedLabLinkModelIfAvailable("onePath");
  if (!model) return null;
  const row = await model
    .findUnique({
      where: { ownerUserId },
      select: {
        ownerUserId: true,
        testHomeHouseId: true,
        sourceUserId: true,
        sourceHouseId: true,
        status: true,
        statusMessage: true,
        lastReplacedAt: true,
      },
    })
    .catch(() => null);
  if (!row) return null;
  return row as LabTestHomeLink;
}
