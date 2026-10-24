import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  FIRST_DAY,
  Kpi,
  LAST_DAY,
  SafetyMargin,
  Status,
  Toolbar,
  formatMw,
  formatNumber,
  useApi,
  type AccuracyResponse,
} from "./shared";

export default function AccuracyView() {
  const [start, setStart] = useState(FIRST_DAY);
  const [end, setEnd] = useState(LAST_DAY);
  const [cutoff, setCutoff] = useState("09:00");
  const ready = start && end && cutoff;
  const path = ready ? `/api/accuracy?start=${start}&end=${end}&cutoff=${cutoff}` : null;
  const state = useApi<AccuracyResponse>(path);

  return (
    <div className="space-y-5">
      <Toolbar>
        <DayInput label="From decision day" value={start} onChange={setStart} />
        <DayInput label="To decision day" value={end} onChange={setEnd} />
        <CutoffInput value={cutoff} onChange={setCutoff} />
        <p className="max-w-sm text-sm text-slate-500 sm:ml-auto sm:text-right">
          How accurate the forecast available at decision time was over a period, so you know how
          much to trust it.
        </p>
      </Toolbar>
      {path && <Status {...state}>{(data) => <AccuracyContent data={data} />}</Status>}
    </div>
  );
}

const axis = { stroke: COLORS.axis, tick: { fontSize: 12 } };
const margin = { top: 8, right: 8, bottom: 8, left: 8 };
const mwTick = (value: number) => formatNumber(value);

function AccuracyContent({ data }: { data: AccuracyResponse }) {
  const s = data.summary;
  const daily = data.daily.map((d) => ({ ...d, day: d.delivery_date.slice(5) }));
  const percentiles: [string, number | null][] = [
    ["10% of hours", s.p10_mw],
    ["Half of hours", s.p50_mw],
    ["90% of hours", s.p90_mw],
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label="Hours with data"
          value={`${s.hours}/${s.total_hours}`}
          hint="Gaps are left out"
          tone={s.hours < s.total_hours ? "amber" : "green"}
        />
        <Kpi label="Average miss" value={formatMw(s.mae_mw)} hint="Mean absolute error" tone="blue" />
        <Kpi
          label="Miss vs avg wind"
          value={s.nmae == null ? "–" : `${Math.round(s.nmae * 100)}%`}
          hint={`Average wind ${formatMw(s.mean_actual_mw)}`}
          tone="blue"
        />
        <Kpi
          label="Average bias"
          value={formatMw(s.bias_mw, true)}
          hint={(s.bias_mw ?? 0) > 0 ? "Forecasts were too high" : "Forecasts were too low"}
          tone={(s.bias_mw ?? 0) > 0 ? "red" : "blue"}
        />
        <Kpi label="Typical miss" value={formatMw(s.rmse_mw)} hint="RMSE: big misses weigh more" />
        <Kpi
          label="Biggest miss"
          value={formatMw(s.max_abs_error_mw)}
          hint="In a single hour"
          tone="amber"
        />
      </div>

      <SafetyMargin margin={s.p90_mw} hours={s.hours} />

      <Card
        title="How big the errors get"
        subtitle="Error = forecast − actual. The error was at or below this value in:"
      >
        <div className="grid grid-cols-3 gap-3 text-center tabular-nums">
          {percentiles.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 px-3 py-4 ring-1 ring-slate-200">
              <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                {label}
              </div>
              <div
                className={`mt-1 text-xl font-semibold ${(value ?? 0) > 0 ? "text-rose-600" : "text-blue-600"}`}
              >
                {formatMw(value, true)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Accuracy per delivery day"
        subtitle="Bars: average miss. Line: average bias (+ = forecast too high)."
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={daily} margin={margin}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="day" {...axis} />
            <YAxis {...axis} tickFormatter={mwTick} width={60} />
            <Tooltip
              formatter={(value, name) => [formatMw(Number(value), name === "Average bias"), name]}
            />
            <Legend />
            <Bar
              dataKey="mae_mw"
              name="Average miss"
              fill={COLORS.forecast}
              isAnimationActive={false}
            />
            <Line
              dataKey="bias_mw"
              name="Average bias"
              stroke={COLORS.bias}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card
        title="How often errors of each size happened"
        subtitle="Hours per 500 MW error band. Red: forecast too high (risk of buying too little)."
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.histogram} margin={margin}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="from_mw" {...axis} tickFormatter={mwTick} />
            <YAxis {...axis} allowDecimals={false} width={40} />
            <Tooltip
              formatter={(value) => [value, "Hours"]}
              labelFormatter={(from) =>
                `Error ${formatMw(Number(from), true)} to ${formatMw(Number(from) + 500, true)}`
              }
            />
            <Bar dataKey="hours" isAnimationActive={false}>
              {data.histogram.map((band) => (
                <Cell
                  key={band.from_mw}
                  fill={band.from_mw >= 0 ? COLORS.overForecast : COLORS.forecast}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </>
  );
}
