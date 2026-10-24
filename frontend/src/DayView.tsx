import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  COLORS,
  Card,
  CutoffInput,
  DayInput,
  Kpi,
  SafetyMargin,
  Status,
  Toolbar,
  formatDateTime,
  formatDay,
  formatHour,
  formatMw,
  formatNumber,
  useApi,
  type ForecastResponse,
  type Hour,
} from "./shared";

export default function DayView() {
  const [day, setDay] = useState("2026-01-10");
  const [cutoff, setCutoff] = useState("09:00");
  const path = day && cutoff ? `/api/forecast?date=${day}&cutoff=${cutoff}` : null;
  const state = useApi<ForecastResponse>(path);

  return (
    <div className="space-y-5">
      <Toolbar>
        <DayInput label="Decision day" value={day} onChange={setDay} />
        <CutoffInput value={cutoff} onChange={setCutoff} />
        <p className="max-w-md text-sm text-slate-500 sm:ml-auto sm:text-right">
          The wind forecast you had when deciding how much power to buy for the next day,
          compared with what was actually generated.
        </p>
      </Toolbar>
      {path && <Status {...state}>{(data) => <DayContent data={data} />}</Status>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-0.5 font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function DayContent({ data }: { data: ForecastResponse }) {
  const s = data.summary;
  const published = data.forecast_publish_time;
  return (
    <>
      <div className="grid divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Fact label="Delivery day" value={formatDay(data.delivery_date)} />
        <Fact label="Decision time (UK)" value={formatDateTime(data.decision_time)} />
        <Fact
          label="Forecast used, published"
          value={published ? formatDateTime(published) : "None published yet"}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Hours with data"
          value={`${s.hours}/${s.total_hours}`}
          hint="Gaps are left out"
          tone={s.hours < s.total_hours ? "amber" : "green"}
        />
        <Kpi label="Average miss" value={formatMw(s.mae_mw)} hint="Mean absolute error" tone="blue" />
        <Kpi
          label="Average bias"
          value={formatMw(s.bias_mw, true)}
          hint={(s.bias_mw ?? 0) > 0 ? "Forecast was too high" : "Forecast was too low"}
          tone={(s.bias_mw ?? 0) > 0 ? "red" : "blue"}
        />
        <Kpi
          label="Biggest miss"
          value={formatMw(s.max_abs_error_mw)}
          hint="In a single hour"
          tone="amber"
        />
      </div>

      <SafetyMargin margin={data.safety_margin_mw} hours={data.margin_hours} />

      <Card
        title="Forecast vs actual wind generation (MW)"
        subtitle="Hourly average power, UK time. The band is where the actual landed in 80% of January hours. Gaps are hours with missing data, left out of the numbers above."
      >
        <ForecastChart hours={data.hours} />
      </Card>

      <HourlyTable hours={data.hours} />
    </>
  );
}

function ForecastChart({ hours }: { hours: Hour[] }) {
  const chartData = hours.map((h) => ({
    hour: formatHour(h.target_time),
    forecast: h.forecast_mw,
    actual: h.actual_mw,
    range: h.range_low_mw != null ? [h.range_low_mw, h.range_high_mw] : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <CartesianGrid stroke={COLORS.grid} vertical={false} />
        <XAxis dataKey="hour" stroke={COLORS.axis} tick={{ fontSize: 12 }} interval={2} />
        <YAxis
          stroke={COLORS.axis}
          tick={{ fontSize: 12 }}
          tickFormatter={(v: number) => formatNumber(v)}
          width={60}
        />
        <Tooltip
          formatter={(value, name) =>
            Array.isArray(value)
              ? [`${formatMw(value[0])} – ${formatMw(value[1])}`, name]
              : [formatMw(Number(value)), name]
          }
        />
        {/* Grey legend text: the pale range colour would be unreadable as text. */}
        <Legend formatter={(value) => <span className="text-slate-700">{value}</span>} />
        <Area
          dataKey="range"
          name="Likely range (P10–P90)"
          stroke="none"
          fill={COLORS.range}
          fillOpacity={0.8}
          isAnimationActive={false}
        />
        <Line
          dataKey="forecast"
          name="Forecast at decision time"
          stroke={COLORS.forecast}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="actual"
          name="Actual"
          stroke={COLORS.actual}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function HourlyTable({ hours }: { hours: Hour[] }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <summary className="cursor-pointer font-semibold text-slate-900 marker:text-blue-600">
        Hourly numbers
      </summary>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-right text-sm tabular-nums">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Hour (UK)</th>
              <th className="px-3 py-2">Forecast (MW)</th>
              <th className="px-3 py-2">Actual (MW)</th>
              <th className="px-3 py-2">Error (MW)</th>
              <th className="px-3 py-2 text-left">Published</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.target_time} className="border-t border-slate-100 even:bg-slate-50/60">
                <td className="px-3 py-2 text-left font-medium">{formatHour(h.target_time)}</td>
                <td className="px-3 py-2">{formatNumber(h.forecast_mw)}</td>
                <td className="px-3 py-2">{formatNumber(h.actual_mw)}</td>
                <td className="px-3 py-2">
                  {h.missing ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Missing
                    </span>
                  ) : (
                    <span className={(h.error_mw ?? 0) > 0 ? "text-rose-600" : "text-blue-600"}>
                      {formatNumber(h.error_mw, true)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-left text-slate-500">
                  {h.publish_time ? formatDateTime(h.publish_time) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">
          Error = forecast − actual. Positive means the forecast was too high.
        </p>
      </div>
    </details>
  );
}
