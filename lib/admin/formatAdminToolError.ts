/** Normalize API / catch errors for admin tool UI (always a display string). */
export function formatAdminToolErrorMessage(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (value instanceof Error) return value.message.trim();
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
    if (typeof rec.code === "string" && rec.code.trim()) {
      const details = typeof rec.details === "string" ? rec.details.trim() : "";
      return details ? `${rec.code}: ${details}` : rec.code;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value).trim();
}
