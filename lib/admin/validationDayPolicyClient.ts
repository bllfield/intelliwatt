type JsonResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; message?: string };

async function parseJson<T>(res: Response): Promise<JsonResult<T>> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: String(json.error ?? `request_failed_${res.status}`),
      status: res.status,
      message: typeof json.message === "string" ? json.message : undefined,
    };
  }
  return { ok: true, data: json };
}

export async function fetchValidationDayPolicySnapshot() {
  const res = await fetch("/api/admin/tools/validation-day-policy?surface=admin_lab", {
    credentials: "include",
  });
  return parseJson<Record<string, unknown>>(res);
}

export async function saveValidationDayPolicy(args: {
  selectionMode: string;
  validationDayCount: number;
  surface?: "admin_lab" | "user_site";
  confirmation: string;
}) {
  const res = await fetch("/api/admin/tools/validation-day-policy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action: "save", ...args }),
  });
  return parseJson<Record<string, unknown>>(res);
}

export async function resetValidationDayPolicy(args: { confirmation: string; surface?: "admin_lab" | "user_site" }) {
  const res = await fetch("/api/admin/tools/validation-day-policy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action: "reset", ...args }),
  });
  return parseJson<Record<string, unknown>>(res);
}

export async function previewValidationDayPolicyForEmail(args: {
  email: string;
  houseId?: string;
  useDraft?: boolean;
  draftSelectionMode?: string;
  draftValidationDayCount?: number;
}) {
  const res = await fetch("/api/admin/tools/validation-day-policy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      action: "preview",
      email: args.email.trim(),
      ...(args.houseId ? { houseId: args.houseId } : {}),
      ...(args.useDraft && args.draftSelectionMode ? { mode: args.draftSelectionMode } : {}),
      ...(args.useDraft && args.draftValidationDayCount != null
        ? { validationDayCount: args.draftValidationDayCount }
        : {}),
      surface: "admin_lab",
    }),
  });
  return parseJson<Record<string, unknown>>(res);
}
