"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type BotMsgResp = {
  ok: boolean;
  pageKey?: string;
  message?: string;
  source?: string;
  updatedAt?: string | null;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function IntelliwattBotHero() {
  const pathname = usePathname();
  const [full, setFull] = useState<string>("");
  const [typed, setTyped] = useState<string>("");
  const [isTyping, setIsTyping] = useState(false);
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const key = useMemo(() => (pathname ? String(pathname) : "/dashboard"), [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const r = await fetch(`/api/bot/message?path=${encodeURIComponent(key)}`, { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as BotMsgResp | null;
        const msg = j?.ok && typeof j?.message === "string" ? j.message : "";
        if (!cancelled) setFull(msg || "");
      } catch {
        if (!cancelled) setFull("");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    async function type() {
      setTyped("");
      if (!full) return;
      setIsTyping(true);
      for (let i = 0; i < full.length; i += 1) {
        if (cancelled) return;
        setTyped(full.slice(0, i + 1));
        // Keep the latest text in view when the bubble scrolls
        await sleep(28);
      }
      if (!cancelled) setIsTyping(false);
    }
    type();
    return () => {
      cancelled = true;
      setIsTyping(false);
    };
  }, [full]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [typed, open]);

  if (!open) {
    return (
      <div className="mb-6 flex items-center justify-between gap-3 rounded-3xl border border-brand-cyan/20 bg-brand-navy px-5 py-3 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.2)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-2xl border border-brand-cyan/25 bg-brand-white/5 flex items-center justify-center">
            <span className="text-brand-cyan font-semibold">IW</span>
          </div>
          <div className="truncate text-sm text-brand-cyan/80">
            IntelliWattBot is here to guide you through setup.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
        >
          Open
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-3xl border border-brand-cyan/20 bg-brand-navy px-5 py-5 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.2)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="relative h-32 w-32 shrink-0">
            <Image
              src="/Intelliwatt Bot Final Gif.gif"
              alt="IntelliWatt Bot"
              fill
              className="object-contain"
              unoptimized
            />
          </div>

          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-cyan/60">
              IntelliWattBot
            </div>
            <div className="relative mt-2">
              {/* Speech bubble */}
              <div className="relative rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-4 py-3">
                <div
                  ref={scrollRef}
                  className="max-h-[140px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-brand-cyan/85"
                >
                  {typed || (full ? "" : "…")}
                  {isTyping ? <span className="opacity-60">▍</span> : null}
                </div>
              </div>
              {/* bubble tail */}
              <div className="absolute -left-2 top-5 h-4 w-4 rotate-45 border-l border-t border-brand-cyan/25 bg-brand-white/5" />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
          title="Hide IntelliWattBot"
        >
          Hide
        </button>
      </div>
    </div>
  );
}


