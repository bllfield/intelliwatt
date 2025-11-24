import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { setPrimaryHouse } from "@/lib/house/promote";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

    if (!sessionEmail) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json()) as { houseId?: string } | null;
    const houseId = body?.houseId?.trim();

    if (!houseId) {
      return NextResponse.json({ error: "Missing houseId" }, { status: 400 });
    }

    const email = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: houseId, userId: user.id, archivedAt: null },
      select: { id: true },
    });

    if (!house) {
      return NextResponse.json({ error: "House not found for user" }, { status: 404 });
    }

    await setPrimaryHouse(user.id, house.id, { keepOthers: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[user/house/select] Failed to switch house", error);
    return NextResponse.json({ error: "Failed to set active house" }, { status: 500 });
  }
}

