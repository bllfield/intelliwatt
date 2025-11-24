import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

type UpdateBody = {
  email?: string;
  phone?: string;
  fullName?: string;
};

export async function PATCH(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

    if (!sessionEmail) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const normalizedSessionEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email: normalizedSessionEmail },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = (await req.json()) as UpdateBody;
    const updates: Partial<UpdateBody> = {};

    if (typeof body.email === "string" && body.email.trim().length > 0) {
      updates.email = normalizeEmail(body.email.trim());
    }

    if (typeof body.phone === "string") {
      updates.phone = body.phone.trim();
    }

    if (typeof body.fullName === "string") {
      updates.fullName = body.fullName.trim();
    }

    if (!updates.email && updates.email !== "") {
      updates.email = undefined;
    }

    const emailToSet =
      updates.email && updates.email.length > 0 ? updates.email : normalizedSessionEmail;

    if (updates.email && updates.email !== normalizedSessionEmail) {
      const existing = await prisma.user.findUnique({
        where: { email: updates.email },
        select: { id: true },
      });

      if (existing && existing.id !== user.id) {
        return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
      }
    }

    await prisma.$transaction(async (tx) => {
      if (updates.email && updates.email !== normalizedSessionEmail) {
        await tx.user.update({
          where: { id: user.id },
          data: { email: updates.email },
        });
      }

      const profileUpdate: Record<string, string | null> = {};
      if (updates.phone !== undefined) {
        profileUpdate.phone = updates.phone.length > 0 ? updates.phone : null;
      }
      if (updates.fullName !== undefined) {
        profileUpdate.fullName = updates.fullName.length > 0 ? updates.fullName : null;
      }

      if (Object.keys(profileUpdate).length > 0) {
        await tx.userProfile.upsert({
          where: { userId: user.id },
          update: profileUpdate,
          create: {
            userId: user.id,
            ...profileUpdate,
          },
        });
      }
    });

    if (updates.email && updates.email !== normalizedSessionEmail) {
      cookieStore.set("intelliwatt_user", updates.email, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return NextResponse.json({
      ok: true,
      user: {
        email: emailToSet,
        phone: updates.phone ?? null,
        fullName: updates.fullName ?? null,
      },
    });
  } catch (error) {
    console.error("[profile PATCH]", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}

