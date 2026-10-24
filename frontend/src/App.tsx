import { useState } from "react";
import AccuracyView from "./AccuracyView";
import DayView from "./DayView";
import { WindIcon } from "./shared";

const TABS = [
  { id: "day", label: "Day view" },
  { id: "accuracy", label: "Forecast accuracy" },
] as const;

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("day");

  return (
    <div className="min-h-screen">
      <header className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-white">
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/20 text-sky-300 ring-1 ring-sky-400/30">
                <WindIcon />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  GB Wind Forecast Monitor
                </h1>
                <p className="text-sm text-slate-300">
                  Day-ahead wind forecasts vs actual generation, Great Britain
                </p>
              </div>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/20">
              Decisions made in January 2026 · delivery the next day
            </span>
          </div>

          <nav role="tablist" className="mt-6 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-t-lg px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  tab === t.id
                    ? "bg-slate-50 text-blue-700"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "day" ? <DayView /> : <AccuracyView />}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500">
        <div className="border-t border-slate-200 pt-4">
          Data: Elexon BMRS — WINDFOR (wind forecasts) and FUELHH (actual wind generation). All
          times are UK time (GMT, the same as UTC in January). Power is in megawatts (MW).
        </div>
      </footer>
    </div>
  );
}
