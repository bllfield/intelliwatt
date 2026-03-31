"use client";

export type AdminHouseOption = {
  id: string;
  esiid: string | null;
  isPrimary: boolean;
  label: string;
};

export async function lookupSmtHousesByEmail(args: {
  email: string;
  token: string;
}): Promise<{
  ok: boolean;
  email?: string;
  houses?: AdminHouseOption[];
  error?: string;
}> {
  const email = String(args.email ?? "").trim();
  const token = String(args.token ?? "").trim();
  if (!email) return { ok: false, error: "email_required" };
  const res = await fetch(`/api/admin/houses/by-email?email=${encodeURIComponent(email)}`, {
    method: "GET",
    headers: {
      "x-admin-token": token,
      accept: "application/json",
    },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    return {
      ok: false,
      error: String(json?.error ?? `lookup_failed_${res.status}`),
    };
  }
  return {
    ok: true,
    email: typeof json.email === "string" ? json.email : email,
    houses: Array.isArray(json.houses) ? json.houses : [],
  };
}
