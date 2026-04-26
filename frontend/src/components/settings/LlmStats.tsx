"use client";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { LlmStats, LlmStatsByDay } from "@/types";

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

function fmt(n: number | undefined | null, decimals = 0): string {
  if (n == null) return "—";
  if (decimals > 0) return n.toFixed(decimals);
  return n.toLocaleString();
}

function fmtCost(usd: number | undefined | null): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.000001) return "<$0.000001";
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function DayChart({ days }: { days: LlmStatsByDay[] }) {
  if (!days.length) return null;
  const maxCalls = Math.max(...days.map((d) => d.calls), 1);

  return (
    <div className="mt-4">
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">Calls per day</p>
      <div className="flex items-end gap-0.5 h-16">
        {days.map((d) => {
          const pct = Math.max((d.calls / maxCalls) * 100, 2);
          return (
            <div
              key={d.date}
              className="flex-1 group relative"
              style={{ height: "100%", display: "flex", alignItems: "flex-end" }}
            >
              <div
                className="w-full rounded-sm bg-stone-400 dark:bg-stone-500 group-hover:bg-amber-500 dark:group-hover:bg-amber-400 transition-colors"
                style={{ height: `${pct}%` }}
              />
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap bg-stone-800 text-stone-100 text-[10px] rounded px-1.5 py-0.5 pointer-events-none">
                {d.date}<br />{d.calls} calls · {fmtCost(d.estimated_cost_usd)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-stone-100 dark:bg-stone-900 rounded-lg px-4 py-3 min-w-0">
      <p className="text-[11px] text-stone-500 dark:text-stone-400 mb-0.5 truncate">{label}</p>
      <p className="text-lg font-semibold text-stone-900 dark:text-stone-100 truncate">{value}</p>
      {sub && <p className="text-[11px] text-stone-400 dark:text-stone-500 truncate">{sub}</p>}
    </div>
  );
}

export default function LlmStats() {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<LlmStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.llmStats.get(p);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  const s = data?.summary;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">Usage & Cost</h2>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                period === p.value
                  ? "bg-stone-800 dark:bg-stone-200 text-stone-100 dark:text-stone-900"
                  : "text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 mb-3">{error}</p>
      )}

      {loading && !data && (
        <p className="text-xs text-stone-400 dark:text-stone-500">Loading…</p>
      )}

      {data != null && s != null && (
        <div className={loading ? "opacity-50 pointer-events-none transition-opacity" : ""}>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <StatCard label="Total calls" value={fmt(s.total_calls)} />
            <StatCard
              label="Errors"
              value={fmt(s.error_count)}
              sub={s.total_calls ? `${(s.error_rate * 100).toFixed(1)}% rate` : undefined}
            />
            <StatCard
              label="Tokens used"
              value={fmtTokens(s.total_prompt_tokens + s.total_completion_tokens)}
              sub={`${fmtTokens(s.total_prompt_tokens)} in · ${fmtTokens(s.total_completion_tokens)} out`}
            />
            <StatCard
              label="Est. cost"
              value={fmtCost(s.estimated_cost_usd)}
              sub={`avg ${fmt(s.avg_latency_ms)}ms`}
            />
          </div>

          {/* Day chart */}
          {data.by_day.length > 0 && <DayChart days={data.by_day} />}

          {/* By task */}
          {data.by_task.length > 0 && (
            <div className="mt-5">
              <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">By task</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-stone-400 dark:text-stone-500 border-b border-stone-200 dark:border-stone-800">
                      <th className="pb-1.5 font-normal pr-4">Task</th>
                      <th className="pb-1.5 font-normal pr-4 text-right">Calls</th>
                      <th className="pb-1.5 font-normal pr-4 text-right">Tokens in</th>
                      <th className="pb-1.5 font-normal pr-4 text-right">Tokens out</th>
                      <th className="pb-1.5 font-normal text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_task.map((row) => (
                      <tr
                        key={row.task_name}
                        className="border-b border-stone-100 dark:border-stone-800/60 text-stone-700 dark:text-stone-300"
                      >
                        <td className="py-1.5 pr-4 font-mono">{row.task_name}</td>
                        <td className="py-1.5 pr-4 text-right">{fmt(row.calls)}</td>
                        <td className="py-1.5 pr-4 text-right">{fmtTokens(row.prompt_tokens)}</td>
                        <td className="py-1.5 pr-4 text-right">{fmtTokens(row.completion_tokens)}</td>
                        <td className="py-1.5 text-right">{fmtCost(row.estimated_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* By model */}
          {data.by_model.length > 0 && (
            <div className="mt-5">
              <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">By model</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-stone-400 dark:text-stone-500 border-b border-stone-200 dark:border-stone-800">
                      <th className="pb-1.5 font-normal pr-4">Model</th>
                      <th className="pb-1.5 font-normal pr-4 text-right">Calls</th>
                      <th className="pb-1.5 font-normal pr-4 text-right">Tokens in</th>
                      <th className="pb-1.5 font-normal pr-4 text-right">Tokens out</th>
                      <th className="pb-1.5 font-normal text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_model.map((row) => (
                      <tr
                        key={`${row.provider_type}:${row.model}`}
                        className="border-b border-stone-100 dark:border-stone-800/60 text-stone-700 dark:text-stone-300"
                      >
                        <td className="py-1.5 pr-4">
                          <span className="font-mono">{row.model}</span>
                          <span className="ml-1.5 text-stone-400 dark:text-stone-500">{row.provider_type}</span>
                        </td>
                        <td className="py-1.5 pr-4 text-right">{fmt(row.calls)}</td>
                        <td className="py-1.5 pr-4 text-right">{fmtTokens(row.prompt_tokens)}</td>
                        <td className="py-1.5 pr-4 text-right">{fmtTokens(row.completion_tokens)}</td>
                        <td className="py-1.5 text-right">{fmtCost(row.estimated_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {s.total_calls === 0 && (
            <p className="text-xs text-stone-400 dark:text-stone-500 text-center py-6">
              No LLM calls recorded in this period.
            </p>
          )}

          <p className="text-[10px] text-stone-400 dark:text-stone-600 mt-4">
            Cost estimates are approximate. Models not in the pricing table show —.
          </p>
        </div>
      )}
    </section>
  );
}
