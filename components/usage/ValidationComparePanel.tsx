"use client";

type ValidationCompareRow = {
  localDate: string;
  dayType: "weekday" | "weekend";
  actualDayKwh: number;
  simulatedDayKwh: number;
  errorKwh: number;
  percentError: number | null;
};

export function ValidationComparePanel(props: {
  rows: ValidationCompareRow[];
  metrics?: Record<string, unknown> | null;
  className?: string;
}) {
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const metrics = props.metrics && typeof props.metrics === "object" ? props.metrics : {};
  if (rows.length === 0) return null;

  return (
    <>
      <div className={["mt-2 text-xs text-brand-navy/80", props.className ?? ""].join(" ").trim()}>
        WAPE {Number(metrics?.wape ?? 0).toFixed(2)}% ·
        MAE {Number(metrics?.mae ?? 0).toFixed(2)} ·
        RMSE {Number(metrics?.rmse ?? 0).toFixed(2)}
      </div>
      <div className="mt-3 overflow-auto">
        <table className="min-w-full text-xs border border-brand-blue/10">
          <thead className="bg-brand-blue/5">
            <tr>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Date</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Day Type</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Actual kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Sim kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Error</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">% Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.localDate}>
                <td className="border border-brand-blue/10 px-2 py-1">{row.localDate}</td>
                <td className="border border-brand-blue/10 px-2 py-1">{row.dayType}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{Number(row.actualDayKwh ?? 0).toFixed(2)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{Number(row.simulatedDayKwh ?? 0).toFixed(2)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{Number(row.errorKwh ?? 0).toFixed(2)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">
                  {row.percentError == null ? "—" : `${Number(row.percentError).toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
