// Shared pieces: API hook, response types, formatting, colours and small UI components.
import { useEffect, useState, type ReactNode } from "react";

// ---------- API (always same origin under /api: Vite proxy, nginx or Vercel rewrites) ----------

type ApiState<T> = { data: T | null; error: string | null; loading: boolean };

/** Fetches `path` whenever it changes. Keeps the previous data while the next request loads. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: !!path });

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState((previous) => ({ data: previous.data, error: null, loading: true }));
    fetch(path, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.detail ?? `Server error (${response.status})`);
        setState({ data: body as T, error: null, loading: false });
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        const message = error instanceof TypeError ? "Could not reach the server." : error.message;
        setState({ data: null, error: message, loading: false });
      });
    return () => controller.abort();
  }, [path]);

  return state;
}

// ---------- API response types (see backend/app/main.py). MW; times are UTC ISO strings ----------

export type Summary = {
  hours: number;
  total_hours: number;
  mae_mw: number | null;
  rmse_mw: number | null;
  bias_mw: number | null;
  max_abs_error_mw: number | null;
  mean_actual_mw: number | null;
  p10_mw: number | null;
  p50_mw: number | null;
  p90_mw: number | null;
  nmae: number | null;
};

export type Hour = {
  target_time: string;
  publish_time: string | null;
  lead_time_hours: number | null;
  forecast_mw: number | null;
  actual_mw: number | null;
  error_mw: number | null;
  missing: boolean;
  range_low_mw: number | null;
  range_high_mw: number | null;
};

export type ForecastResponse = {
  decision_date: string;
  delivery_date: string;
  decision_time: string;
  forecast_publish_time: string | null;
  summary: Summary;
  safety_margin_mw: number | null;
  margin_hours: number;
  hours: Hour[];
};

export type AccuracyResponse = {
  start: string;
  end: string;
  cutoff: string;
  summary: Summary;
  daily: { decision_date: string; delivery_date: string; mae_mw: number; bias_mw: number }[];
  histogram: { from_mw: number; hours: number }[];
};

// ---------- formatting (always UK time; GMT = UTC in January) ----------

const uk = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...options });
const hourFormat = uk({ hour: "2-digit", minute: "2-digit" });
const dateTimeFormat = uk({
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFormat = uk({ weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** "07:30" */
export const formatHour = (iso: string) => hourFormat.format(new Date(iso));
/** "Sat 10 Jan, 07:30" */
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
/** "Sun 11 Jan 2026" (input is a YYYY-MM-DD date) */
export const formatDay = (isoDate: string) => dayFormat.format(new Date(`${isoDate}T12:00:00Z`));

/** "12,050", or "+1,748" when signed; "–" when there is no value. */
export function formatNumber(value: number | null | undefined, signed = false): string {
  if (value == null) return "–";
  return `${signed && value > 0 ? "+" : ""}${Math.round(value).toLocaleString("en-GB")}`;
}

/** "12,050 MW", or "+1,748 MW" when signed. */
export const formatMw = (value: number | null | undefined, signed = false) =>
  value == null ? "–" : `${formatNumber(value, signed)} MW`;

// Decision days covered by the data: purchase decisions made in January 2026.
export const FIRST_DAY = "2026-01-01";
export const LAST_DAY = "2026-01-31";

// Forecast/actual are a colour-blind-safe pair.
export const COLORS = {
  forecast: "#2a78d6",
  actual: "#eb6834",
  range: "#cde2fb",
  bias: "#1baf7a",
  overForecast: "#e34948", // positive error: forecast too high (risky: we under-buy)
  grid: "#e2e8f0",
  axis: "#64748b",
};

// ---------- UI components ----------

/** Wind logo: three curved gusts (inline SVG, so no icon package is needed). */
export function WindIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
    </svg>
  );
}

const TONES = {
  neutral: "border-t-slate-400",
  blue: "border-t-blue-500",
  amber: "border-t-amber-500",
  red: "border-t-rose-500",
  green: "border-t-emerald-500",
};

type KpiProps = { label: string; value: string; hint?: string; tone?: keyof typeof TONES };

export function Kpi(props: KpiProps) {
  const tone = TONES[props.tone ?? "neutral"];
  return (
    <div className={`rounded-xl border border-t-4 border-slate-200 bg-white p-4 shadow-sm ${tone}`}>
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {props.label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {props.value}
      </div>
      {props.hint && <div className="mt-1 text-xs text-slate-500">{props.hint}</div>}
    </div>
  );
}

export function Card(props: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900">{props.title}</h3>
      {props.subtitle && <p className="mt-1 text-sm text-slate-500">{props.subtitle}</p>}
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

/** White strip holding a view's inputs. */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {children}
    </div>
  );
}

/** Loading and error messages; renders the content once data has arrived. */
export function Status<T>(props: ApiState<T> & { children: (data: T) => ReactNode }) {
  if (props.error)
    return (
      <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
        Something went wrong: {props.error}
      </p>
    );
  if (!props.data)
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
        Loading…
      </div>
    );
  return (
    <div className={`space-y-5 transition-opacity ${props.loading ? "opacity-50" : ""}`}>
      {props.children(props.data)}
    </div>
  );
}

const inputClass =
  "mt-1 block rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200 focus:outline-none";
const labelClass = "text-xs font-medium tracking-wide text-slate-500 uppercase";

export function DayInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={labelClass}>
      {props.label}
      <input
        type="date"
        className={inputClass}
        min={FIRST_DAY}
        max={LAST_DAY}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

export function CutoffInput(props: { value: string; onChange: (v: string) => void }) {
  return (
    <label className={labelClass}>
      Decision time (UK)
      <input
        type="time"
        className={inputClass}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

/** "Historically, in 90% of hours, actual wind was at least forecast - X MW." */
export function SafetyMargin({ margin, hours }: { margin: number | null; hours: number }) {
  if (margin == null) return null;
  const x = Math.round(margin); // round once so the sentence and example agree
  const deduction = `${x >= 0 ? "−" : "+"} ${formatMw(Math.abs(x))}`;
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-700 p-5 text-white shadow-md sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-xs font-semibold tracking-widest text-blue-100 uppercase">
          Safety margin for buying decisions
        </h3>
        <p className="mt-2 text-lg">
          Historically, in 90% of hours, actual wind was at least{" "}
          <strong>forecast {deduction}</strong>.
        </p>
        <p className="mt-1 text-sm text-blue-100">
          Example: if the forecast is 10,000 MW, plan on at least {formatMw(10000 - x)} of wind.
        </p>
        <p className="mt-2 text-xs text-blue-200">
          90th percentile of forecast error over {hours.toLocaleString("en-GB")} January hours. An
          estimate from the same data shown here (in-sample), not a guarantee: other weather or
          seasons may differ.
        </p>
      </div>
      <div className="shrink-0 rounded-lg bg-white/10 px-5 py-3 text-center ring-1 ring-white/20">
        <div className="text-xs tracking-wide text-blue-100 uppercase">Deduct from forecast</div>
        <div className="mt-1 text-3xl font-bold tabular-nums">{deduction}</div>
      </div>
    </section>
  );
}
