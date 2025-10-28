'use client';

// Idle timeout with cross-tab sync:
// - Warn at 30 minutes of inactivity (configurable)
// - 60-second grace countdown (configurable)
// - Then redirect to homepage (exit dashboard) so user can request a new magic link
import React, { useEffect, useRef, useState } from 'react';

const CHANNEL = 'intelliwatt-idle';

// Config (with env overrides):
// Warn after 30 minutes idle (default) → then 60s later redirect to "/"
const WARN_MIN  = Number(process.env.NEXT_PUBLIC_IDLE_WARN_MIN  ?? '30');  // minutes to warning
const GRACE_SEC = Number(process.env.NEXT_PUBLIC_IDLE_GRACE_SEC ?? '60');  // seconds shown in warning

const WARN_AT_MS   = WARN_MIN * 60_000;
const EXPIRE_AT_MS = WARN_AT_MS + GRACE_SEC * 1_000;

export default function IdleGuard({ children }: { children: React.ReactNode }) {
  const [warn, setWarn] = useState(false);
  const [countdown, setCountdown] = useState(GRACE_SEC);
  const warnTimerRef = useRef<number | null>(null);
  const expireTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const bc = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    bc.current = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
    bc.current?.addEventListener('message', (ev) => {
      if (ev.data === 'reset') resetTimers(false);
      if (ev.data === 'expire') expireNow(false);
    });
    const reset = () => resetTimers();
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('scroll', reset);
    document.addEventListener('visibilitychange', reset);
    resetTimers();
    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('scroll', reset);
      document.removeEventListener('visibilitychange', reset);
      bc.current?.close();
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearTimers() {
    if (warnTimerRef.current) window.clearTimeout(warnTimerRef.current);
    if (expireTimerRef.current) window.clearTimeout(expireTimerRef.current);
    if (countdownRef.current) window.clearInterval(countdownRef.current);
    warnTimerRef.current = null;
    expireTimerRef.current = null;
    countdownRef.current = null;
  }

  function startCountdown() {
    setCountdown(GRACE_SEC);
    if (countdownRef.current) window.clearInterval(countdownRef.current);
    countdownRef.current = window.setInterval(() => {
      setCountdown((s) => {
        const next = s - 1;
        if (next <= 0) {
          if (countdownRef.current) window.clearInterval(countdownRef.current);
        }
        return Math.max(0, next);
      });
    }, 1000);
  }

  function resetTimers(broadcast = true) {
    clearTimers();
    setWarn(false);
    // Show warning at WARN_AT_MS
    warnTimerRef.current = window.setTimeout(() => {
      setWarn(true);
      startCountdown();
    }, WARN_AT_MS);
    // Expire after EXPIRE_AT_MS
    expireTimerRef.current = window.setTimeout(() => expireNow(), EXPIRE_AT_MS);
    if (broadcast) bc.current?.postMessage('reset');
  }

  function expireNow(broadcast = true) {
    if (broadcast) bc.current?.postMessage('expire');
    // Redirect to homepage to exit dashboard; user can request a new magic link
    window.location.href = '/?session=expired';
  }

  return (
    <>
      {children}
      {warn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl bg-white p-6 shadow-xl max-w-sm text-center">
            <h3 className="text-lg font-semibold mb-2">You've been idle</h3>
            <p className="mb-4">
              For security, you'll be redirected to the homepage in{' '}
              <strong>{countdown}</strong> second{countdown === 1 ? '' : 's'}.
              Move your mouse or press a key to stay signed in.
            </p>
            <button
              className="rounded px-4 py-2 border"
              onClick={() => resetTimers()}
            >
              I'm still here
            </button>
          </div>
        </div>
      )}
    </>
  );
}

