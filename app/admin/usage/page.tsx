'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent, FormEvent } from 'react';

interface UsageDebugTotals {
  intervalCount: number;
  totalKwh: number;
  earliestTs: string | null;
  latestTs: string | null;
}

interface UsageDebugSmtTotals extends UsageDebugTotals {
  uniqueEsiids: number;
}

interface UsageDebugSmtTopEsiid {
  esiid: string;
  intervalCount: number;
  totalKwh: number;
  lastTimestamp: string | null;
}

interface UsageDebugSmtInterval {
  esiid: string;
  meter: string;
  ts: string;
  kwh: number;
  source: string | null;
}

interface UsageDebugSmtRawFile {
  id: string;
  filename: string;
  sizeBytes: number;
  source: string;
  storagePath: string | null;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
}

interface UsageDebugSmt {
  totals: UsageDebugSmtTotals;
  topEsiids: UsageDebugSmtTopEsiid[];
  latestIntervals: UsageDebugSmtInterval[];
  rawFiles: UsageDebugSmtRawFile[];
}

interface UsageDebugModuleInterval {
  esiid: string | null;
  meter: string | null;
  ts: string;
  kwh: number;
  filled: boolean;
  source: string | null;
}

interface UsageDebugModule {
  totals: UsageDebugTotals;
  latestRows: UsageDebugModuleInterval[];
}

interface UsageDebugResponse {
  ok: true;
  smt: UsageDebugSmt;
  usageModule: UsageDebugModule;
}

interface AdminUserSummary {
  id: string;
  email: string;
  houseAddresses?: {
    id: string;
    archivedAt: string | null;
    addressLine1?: string | null;
  }[];
}

interface GreenButtonUploadSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  utilityName: string | null;
  accountNumber: string | null;
  capturedAt: string | null;
  intervals: {
    count: number;
    totalKwh: number;
  };
}

interface GreenButtonIntervalSample {
  id: string;
  rawId: string;
  timestamp: string;
  consumptionKwh: string;
  intervalMinutes: number;
}

const AUTO_REFRESH_MS = 30_000;

const numberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const formatNumber = (value: number) => numberFormatter.format(value);

const formatKwh = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 3 });

const formatBytes = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatDateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

