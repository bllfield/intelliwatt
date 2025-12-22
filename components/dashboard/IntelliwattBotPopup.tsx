"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type Props = {
  visible: boolean;
  message: string;
  storageKey?: string;
  ttlMs?: number;
};

type StoredDismiss = { dismissedAt: number };

function readDismissed(storageKey: string, ttlMs: number): boolean {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as StoredDismiss;
    const t = typeof parsed?.dismissedAt === "number" ? parsed.dismissedAt : 0;
    if (!t) return false;
    if (Date.now() - t > ttlMs) return false;
    return true;
  } catch {
    return false;
  }
}

function writeDismissed(storageKey: string) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ dismissedAt: Date.now() } satisfies StoredDismiss));
  } catch {
    // ignore
  }
}

export default function IntelliwattBotPopup({
  visible,
  message,
  storageKey = "iw_bot_popup_dismissed_v1",
  ttlMs = 60 * 60 * 1000,
}: Props) {
  const [open, setOpen] = useState(true);
  const [typed, setTyped] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const dismissed = useMemo(() => readDismissed(storageKey, ttlMs), [storageKey, ttlMs]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function type() {
      setTyped("");
      if (!message) return;
      setIsTyping(true);
      for (let i = 0; i < message.length; i += 1) {
        if (cancelled) return;
        setTyped(message.slice(0, i + 1));
        await sleep(24);
      }
      if (!cancelled) setIsTyping(false);
    }
    type();
    return () => {
      cancelled = true;
      setIsTyping(false);
    };
  }, [message, open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [typed]);

  if (!visible) return null;
  if (dismissed) return null;
  if (!open) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-2rem))]">
      <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy px-4 py-4 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="relative h-12 w-12 shrink-0 rounded-2xl border border-brand-cyan/25 bg-brand-white/5 overflow-hidden flex items-center justify-center">
              <Image
                src="/Intelliwatt Bot Final Gif.gif"
                alt="IntelliWatt Bot"
                fill
                className="object-contain"
                unoptimized
              />
            </div>
            <div className="min-w-0">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/60">
                IntelliWattBot
              </div>
              <div className="relative mt-2 rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-4 py-3">
                <div
                  ref={scrollRef}
                  className="max-h-[140px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-brand-cyan/85"
                >
                  {typed || (message ? "" : "…")}
                  {isTyping ? <span className="opacity-60">▍</span> : null}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              writeDismissed(storageKey);
            }}
            className="shrink-0 rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
            title="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}


