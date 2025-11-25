'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type SubmissionSummary = {
  status: SubmissionStatus;
  content: string;
  submittedAt: string;
  entryAwardedAt: string | null;
};

type Props = {
  eligible: boolean;
  submission: SubmissionSummary | null;
};

const statusLabels: Record<SubmissionStatus, { label: string; tone: string }> = {
  PENDING: {
    label: 'Under review',
    tone: 'text-amber-400 bg-amber-400/10 border-amber-400/40',
  },
  APPROVED: {
    label: 'Approved',
    tone: 'text-emerald-300 bg-emerald-300/10 border-emerald-300/40',
  },
  REJECTED: {
    label: 'Requires edits',
    tone: 'text-rose-300 bg-rose-300/10 border-rose-300/40',
  },
};

export function ProfileTestimonialCard({ eligible, submission }: Props) {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const characterCount = content.length;
  const characterCopy = useMemo(() => {
    const min = 40;
    if (characterCount === 0) {
      return `Minimum ${min} characters`;
    }
    if (characterCount < min) {
      return `${min - characterCount} more characters`;
    }
    return `${characterCount} characters`;
  }, [characterCount]);

  const handleSubmit = async () => {
    if (!eligible || submission) {
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch('/api/user/testimonial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Unable to submit testimonial.' }));
        throw new Error(payload?.error ?? 'Unable to submit testimonial.');
      }

      setFeedback('Thanks for sharing your experience! Your testimonial is pending review.');
      setContent('');

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('entriesUpdated'));
      }

      setTimeout(() => {
        router.refresh();
      }, 650);
    } catch (err) {
      console.error('Testimonial submission error', err);
      setError(err instanceof Error ? err.message : 'Unable to submit testimonial right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!eligible) {
    return (
      <section className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/60 p-6 text-brand-cyan shadow-[0_0_35px_rgba(56,189,248,0.25)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Testimonials</h2>
            <p className="mt-2 text-sm text-brand-cyan/80">
              Share your IntelliWatt savings story to unlock a testimonial entry. This reward activates once you
              switch plans through IntelliWatt or complete an IntelliPath upgrade.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
            Locked
          </span>
        </div>
        <div className="mt-4 rounded-2xl border border-brand-cyan/30 bg-brand-navy/70 p-4 text-sm text-brand-cyan/75">
          Will be available after you switch plans through IntelliWatt or complete an approved upgrade.
        </div>
      </section>
    );
  }

  if (submission) {
    const statusMeta = statusLabels[submission.status];
    return (
      <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_35px_rgba(56,189,248,0.28)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Testimonials</h2>
            <p className="mt-2 text-sm text-brand-cyan/80">
              Thanks for being a real IntelliWatt customer! Your testimonial helps future members understand what to expect.
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-4 py-1 text-xs font-semibold uppercase tracking-wide ${statusMeta.tone}`}
          >
            {statusMeta.label}
          </span>
        </div>

        <div className="mt-5 rounded-2xl border border-brand-cyan/25 bg-brand-navy/60 p-5 text-sm leading-relaxed text-brand-cyan">
          <p className="whitespace-pre-wrap">{submission.content}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-brand-cyan/60">
            <span>
              Submitted {new Date(submission.submittedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            {submission.entryAwardedAt ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-200">
                Entry Awarded
              </span>
            ) : null}
          </div>
        </div>

        {submission.status === 'REJECTED' ? (
          <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-xs text-rose-100">
            Need to make updates? Reach out to support so our team can re-open submissions on your account.
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_35px_rgba(56,189,248,0.28)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Testimonials</h2>
          <p className="mt-2 text-sm text-brand-cyan/80">
            Submit a quick testimonial about your IntelliWatt plan switch or upgrade. Once submitted, we&apos;ll review it and
            lock in one jackpot entry that never expires.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
          Eligible
        </span>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="testimonial-content" className="block text-xs font-semibold uppercase tracking-wide text-brand-cyan/60">
            Your IntelliWatt experience
          </label>
          <textarea
            id="testimonial-content"
            name="testimonial"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded-2xl border border-brand-cyan/30 bg-brand-navy/70 p-4 text-sm text-brand-cyan outline-none transition focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/40"
            placeholder="Tell future members how IntelliWatt helped you compare, switch, or save..."
            maxLength={1500}
            disabled={isSubmitting}
          />
          <div className="mt-1 flex items-center justify-between text-[0.7rem] uppercase tracking-wide text-brand-cyan/60">
            <span>{characterCopy}</span>
            <span>Max 1,500 characters</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || content.trim().length < 40}
          className="inline-flex items-center justify-center rounded-full border border-brand-cyan/40 bg-brand-cyan/20 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-cyan hover:bg-brand-cyan/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Submitting…' : 'Submit testimonial'}
        </button>

        {feedback ? (
          <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-xs text-emerald-100">
            {feedback}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-xs text-rose-100">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}