export default function AdminUsageConsole() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState('');
  const [debugData, setDebugData] = useState<UsageDebugResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [greenButtonUploads, setGreenButtonUploads] = useState<GreenButtonUploadSummary[]>([]);
  const [greenButtonSamples, setGreenButtonSamples] = useState<GreenButtonIntervalSample[]>([]);
  const [greenButtonFile, setGreenButtonFile] = useState<File | null>(null);
  const [greenButtonUtility, setGreenButtonUtility] = useState('');
  const [greenButtonAccount, setGreenButtonAccount] = useState('');
  const [greenButtonStatus, setGreenButtonStatus] = useState<string | null>(null);
  const [uploadingGreenButton, setUploadingGreenButton] = useState(false);
  const [greenButtonLog, setGreenButtonLog] = useState<string[]>([]);
  const [greenButtonHouseId, setGreenButtonHouseId] = useState('');
  const [greenButtonUserEmail, setGreenButtonUserEmail] = useState('');
  const [greenButtonUserId, setGreenButtonUserId] = useState('');

  const greenButtonFileInputRef = useRef<HTMLInputElement | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const appendGreenButtonLog = useCallback((message: string) => {
    setGreenButtonLog((previous) => [
      ...previous,
      `${new Date().toLocaleTimeString()} — ${message}`,
    ]);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedToken = window.localStorage.getItem('intelliwattAdminToken');
    if (storedToken) {
      setAdminToken(storedToken);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const trimmed = adminToken.trim();
    if (trimmed.length > 0) {
      window.localStorage.setItem('intelliwattAdminToken', trimmed);
    } else {
      window.localStorage.removeItem('intelliwattAdminToken');
    }
  }, [adminToken]);

  const withAdminHeaders = useCallback(
    (init?: RequestInit): RequestInit => {
      const headers = new Headers(init?.headers ?? {});
      const token = adminToken.trim();
      if (token.length > 0) {
        headers.set('x-admin-token', token);
      }
      return { ...init, headers };
    },
    [adminToken],
  );

  const fetchWithAdmin = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => fetch(input, withAdminHeaders(init)),
    [withAdminHeaders],
  );

  const readResponseBody = useCallback(async (response: Response) => {
    const raw = await response.text();
    let json: any = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }
    return { raw, json };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const [debugRes, greenButtonRes, usersRes] = await Promise.all([
        fetchWithAdmin('/api/admin/usage/debug'),
        fetchWithAdmin('/api/admin/green-button/records'),
        fetchWithAdmin('/api/admin/users'),
      ]);

      if (debugRes.ok) {
        const payload = (await debugRes.json()) as UsageDebugResponse;
        setDebugData(payload);
      } else {
        const { raw, json } = await readResponseBody(debugRes);
        const detail =
          json?.error ||
          json?.message ||
          (raw && raw.length > 0 ? raw : debugRes.statusText || 'Failed to load usage debug data');
        setError(`Usage debug fetch failed (${debugRes.status}): ${detail}`);
      }

      if (greenButtonRes.ok) {
        const greenButtonData = await greenButtonRes.json();
        setGreenButtonUploads(greenButtonData.uploads ?? []);
        setGreenButtonSamples(greenButtonData.sampleIntervals ?? []);
      } else {
        const { raw, json } = await readResponseBody(greenButtonRes);
        const detail =
          json?.error ||
          (raw && raw.length > 0 ? raw : greenButtonRes.statusText || 'Failed to load records');
        appendGreenButtonLog(`Failed to fetch Green Button records: ${detail}`);
      }

      if (usersRes.ok) {
        const usersPayload = (await usersRes.json()) as AdminUserSummary[];
        setUsers(usersPayload);
      } else {
        console.error('Failed to fetch admin users', usersRes.status, usersRes.statusText);
      }

      setLastUpdated(new Date().toISOString());
    } catch (err) {
      console.error('Failed to load usage debug data', err);
      setError(
        err instanceof Error
          ? `Failed to load usage diagnostics: ${err.message}`
          : 'Failed to load usage diagnostics.',
      );
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [appendGreenButtonLog, fetchWithAdmin, readResponseBody]);

  useEffect(() => {
    setMounted(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }
    refreshIntervalRef.current = setInterval(() => {
      if (!refreshing && !uploadingGreenButton) {
        fetchData();
      }
    }, AUTO_REFRESH_MS);
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [fetchData, mounted, refreshing, uploadingGreenButton]);

  const handleGreenButtonUserInputChange = useCallback(
    (value: string) => {
      setGreenButtonUserEmail(value);
      const trimmed = value.trim().toLowerCase();
      if (trimmed.length === 0) {
        setGreenButtonUserId('');
        return;
      }
      const match = users.find((user) => user.email.toLowerCase() === trimmed);
      if (match) {
        setGreenButtonUserId(match.id);
      }
    },
    [users],
  );

  useEffect(() => {
    if (!mounted) {
      return;
    }
    document.title = 'Usage Test Console - IntelliWatt™';
  }, [mounted]);

  const normalizedGreenButtonUserEmail = greenButtonUserEmail.trim().toLowerCase();
  const selectedGreenButtonUser = useMemo(() => {
    if (greenButtonUserId) {
      return users.find((user) => user.id === greenButtonUserId) ?? null;
    }
    if (normalizedGreenButtonUserEmail.length > 0) {
      return users.find((user) => user.email.toLowerCase() === normalizedGreenButtonUserEmail) ?? null;
    }
    return null;
  }, [greenButtonUserId, normalizedGreenButtonUserEmail, users]);

  const availableHouseOptions = selectedGreenButtonUser?.houseAddresses ?? [];

  useEffect(() => {
    if (!selectedGreenButtonUser) {
      return;
    }
    if (greenButtonHouseId.trim().length > 0) {
      const exists =
        selectedGreenButtonUser.houseAddresses?.some((house) => house.id === greenButtonHouseId) ?? false;
      if (exists) {
        return;
      }
    }
    const fallbackHouse =
      selectedGreenButtonUser.houseAddresses?.find((house) => !house.archivedAt) ??
      selectedGreenButtonUser.houseAddresses?.[0];
    if (fallbackHouse) {
      setGreenButtonHouseId(fallbackHouse.id);
    }
  }, [selectedGreenButtonUser, greenButtonHouseId]);

  const handleGreenButtonFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setGreenButtonFile(event.target.files[0]);
      setGreenButtonStatus(null);
    } else {
      setGreenButtonFile(null);
    }
  }, []);

  const handleGreenButtonUpload = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!greenButtonFile) {
        const message = 'Please choose a Green Button XML/CSV file before uploading.';
        setGreenButtonStatus(message);
        appendGreenButtonLog(message);
        return;
      }

      try {
        setUploadingGreenButton(true);
        setGreenButtonStatus('Uploading and normalizing…');
        setGreenButtonLog([]);
        appendGreenButtonLog(
          `Preparing upload: ${greenButtonFile.name} (${formatBytes(greenButtonFile.size)})`,
        );

        let targetHouseId = greenButtonHouseId.trim();
        if (!targetHouseId && selectedGreenButtonUser) {
          const fallbackHouse =
            selectedGreenButtonUser.houseAddresses?.find((house) => !house.archivedAt) ??
            selectedGreenButtonUser.houseAddresses?.[0];
          if (fallbackHouse) {
            targetHouseId = fallbackHouse.id;
            setGreenButtonHouseId(fallbackHouse.id);
            appendGreenButtonLog(
              `Using ${fallbackHouse.id} for ${selectedGreenButtonUser.email} (auto-selected)`,
            );
          }
        }

        if (!targetHouseId) {
          const message =
            'House ID required. Select a user and house from the dropdown or paste a house ID manually.';
          setGreenButtonStatus(message);
          appendGreenButtonLog(message);
          return;
        }

        if (selectedGreenButtonUser) {
          appendGreenButtonLog(
            `Target user: ${selectedGreenButtonUser.email} · house ${targetHouseId}${
              selectedGreenButtonUser.houseAddresses?.some(
                (house) => house.id === targetHouseId && house.archivedAt,
              )
                ? ' (archived)'
                : ''
            }`,
          );
        }

        const ticketResponse = await fetchWithAdmin('/api/green-button/upload-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ homeId: targetHouseId }),
        });
        appendGreenButtonLog(
          `Ticket request: ${ticketResponse.status} ${ticketResponse.statusText || ''}`.trim(),
        );

        if (!ticketResponse.ok) {
          const { raw, json } = await readResponseBody(ticketResponse);
          const detail =
            json?.detail ||
            json?.error ||
            (raw && raw.length > 0 ? raw : 'No additional details returned.');
          let message = `Ticket request failed (${ticketResponse.status} ${ticketResponse.statusText}) — ${detail}`;
          const errorCode = json?.error ?? json?.code ?? detail;
          if (
            ticketResponse.status === 503 &&
            typeof errorCode === 'string' &&
            errorCode.includes('green_button_upload_unavailable')
          ) {
            message +=
              ' • Configure GREEN_BUTTON_UPLOAD_URL (or NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL) and GREEN_BUTTON_UPLOAD_SECRET in Vercel env vars so the admin tool can reach the droplet uploader.';
          }
          setGreenButtonStatus(message);
          appendGreenButtonLog(message);
          return;
        }

        const ticket = await ticketResponse.json();
        if (!ticket?.ok || !ticket.uploadUrl || !ticket.payload || !ticket.signature) {
          const message = 'Ticket response missing required fields.';
          setGreenButtonStatus(message);
          appendGreenButtonLog(message);
          return;
        }
        appendGreenButtonLog(`Ticket issued — expires ${ticket.expiresAt}`);

        const dropletForm = new FormData();
        dropletForm.append('file', greenButtonFile);
        dropletForm.append('payload', ticket.payload);
        dropletForm.append('signature', ticket.signature);
        if (greenButtonUtility.trim().length > 0) {
          dropletForm.append('utilityName', greenButtonUtility.trim());
        }
        if (greenButtonAccount.trim().length > 0) {
          dropletForm.append('accountNumber', greenButtonAccount.trim());
        }

        let dropletUrl = ticket.uploadUrl as string;
        if (typeof window !== 'undefined' && window.location.protocol === 'https:' && dropletUrl.startsWith('http://')) {
          const httpsUrl = dropletUrl.replace('http://', 'https://');
          appendGreenButtonLog(
            `Upload URL returned over http:// — attempting https fallback: ${httpsUrl}`,
          );
          dropletUrl = httpsUrl;
        }

        appendGreenButtonLog(`POST ${dropletUrl}`);
        let dropletResponse: Response | null = null;
        try {
          dropletResponse = await fetch(dropletUrl, {
            method: 'POST',
            body: dropletForm,
            credentials: 'omit',
          });
        } catch (uploadError) {
          appendGreenButtonLog(
            `Droplet upload network error: ${
              uploadError instanceof Error ? uploadError.message : String(uploadError)
            }`,
          );
        }

        if (!dropletResponse) {
          const message =
            'Droplet upload blocked (likely due to mixed-content http:// URL). Configure GREEN_BUTTON_UPLOAD_URL with an https endpoint or tunnel through the API Connect fallback.';
          setGreenButtonStatus(message);
          appendGreenButtonLog(message);
          return;
        }

        appendGreenButtonLog(
          `Droplet response: ${dropletResponse.status} ${dropletResponse.statusText || ''}`.trim(),
        );
        if (!dropletResponse.ok) {
          const { raw, json } = await readResponseBody(dropletResponse);
          const detail =
            json?.detail ||
            json?.error ||
            (raw && raw.length > 0 ? raw : 'No additional details returned.');
          const message = `Droplet upload failed (${dropletResponse.status} ${dropletResponse.statusText}) — ${detail}`;
          setGreenButtonStatus(message);
          appendGreenButtonLog(message);
          return;
        }

        const result = await dropletResponse.json();
        const successMessage = `Upload stored and normalized (${result.intervalsCreated} intervals, ${Number(
          result.totalKwh ?? 0,
        ).toFixed(3)} kWh).`;
        setGreenButtonStatus(successMessage);
        appendGreenButtonLog(
          `Normalization complete: ${result.intervalsCreated} intervals, total ${Number(
            result.totalKwh ?? 0,
          ).toFixed(3)} kWh, rawId ${result.rawId}`,
        );
        if (Array.isArray(result.warnings) && result.warnings.length > 0) {
          appendGreenButtonLog(`Warnings: ${result.warnings.join('; ')}`);
        }

        setGreenButtonFile(null);
        if (greenButtonFileInputRef.current) {
          greenButtonFileInputRef.current.value = '';
        }
        setGreenButtonUtility('');
        setGreenButtonAccount('');

        appendGreenButtonLog('Refreshing usage diagnostics…');
        await fetchData();
        appendGreenButtonLog('Usage diagnostics refreshed.');
      } catch (uploadError) {
        console.error('Failed to upload Green Button file:', uploadError);
        const message =
          uploadError instanceof Error
            ? `Upload failed due to a network error: ${uploadError.message}`
            : 'Upload failed due to a network error. Please try again.';
        setGreenButtonStatus(message);
        appendGreenButtonLog(message);
      } finally {
        setUploadingGreenButton(false);
      }
    },
    [
      appendGreenButtonLog,
      fetchData,
      fetchWithAdmin,
      greenButtonAccount,
      greenButtonFile,
      greenButtonHouseId,
      greenButtonUtility,
      readResponseBody,
      selectedGreenButtonUser,
    ],
  );

  useEffect(() => {
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  if (!mounted) {
    return null;
  }

  const smtTotals = debugData?.smt.totals;
  const usageTotals = debugData?.usageModule.totals;

  const normalizedUploads = greenButtonUploads ?? [];
  const normalizedSamples = greenButtonSamples ?? [];

  return (
    <div className="min-h-screen bg-brand-white">
      <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
        <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_25px_60px_rgba(10,20,60,0.45)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold text-brand-white">Usage Test Console</h1>
              <p className="text-sm text-brand-cyan/80">
                Monitor live SMT and Green Button ingestion, trigger uploads, and surface debugging details in one place.
                The panel auto-refreshes every {AUTO_REFRESH_MS / 1000} seconds while open.
              </p>
              {lastUpdated ? (
                <p className="text-xs text-brand-cyan/60">
                  Last refreshed{' '}
                  <span className="font-semibold text-brand-white">{formatDateTime(lastUpdated)}</span>
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="admin-token"
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60"
                >
                  Admin token
                </label>
                <input
                  id="admin-token"
                  type="password"
                  value={adminToken}
                  onChange={(event) => setAdminToken(event.target.value)}
                  placeholder="Paste x-admin-token value"
                  className="w-64 rounded-lg border border-brand-cyan/40 bg-brand-white/95 px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
                />
              </div>
              <button
                type="button"
                onClick={fetchData}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-cyan hover:bg-brand-cyan/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? 'Refreshing…' : 'Refresh diagnostics'}
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-3xl border border-rose-300 bg-rose-500/15 px-6 py-4 text-sm text-rose-100 shadow-md">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy/60 px-6 py-10 text-center text-brand-cyan/80 shadow">
            Loading usage diagnostics…
          </div>
        ) : null}

        {debugData ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy/80 p-4 text-brand-cyan shadow">
                <p className="text-xs uppercase tracking-[0.3em] text-brand-cyan/60">SMT intervals</p>
                <p className="mt-2 text-2xl font-semibold text-brand-white">
                  {formatNumber(smtTotals?.intervalCount ?? 0)}
                </p>
                <p className="text-xs text-brand-cyan/60">
                  Unique ESIIDs: <span className="font-semibold text-brand-white">{formatNumber(smtTotals?.uniqueEsiids ?? 0)}</span>
                </p>
                <p className="text-xs text-brand-cyan/60">
                  Latest interval:{' '}
                  <span className="font-semibold text-brand-white">
                    {formatDateTime(smtTotals?.latestTs ?? null)}
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy/80 p-4 text-brand-cyan shadow">
                <p className="text-xs uppercase tracking-[0.3em] text-brand-cyan/60">SMT total usage</p>
                <p className="mt-2 text-2xl font-semibold text-brand-white">
                  {formatKwh(smtTotals?.totalKwh ?? 0)} kWh
                </p>
                <p className="text-xs text-brand-cyan/60">
                  Earliest interval:{' '}
                  <span className="font-semibold text-brand-white">
                    {formatDateTime(smtTotals?.earliestTs ?? null)}
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy/80 p-4 text-brand-cyan shadow">
                <p className="text-xs uppercase tracking-[0.3em] text-brand-cyan/60">Usage module rows</p>
                <p className="mt-2 text-2xl font-semibold text-brand-white">
                  {formatNumber(usageTotals?.intervalCount ?? 0)}
                </p>
                <p className="text-xs text-brand-cyan/60">
                  Latest module interval:{' '}
                  <span className="font-semibold text-brand-white">
                    {formatDateTime(usageTotals?.latestTs ?? null)}
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy/80 p-4 text-brand-cyan shadow">
                <p className="text-xs uppercase tracking-[0.3em] text-brand-cyan/60">Usage module total</p>
                <p className="mt-2 text-2xl font-semibold text-brand-white">
                  {formatKwh(usageTotals?.totalKwh ?? 0)} kWh
                </p>
                <p className="text-xs text-brand-cyan/60">
                  Earliest module interval:{' '}
                  <span className="font-semibold text-brand-white">
                    {formatDateTime(usageTotals?.earliestTs ?? null)}
                  </span>
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-brand-cyan/20 bg-brand-white p-6 shadow-lg">
              <h2 className="text-2xl font-semibold text-brand-navy mb-3">SMT Pipeline</h2>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-navy/60">
                    Top ESIIDs by latest interval
                  </h3>
                  <div className="overflow-auto rounded-2xl border border-brand-navy/10">
                    <table className="min-w-full divide-y divide-brand-navy/10 text-sm text-brand-navy">
                      <thead className="bg-brand-navy/5 text-xs font-semibold uppercase tracking-wide text-brand-navy/70">
                        <tr>
                          <th className="px-4 py-2 text-left">ESIID</th>
                          <th className="px-4 py-2 text-left">Intervals</th>
                          <th className="px-4 py-2 text-left">Total kWh</th>
                          <th className="px-4 py-2 text-left">Last seen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-navy/10">
                        {debugData.smt.topEsiids.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-4 text-center text-brand-navy/60">
                              No SMT intervals ingested yet.
                            </td>
                          </tr>
                        ) : (
                          debugData.smt.topEsiids.map((row) => (
                            <tr key={row.esiid}>
                              <td className="px-4 py-2 font-mono text-xs text-brand-navy/80">{row.esiid}</td>
                              <td className="px-4 py-2">{row.intervalCount.toLocaleString()}</td>
                              <td className="px-4 py-2">{formatKwh(row.totalKwh)}</td>
                              <td className="px-4 py-2">{formatDateTime(row.lastTimestamp)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-navy/60">
                    Latest SMT intervals (25)
                  </h3>
                  <div className="overflow-auto rounded-2xl border border-brand-navy/10">
                    <table className="min-w-full divide-y divide-brand-navy/10 text-sm text-brand-navy">
                      <thead className="bg-brand-navy/5 text-xs font-semibold uppercase tracking-wide text-brand-navy/70">
                        <tr>
                          <th className="px-4 py-2 text-left">Timestamp</th>
                          <th className="px-4 py-2 text-left">ESIID</th>
                          <th className="px-4 py-2 text-left">Meter</th>
                          <th className="px-4 py-2 text-left">kWh</th>
                          <th className="px-4 py-2 text-left">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-navy/10">
                        {debugData.smt.latestIntervals.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-4 text-center text-brand-navy/60">
                              No intervals recorded.
                            </td>
                          </tr>
                        ) : (
                          debugData.smt.latestIntervals.map((row, index) => (
                            <tr key={`${row.esiid}-${row.ts}-${index}`}>
                              <td className="px-4 py-2">{formatDateTime(row.ts)}</td>
                              <td className="px-4 py-2 font-mono text-xs text-brand-navy/80">{row.esiid}</td>
                              <td className="px-4 py-2">{row.meter}</td>
                              <td className="px-4 py-2">{formatKwh(row.kwh)}</td>
                              <td className="px-4 py-2">{row.source ?? 'smt'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-navy/60">
                  Raw SMT files (latest 12)
                </h3>
                <div className="overflow-auto rounded-2xl border border-brand-navy/10">
                  <table className="min-w-full divide-y divide-brand-navy/10 text-sm text-brand-navy">
                    <thead className="bg-brand-navy/5 text-xs font-semibold uppercase tracking-wide text-brand-navy/70">
                      <tr>
                        <th className="px-4 py-2 text-left">Received</th>
                        <th className="px-4 py-2 text-left">Filename</th>
                        <th className="px-4 py-2 text-left">Size</th>
                        <th className="px-4 py-2 text-left">Source</th>
                        <th className="px-4 py-2 text-left">Storage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-navy/10">
                      {debugData.smt.rawFiles.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-4 text-center text-brand-navy/60">
                            No raw SMT files recorded.
                          </td>
                        </tr>
                      ) : (
                        debugData.smt.rawFiles.map((file) => (
                          <tr key={file.id}>
                            <td className="px-4 py-2">{formatDateTime(file.receivedAt)}</td>
                            <td className="px-4 py-2 truncate">{file.filename}</td>
                            <td className="px-4 py-2">{formatBytes(file.sizeBytes)}</td>
                            <td className="px-4 py-2">{file.source}</td>
                            <td className="px-4 py-2">{file.storagePath ?? '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-brand-cyan/20 bg-brand-white p-6 shadow-lg">
              <h2 className="text-2xl font-semibold text-brand-navy mb-3">Usage Module (Normalized)</h2>
              <p className="text-sm text-brand-navy/70 mb-4">
                These rows mirror the usage database (`UsageIntervalModule`) after SMT or Green Button records have been
                normalized. The dashboard promotes whichever data source updated most recently.
              </p>
              <div className="overflow-auto rounded-2xl border border-brand-navy/10">
                <table className="min-w-full divide-y divide-brand-navy/10 text-sm text-brand-navy">
                  <thead className="bg-brand-navy/5 text-xs font-semibold uppercase tracking-wide text-brand-navy/70">
                    <tr>
                      <th className="px-4 py-2 text-left">Timestamp</th>
                      <th className="px-4 py-2 text-left">ESIID</th>
                      <th className="px-4 py-2 text-left">Meter</th>
                      <th className="px-4 py-2 text-left">kWh</th>
                      <th className="px-4 py-2 text-left">Filled</th>
                      <th className="px-4 py-2 text-left">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-navy/10">
                    {debugData.usageModule.latestRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-4 text-center text-brand-navy/60">
                          No normalized intervals stored yet.
                        </td>
                      </tr>
                    ) : (
                      debugData.usageModule.latestRows.map((row, index) => (
                        <tr key={`${row.esiid ?? 'unknown'}-${row.ts}-${index}`}>
                          <td className="px-4 py-2">{formatDateTime(row.ts)}</td>
                          <td className="px-4 py-2 font-mono text-xs text-brand-navy/80">
                            {row.esiid ?? '—'}
                          </td>
                          <td className="px-4 py-2">{row.meter ?? '—'}</td>
                          <td className="px-4 py-2">{formatKwh(row.kwh)}</td>
                          <td className="px-4 py-2">
                            {row.filled ? (
                              <span className="rounded-full border border-brand-blue/30 bg-brand-blue/10 px-2 py-0.5 text-xs text-brand-blue">
                                Filled
                              </span>
                            ) : (
                              <span className="rounded-full border border-brand-navy/20 bg-brand-navy/5 px-2 py-0.5 text-xs text-brand-navy/70">
                                Raw
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2">{row.source ?? 'usage'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}

        <section className="rounded-3xl border border-brand-navy/15 bg-brand-navy/5 p-6 shadow-lg">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold text-brand-navy mb-2">🌿 Green Button Pipeline</h2>
              <p className="text-sm text-brand-navy/70">
                Stream Green Button XML/CSV/JSON files through the droplet uploader to verify ticket generation, droplet
                ingestion, and normalization into the usage database. Debug output and recent uploads appear below.
              </p>
            </div>
            <div className="rounded-full border border-brand-blue/30 bg-brand-blue/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-brand-blue">
              Usage DB only
            </div>
          </div>

          <form
            onSubmit={handleGreenButtonUpload}
            className="mt-6 grid gap-4 rounded-2xl border border-brand-navy/10 bg-brand-navy/5 p-4 sm:grid-cols-2"
          >
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label
                htmlFor="green-button-file"
                className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy"
              >
                Green Button file (XML/CSV/JSON)
              </label>
              <input
                ref={greenButtonFileInputRef}
                id="green-button-file"
                type="file"
                accept=".csv,.xml,.json,text/csv,application/xml,application/json"
                onChange={handleGreenButtonFileChange}
                className="w-full rounded-lg border border-brand-navy/20 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
              />
              <p className="text-xs text-brand-navy/60">
                Sample CSV headers supported: <code className="bg-brand-navy/10 px-1">timestamp,value</code>,{' '}
                <code className="bg-brand-navy/10 px-1">start,end,value</code>, or JSON arrays with{' '}
                <code className="bg-brand-navy/10 px-1">timestamp</code> / <code className="bg-brand-navy/10 px-1">value</code>.
              </p>
            </div>

            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="green-button-user"
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy"
                >
                  User email (optional)
                </label>
                <input
                  id="green-button-user"
                  list="green-button-user-options"
                  value={greenButtonUserEmail}
                  onChange={(event) => handleGreenButtonUserInputChange(event.target.value)}
                  onBlur={(event) => handleGreenButtonUserInputChange(event.target.value)}
                  placeholder="Start typing an IntelliWatt email"
                  className="rounded-lg border border-brand-navy/20 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                />
                <datalist id="green-button-user-options">
                  {users.map((user) => (
                    <option key={user.id} value={user.email} />
                  ))}
                </datalist>
                <p className="text-xs text-brand-navy/60">
                  Selecting a user auto-fills their active houses. Leave blank to paste any valid house ID manually.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="green-button-house"
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy"
                >
                  House ID
                </label>
                <input
                  id="green-button-house"
                  list="green-button-house-options"
                  type="text"
                  value={greenButtonHouseId}
                  onChange={(event) => setGreenButtonHouseId(event.target.value)}
                  placeholder="Select or paste the house ID for this upload"
                  className="rounded-lg border border-brand-navy/20 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                />
                <datalist id="green-button-house-options">
                  {availableHouseOptions.map((house) => (
                    <option
                      key={house.id}
                      value={house.id}
                      label={
                        house.addressLine1
                          ? `${house.addressLine1}${house.archivedAt ? ' (archived)' : ''}`
                          : house.archivedAt
                          ? `${house.id} (archived)`
                          : house.id
                      }
                    />
                  ))}
                </datalist>
                <p className="text-xs text-brand-navy/60">
                  Ticket flow requires a valid house ID. Choose from the list or paste one copied from the Users table.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="green-button-utility"
                className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy"
              >
                Utility name (optional)
              </label>
              <input
                id="green-button-utility"
                type="text"
                value={greenButtonUtility}
                onChange={(event) => setGreenButtonUtility(event.target.value)}
                placeholder="e.g., Oncor, CenterPoint"
                className="rounded-lg border border-brand-navy/20 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="green-button-account"
                className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy"
              >
                Account number (optional)
              </label>
              <input
                id="green-button-account"
                type="text"
                value={greenButtonAccount}
                onChange={(event) => setGreenButtonAccount(event.target.value)}
                placeholder="Add context for the upload"
                className="rounded-lg border border-brand-navy/20 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
              />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="submit"
                disabled={uploadingGreenButton}
                className="inline-flex items-center justify-center rounded-full bg-brand-navy px-5 py-2 text-xs font-semibold uppercase tracking-wide text-brand-white shadow-[0_10px_35px_rgba(16,46,90,0.18)] transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadingGreenButton ? 'Uploading…' : 'Upload & normalize'}
              </button>
              <p className="text-xs text-brand-navy/60">
                Max file size: 10&nbsp;MB. Normalized rows are stored in{' '}
                <code className="bg-brand-navy/10 px-1 rounded-sm">usage.GreenButtonInterval</code>.
              </p>
            </div>

            {greenButtonStatus ? (
              <div className="sm:col-span-2 text-sm text-brand-navy">
                {greenButtonStatus}
              </div>
            ) : null}
          </form>
          {greenButtonLog.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-brand-navy/10 bg-brand-navy/5 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-navy/80">
                Debug log
              </h3>
              <div className="mt-2 space-y-1 overflow-x-auto text-xs font-mono text-brand-navy">
                {greenButtonLog.map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="text-lg font-semibold text-brand-navy">Recent uploads</h3>
              <div className="rounded-2xl border border-brand-navy/10 bg-brand-navy/5">
                <div className="grid grid-cols-5 gap-3 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy/70">
                  <span>Filename</span>
                  <span>Uploaded</span>
                  <span>Size</span>
                  <span>Intervals</span>
                  <span>Total kWh</span>
                </div>
                <div className="divide-y divide-brand-navy/10">
                  {normalizedUploads.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-brand-navy/60">
                      No uploads recorded yet. Use the form above to add a sample file.
                    </div>
                  ) : (
                    normalizedUploads.map((upload) => (
                      <div key={upload.id} className="grid grid-cols-5 gap-3 px-4 py-3 text-sm text-brand-navy">
                        <div className="truncate">{upload.filename}</div>
                        <div>{formatDateTime(upload.createdAt)}</div>
                        <div>{formatBytes(upload.sizeBytes)}</div>
                        <div>{upload.intervals.count.toLocaleString()}</div>
                        <div>{formatKwh(upload.intervals.totalKwh)} kWh</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-lg font-semibold text-brand-navy">Sample intervals (first 50 rows)</h3>
              <div className="max-h-72 overflow-auto rounded-2xl border border-brand-navy/10 bg-brand-navy/5">
                <table className="min-w-full divide-y divide-brand-navy/10 text-sm text-brand-navy">
                  <thead className="bg-brand-white/60 text-xs font-semibold uppercase tracking-wide text-brand-navy/70">
                    <tr>
                      <th className="px-4 py-2 text-left">Timestamp (UTC)</th>
                      <th className="px-4 py-2 text-left">kWh</th>
                      <th className="px-4 py-2 text-left">Interval</th>
                      <th className="px-4 py-2 text-left">Raw ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-navy/10">
                    {normalizedSamples.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-4 text-center text-brand-navy/60">
                          Upload a file to view normalized 15-minute rows.
                        </td>
                      </tr>
                    ) : (
                      normalizedSamples.map((interval) => (
                        <tr key={interval.id}>
                          <td className="px-4 py-2">{formatDateTime(interval.timestamp)}</td>
                          <td className="px-4 py-2">{formatKwh(Number(interval.consumptionKwh))}</td>
                          <td className="px-4 py-2">{interval.intervalMinutes} min</td>
                          <td className="px-4 py-2 truncate">{interval.rawId}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-brand-navy/60">
                These rows come directly from the usage database’s{' '}
                <code className="bg-brand-navy/10 px-1 rounded-sm">GreenButtonInterval</code> table. Confirm totals before
                wiring the production normalization jobs.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
