"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;
const WS  = process.env.NEXT_PUBLIC_WS_URL;

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentStatus = "dormant" | "waiting" | "running" | "done" | "failed";

interface AgentNode {
  id: string;
  label: string;
  tier: string;
  status: AgentStatus;
  resultSummary?: string;
  error?: string;
  startedAt?: number;
}

interface LogEntry {
  uid: number;
  ts: number;
  agent: string;
  message: string;
  level: "info" | "success" | "error" | "warn";
}

interface DayPlan {
  day: number;
  theme: string;
  morning: string;
  afternoon: string;
  evening: string;
  tips: string;
}

interface ItineraryData {
  destination: string;
  duration_days: number;
  summary?: string;
  recommended_hotel?: string;
  daily_budget_inr?: number;
  itinerary: DayPlan[];
  travel_tips?: string[];
}

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string;
}

interface Expense {
  id: string;
  paid_by: string;
  paid_by_name: string;
  paid_by_color: string;
  description: string;
  amount: number;
  category: string;
  expense_date: string | null;
  splits: { user_id: string; amount_owed: number; is_settled: boolean }[];
}

interface Balance {
  user_id: string;
  display_name: string;
  avatar_color: string;
  net_balance: number;
}

interface SettlementTx {
  from: string;
  to: string;
  amount: number;
  from_name: string;
  to_name: string;
  from_color: string;
  to_color: string;
}

interface Member {
  user_id: string;
  display_name: string;
  avatar_color: string;
  role: string;
  joined_at: string | null;
}

interface CustomAgentDef {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  code: string;
  api_keys: Record<string, string>;
}

// ─── Python syntax highlighter (no external deps) ────────────────────────────

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightPython(raw: string): string {
  type TokKind = "comment" | "str" | "keyword" | "special" | "builtin" | "func" | "number" | "deco";
  const tokens: { start: number; end: number; kind: TokKind }[] = [];
  const n = raw.length;
  let i = 0;

  const KW = new Set(["def","class","if","elif","else","for","while","return","import",
    "from","try","except","finally","with","as","in","not","and","or","True","False",
    "None","lambda","yield","pass","break","continue","raise","del","global","nonlocal",
    "assert","async","await"]);
  const BUILTINS = new Set(["print","len","range","dict","list","str","int","float","bool",
    "set","tuple","type","isinstance","getattr","setattr","hasattr","enumerate","zip","map",
    "filter","sorted","any","all","min","max","sum","abs","round","repr","format"]);
  const SPECIAL = new Set(["context","result","secrets","http_get","http_post"]);

  while (i < n) {
    const c = raw[i];
    // Decorator
    if (c === "@") {
      const si = i; i++;
      while (i < n && /[\w.]/.test(raw[i])) i++;
      tokens.push({ start: si, end: i, kind: "deco" });
    }
    // Comment
    else if (c === "#") {
      const si = i;
      while (i < n && raw[i] !== "\n") i++;
      tokens.push({ start: si, end: i, kind: "comment" });
    }
    // String (f/r/b prefix + single/triple)
    else if (/[fFrRbB]/.test(c) && i + 1 < n && /["']/.test(raw[i + 1])) {
      const si = i; i++;
      const q = raw[i];
      if (i + 2 < n && raw[i + 1] === q && raw[i + 2] === q) {
        i += 3;
        while (i + 2 < n && !(raw[i] === q && raw[i+1] === q && raw[i+2] === q)) i++;
        if (i + 2 < n) i += 3;
      } else {
        i++;
        while (i < n && raw[i] !== q && raw[i] !== "\n") { if (raw[i] === "\\") i++; i++; }
        if (i < n && raw[i] === q) i++;
      }
      tokens.push({ start: si, end: i, kind: "str" });
    }
    else if (c === '"' || c === "'") {
      const si = i;
      const q = c;
      if (i + 2 < n && raw[i + 1] === q && raw[i + 2] === q) {
        i += 3;
        while (i + 2 < n && !(raw[i] === q && raw[i+1] === q && raw[i+2] === q)) i++;
        if (i + 2 < n) i += 3;
      } else {
        i++;
        while (i < n && raw[i] !== q && raw[i] !== "\n") { if (raw[i] === "\\") i++; i++; }
        if (i < n && raw[i] === q) i++;
      }
      tokens.push({ start: si, end: i, kind: "str" });
    }
    // Identifiers / keywords
    else if (/[a-zA-Z_]/.test(c)) {
      const si = i;
      while (i < n && /[a-zA-Z0-9_]/.test(raw[i])) i++;
      const word = raw.slice(si, i);
      const isCall = i < n && raw[i] === "(";
      if (KW.has(word)) tokens.push({ start: si, end: i, kind: "keyword" });
      else if (SPECIAL.has(word)) tokens.push({ start: si, end: i, kind: "special" });
      else if (BUILTINS.has(word)) tokens.push({ start: si, end: i, kind: "builtin" });
      else if (isCall) tokens.push({ start: si, end: i, kind: "func" });
    }
    // Number
    else if (/[0-9]/.test(c)) {
      const si = i;
      while (i < n && /[0-9._xXoObB]/.test(raw[i])) i++;
      tokens.push({ start: si, end: i, kind: "number" });
    }
    else { i++; }
  }

  const COLOR: Record<TokKind, string> = {
    comment: "#52525b", str: "#86efac", keyword: "#c084fc", special: "#fbbf24",
    builtin: "#67e8f9", func: "#a78bfa", number: "#fb923c", deco: "#f472b6",
  };

  let out = ""; let pos = 0;
  for (const tok of tokens) {
    out += escHtml(raw.slice(pos, tok.start));
    out += `<span style="color:${COLOR[tok.kind]}">${escHtml(raw.slice(tok.start, tok.end))}</span>`;
    pos = tok.end;
  }
  out += escHtml(raw.slice(pos));
  return out;
}

// ─── CodeEditor: highlight-behind-textarea ────────────────────────────────────

function CodeEditor({
  value, onChange, placeholder, rows = 8,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const syncScroll = () => {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const sharedStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
    fontSize: "11px",
    lineHeight: "1.65",
    padding: "8px 10px",
    margin: 0,
    border: "none",
    outline: "none",
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    overflowWrap: "break-word",
    tabSize: 4,
    width: "100%",
    boxSizing: "border-box" as const,
  };

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: "6px", border: "1px solid #3f3f46", background: "#09090b" }}>
      {/* Highlighted layer */}
      <pre
        ref={preRef}
        aria-hidden="true"
        style={{
          ...sharedStyle,
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          pointerEvents: "none", overflow: "hidden", color: "#d4d4d8",
          minHeight: `${rows * 1.65 * 11 + 16}px`,
        }}
        dangerouslySetInnerHTML={{ __html: highlightPython(value) + "\n" }}
      />
      {/* Input layer */}
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        placeholder={placeholder}
        style={{
          ...sharedStyle,
          position: "relative",
          background: "transparent",
          color: "transparent",
          caretColor: "#e4e4e7",
          resize: "vertical",
          minHeight: `${rows * 1.65 * 11 + 16}px`,
          zIndex: 1,
        }}
      />
    </div>
  );
}

// ─── Static config ────────────────────────────────────────────────────────────

const INITIAL_AGENTS: AgentNode[] = [
  { id: "planner",                label: "Trip Planner",       tier: "Orchestrator", status: "dormant" },
  { id: "destination_research",   label: "Dest. Research",     tier: "Research",     status: "dormant" },
  { id: "transport_planning",     label: "Transport",          tier: "Logistics",    status: "dormant" },
  { id: "hotel_planning",         label: "Hotels",             tier: "Logistics",    status: "dormant" },
  { id: "food_discovery",         label: "Food & Dining",      tier: "Discovery",    status: "dormant" },
  { id: "itinerary_optimization", label: "Itinerary",          tier: "Synthesis",    status: "dormant" },
  { id: "budget_optimizer",       label: "Budget Optimizer",   tier: "Finance",      status: "dormant" },
];

const SUBTITLES: Record<string, Partial<Record<AgentStatus, string>>> = {
  planner:                { dormant: "Awaiting query",              running: "Parsing intent · building DAG · spawning agents",  done: "Pipeline complete",                    failed: "Orchestration failed" },
  destination_research:   { dormant: "Not started",  waiting: "Queued",         running: "Searching attractions · indexing to ES",           done: "Attractions indexed",                  failed: "Search failed" },
  transport_planning:     { dormant: "Not started",  waiting: "Blocked on destination", running: "Finding airports · rail & transit routes",         done: "Transport mapped",                     failed: "Failed" },
  hotel_planning:         { dormant: "Not started",  waiting: "Blocked on destination", running: "Querying hotels · matching budget",                done: "Hotels shortlisted",                   failed: "Failed" },
  food_discovery:         { dormant: "Not started",  waiting: "Blocked on destination", running: "Discovering cafes · restaurants · local cuisine",  done: "Dining curated",                       failed: "Failed" },
  itinerary_optimization: { dormant: "Not started",  waiting: "Blocked — awaiting transport · hotels · food", running: "Synthesizing context · building day-by-day plan",  done: "Itinerary ready", failed: "Optimization failed" },
  budget_optimizer:       { dormant: "Not started",  waiting: "Blocked — awaiting itinerary",                 running: "Analysing costs · finding savings",               done: "Budget breakdown ready", failed: "Analysis failed" },
};

// ─── Style lookups ────────────────────────────────────────────────────────────

const S: Record<AgentStatus, { border: string; bg: string; dot: string; tag: string }> = {
  dormant: { border: "border-zinc-800/40",    bg: "",                   dot: "bg-zinc-700",                    tag: "text-zinc-600" },
  waiting: { border: "border-zinc-700/60",    bg: "",                   dot: "bg-zinc-500",                    tag: "text-zinc-500" },
  running: { border: "border-amber-500/40",   bg: "bg-amber-950/20",    dot: "bg-amber-400 animate-pulse",     tag: "text-amber-400" },
  done:    { border: "border-emerald-600/35", bg: "bg-emerald-950/15",  dot: "bg-emerald-400",                 tag: "text-emerald-400" },
  failed:  { border: "border-red-700/40",     bg: "bg-red-950/20",      dot: "bg-red-400",                     tag: "text-red-400" },
};

const LOG_COLOR: Record<LogEntry["level"], string> = {
  info:    "text-zinc-500",
  success: "text-emerald-400",
  error:   "text-red-400",
  warn:    "text-amber-400",
};

// ─── Agent thinking lines (emitted on task events) ──────────────────────────────

const AGENT_THOUGHTS: Record<string, string[]> = {
  planner: [
    "Reading your travel query…",
    "Calling DeepSeek to extract intent & constraints…",
  ],
  planning_started: [
    "Building agent dependency graph",
    "Dispatching specialist agents to Redis queue",
  ],
  destination_research: [
    "Researching top attractions & local highlights...",
    "Fetching activity data from Places API",
  ],
  transport_planning: [
    "Mapping flight & rail connections...",
    "Comparing transit routes & costs",
  ],
  hotel_planning: [
    "Searching available accommodations...",
    "Filtering by budget, ratings & location",
  ],
  food_discovery: [
    "Discovering local restaurants & cafes...",
    "Curating dining recommendations",
  ],
  itinerary_optimization: [
    "Synthesizing outputs from all agents...",
    "Generating day-by-day itinerary",
    "Optimising schedule for budget & travel style",
  ],
  budget_optimizer: [
    "Reading itinerary & trip context...",
    "Estimating costs per category",
    "Finding money-saving opportunities",
  ],
};

const AGENT_LABEL: Record<string, string> = {
  destination_research:   "Destination Research",
  transport_planning:     "Transport",
  hotel_planning:         "Hotels",
  food_discovery:         "Food & Dining",
  itinerary_optimization: "Itinerary",
  budget_optimizer:       "Budget Optimizer",
};

// ─── Tree geometry: 3 × w-40 (160px) + 2 × gap-3 (12px) = 504px ─────────────

const TW  = 504;         // tier-2 container width (px)
const C1  = 80;          // center of node 1
const C2  = 252;         // center of node 2  (= TW/2)
const C3  = 424;         // center of node 3

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentCard({
  node,
  wide = false,
  onRerun,
  instructions,
  onInstructionsChange,
}: {
  node: AgentNode;
  wide?: boolean;
  onRerun?: () => void;
  instructions?: string;
  onInstructionsChange?: (v: string) => void;
}) {
  const s = S[node.status];
  const sub = SUBTITLES[node.id]?.[node.status] ?? "";
  const [elapsed, setElapsed] = useState(0);
  const [showInstr, setShowInstr] = useState(false);

  useEffect(() => {
    if (node.status !== "running" || !node.startedAt) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - node.startedAt) / 1000));
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - node.startedAt!) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [node.status, node.startedAt]);

  return (
    <div className={[
      "relative rounded-xl border transition-all duration-500",
      s.border, s.bg,
      wide ? "w-52" : "w-40",
      node.status === "dormant" ? "opacity-25" : "opacity-100",
    ].join(" ")}>

      {/* Running pulse ring */}
      {node.status === "running" && (
        <div className="absolute inset-0 rounded-xl border border-amber-400/20 animate-ping pointer-events-none" />
      )}

      <div className="p-3">
        {/* Status row */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
          <span className={`text-[9px] font-mono uppercase tracking-[0.15em] ${s.tag}`}>
            {node.status === "running" && elapsed > 0 ? `${elapsed}s` : node.status}
          </span>
          <span className="ml-auto text-[9px] font-mono text-zinc-700 uppercase tracking-[0.1em]">
            {node.tier}
          </span>
        </div>

        {/* Label */}
        <div className="text-xs font-semibold text-zinc-100 leading-tight mb-1">
          {node.label}
        </div>

        {/* Subtitle */}
        {sub && (
          <div className="text-[9px] text-zinc-500 leading-relaxed">{sub}</div>
        )}

        {/* Result */}
        {node.resultSummary && (
          <div className="mt-2 text-[9px] text-emerald-300/60 leading-relaxed pt-1.5 border-t border-emerald-800/30 line-clamp-2">
            {node.resultSummary}
          </div>
        )}

        {/* Error */}
        {node.error && (
          <div className="mt-2 text-[9px] text-red-300/60 leading-relaxed pt-1.5 border-t border-red-800/30 line-clamp-2">
            {node.error}
          </div>
        )}
        {/* Re-run */}
        {onRerun && (node.status === "done" || node.status === "failed") && (
          <div className="mt-2 pt-1.5 border-t border-zinc-800/40 flex items-center gap-1">
            <button
              onClick={e => { e.stopPropagation(); onRerun(); }}
              className="flex-1 text-[8px] font-mono text-zinc-700 hover:text-amber-400 transition-colors text-right"
            >
              ↻ re-run
            </button>
            {onInstructionsChange && (
              <button
                onClick={e => { e.stopPropagation(); setShowInstr(p => !p); }}
                className="text-[8px] font-mono text-zinc-800 hover:text-zinc-500 transition-colors pl-1.5"
                title="Add instructions for this agent"
              >
                {showInstr ? "▲" : "✎"}
              </button>
            )}
          </div>
        )}
        {/* Instructions textarea */}
        {showInstr && onInstructionsChange && (
          <div className="mt-1.5 pt-1.5 border-t border-zinc-800/30">
            <div className="text-[7px] font-mono text-zinc-700 uppercase tracking-wider mb-1">Refine instructions</div>
            <textarea
              rows={2}
              value={instructions ?? ""}
              onChange={e => onInstructionsChange(e.target.value)}
              placeholder="e.g. prefer vegetarian restaurants, avoid tourist traps…"
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded text-[9px] text-zinc-400 placeholder-zinc-700 px-2 py-1 outline-none resize-none focus:border-zinc-600 focus:text-zinc-200 transition-colors"
              style={{ scrollbarWidth: "none" } as React.CSSProperties}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Editable itinerary components ────────────────────────────────────────────

function EditableField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  };
  useEffect(() => { resize(); }, [value]);
  return (
    <div className="mb-3">
      <div className="text-[8px] font-mono text-zinc-700 uppercase tracking-[0.12em] mb-0.5">{label}</div>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={e => onChange(e.target.value)}
        onInput={resize}
        className="w-full bg-transparent text-[11px] text-zinc-400 leading-relaxed resize-none outline-none border-b border-transparent hover:border-zinc-800 focus:border-zinc-600 focus:text-zinc-200 transition-colors py-0.5"
        style={{ scrollbarWidth: "none" } as React.CSSProperties}
      />
    </div>
  );
}

function DayCard({ day, dayIdx, onEdit }: { day: DayPlan; dayIdx: number; onEdit: (field: string, value: string) => void }) {
  return (
    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-4 mb-3 log-row">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-[8px] font-mono font-bold bg-zinc-800/80 text-zinc-500 px-2 py-1 rounded uppercase tracking-wider shrink-0">
          Day {day.day}
        </span>
        <input
          value={day.theme ?? ""}
          onChange={e => onEdit("theme", e.target.value)}
          className="flex-1 bg-transparent text-[11px] font-semibold text-zinc-200 border-b border-transparent hover:border-zinc-800 focus:border-zinc-600 outline-none transition-colors"
          placeholder="Day theme…"
        />
      </div>
      <EditableField label="🌅 Morning" value={day.morning ?? ""} onChange={v => onEdit("morning", v)} />
      <EditableField label="☀️ Afternoon" value={day.afternoon ?? ""} onChange={v => onEdit("afternoon", v)} />
      <EditableField label="🌙 Evening" value={day.evening ?? ""} onChange={v => onEdit("evening", v)} />
      <EditableField label="💡 Tip" value={day.tips ?? ""} onChange={v => onEdit("tips", v)} />
    </div>
  );
}

function parseItinerary(data: unknown): ItineraryData | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return {
    destination: String(d.destination ?? ""),
    duration_days: Number(d.duration_days ?? 0),
    summary: d.summary ? String(d.summary) : undefined,
    recommended_hotel: d.recommended_hotel ? String(d.recommended_hotel) : undefined,
    daily_budget_inr: d.daily_budget_inr ? Number(d.daily_budget_inr) : undefined,
    itinerary: Array.isArray(d.itinerary)
      ? d.itinerary.map((dy: unknown) => {
          const o = dy as Record<string, unknown>;
          const acts = o.activities as Record<string, unknown> | undefined;
          return {
            day: Number(o.day ?? 0),
            theme: String(o.theme ?? ""),
            morning: String(o.morning || acts?.morning || o.morning_activity || ""),
            afternoon: String(o.afternoon || acts?.afternoon || o.afternoon_activity || ""),
            evening: String(o.evening || acts?.evening || o.evening_activity || ""),
            tips: String(o.tips || o.tip || o.local_tip || acts?.tips || ""),
          };
        })
      : [],
    travel_tips: Array.isArray(d.travel_tips) ? d.travel_tips.map(String) : [],
  };
}

function ItineraryPanel({
  data,
  onEdit,
  onRerunAgent,
}: {
  data: ItineraryData;
  onEdit: (dayIdx: number, field: string, value: string) => void;
  onRerunAgent: (taskType: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyAll = () => {
    const lines = [
      `✈  Trip to ${data.destination} — ${data.duration_days} days`,
      data.summary ?? "",
      data.recommended_hotel ? `🏨 Hotel: ${data.recommended_hotel}` : "",
      "",
      ...(data.itinerary ?? []).flatMap(d => [
        `── Day ${d.day}: ${d.theme} ──`,
        `🌅 Morning:    ${d.morning}`,
        `☀️ Afternoon:  ${d.afternoon}`,
        `🌙 Evening:    ${d.evening}`,
        `💡 Tip:        ${d.tips}`,
        "",
      ]),
      ...(data.travel_tips?.length ? ["Travel Tips:", ...(data.travel_tips ?? []).map(t => `• ${t}`)] : []),
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(lines);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="w-full mt-10 pb-12 log-row" style={{ maxWidth: 720 }}>
      <div className="flex items-center gap-3 mb-5 border-b border-zinc-800/40 pb-3">
        <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-[0.22em]">Itinerary</span>
        <span className="text-[9px] font-mono text-zinc-500">·</span>
        <span className="text-[9px] font-mono text-zinc-300">{data.destination}</span>
        <span className="text-[9px] font-mono text-zinc-600">{data.duration_days}d</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onRerunAgent("itinerary_optimization")}
            className="text-[9px] font-mono text-zinc-600 hover:text-amber-400 transition-colors px-2 py-1 border border-zinc-800 hover:border-amber-500/30 rounded"
          >
            ↻ re-optimize
          </button>
          <button
            onClick={copyAll}
            className="text-[9px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors px-2 py-1 border border-zinc-800 rounded"
          >
            {copied ? "✓ copied" : "⎘ copy"}
          </button>
        </div>
      </div>
      {data.summary && (
        <p className="text-[11px] text-zinc-500 leading-relaxed mb-5 italic">{data.summary}</p>
      )}
      <div className="flex gap-2 flex-wrap mb-5">
        {data.recommended_hotel && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60">
            <span className="text-[9px] text-zinc-600">🏨</span>
            <span className="text-[11px] font-mono text-zinc-300">{data.recommended_hotel}</span>
            <button
              onClick={() => onRerunAgent("hotel_planning")}
              title="Find different hotels"
              className="ml-1 text-[9px] text-zinc-700 hover:text-amber-400 transition-colors"
            >↻</button>
          </div>
        )}
        {data.daily_budget_inr && (
          <div className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 text-[11px] font-mono text-zinc-400">
            ₹{data.daily_budget_inr.toLocaleString("en-IN")}<span className="text-zinc-700">/day</span>
          </div>
        )}
      </div>
      {(data.itinerary ?? []).map((day, i) => (
        <DayCard key={day.day} day={day} dayIdx={i} onEdit={(field, value) => onEdit(i, field, value)} />
      ))}
      {(data.travel_tips ?? []).length > 0 && (
        <div className="rounded-xl border border-zinc-800/40 bg-zinc-900/20 p-4 mt-2">
          <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider mb-2">Travel Tips</div>
          <ul className="space-y-1.5">
            {data.travel_tips!.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-zinc-500 leading-relaxed">
                <span className="text-zinc-700 shrink-0 mt-0.5">•</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Auth prompt component ────────────────────────────────────────────────────

function AuthPrompt({
  onAuth,
}: {
  onAuth: (user: AuthUser, token: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    if (!email.trim()) return;
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${API}/api/auth/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), display_name: name.trim() || "Traveller" }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? "Failed");
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error sending link");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-[10px] font-mono text-emerald-400 px-3 py-1.5 border border-emerald-800/40 rounded-lg bg-emerald-950/20">
        ✓ Check your email (or server logs in dev)
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Your name"
        className="w-28 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-zinc-600"
      />
      <input
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === "Enter" && send()}
        placeholder="email@example.com"
        type="email"
        className="w-40 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-zinc-600"
      />
      <button
        onClick={send}
        disabled={loading || !email.trim()}
        className="px-3 py-1 text-[10px] font-mono bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded transition-colors disabled:opacity-40"
      >
        {loading ? "…" : "Sign in →"}
      </button>
      {err && <span className="text-[9px] text-red-400 font-mono">{err}</span>}
    </div>
  );
}

// ─── Member presence bar ──────────────────────────────────────────────────────

function MemberBar({
  sessionId,
  currentUser,
}: {
  sessionId: string;
  currentUser: AuthUser | null;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`${API}/api/trips/${sessionId}/members`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setMembers(data); })
      .catch(() => {});
  }, [sessionId]);

  const copyInvite = async () => {
    try {
      const res = await fetch(`${API}/api/trips/${sessionId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesting_user_id: currentUser?.id }),
      });
      const data = await res.json();
      await navigator.clipboard.writeText(data.invite_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* ignore */
    }
  };

  if (members.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {members.slice(0, 5).map(m => (
        <div
          key={m.user_id}
          title={`${m.display_name} (${m.role})`}
          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-zinc-900 shrink-0 ring-2 ring-zinc-900"
          style={{ background: m.avatar_color }}
        >
          {m.display_name[0]?.toUpperCase()}
        </div>
      ))}
      {members.length > 5 && (
        <span className="text-[9px] font-mono text-zinc-600">+{members.length - 5}</span>
      )}
      <button
        onClick={copyInvite}
        className="ml-1 text-[9px] font-mono text-zinc-700 hover:text-zinc-400 transition-colors px-1.5 py-0.5 border border-zinc-800 rounded"
        title="Copy invite link"
      >
        {copied ? "✓ copied" : "+ invite"}
      </button>
    </div>
  );
}

// ─── Expense panel ────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  food: "🍛", transport: "🚌", hotel: "🏨", activity: "🎭", other: "💸",
};

function ExpensePanel({ sessionId, currentUser }: { sessionId: string; currentUser: AuthUser | null }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [settlement, setSettlement] = useState<SettlementTx[]>([]);
  const [view, setView] = useState<"list" | "balances" | "settle">("list");
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);

  // Add-expense form state
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("other");
  const [paidById, setPaidById] = useState(currentUser?.id ?? "");
  const [paidByName, setPaidByName] = useState(currentUser?.displayName ?? "");

  const fetchAll = async () => {
    try {
      const [eRes, bRes, sRes] = await Promise.all([
        fetch(`${API}/api/trips/${sessionId}/expenses`),
        fetch(`${API}/api/trips/${sessionId}/expenses/balances`),
        fetch(`${API}/api/trips/${sessionId}/expenses/settlement`),
      ]);
      if (eRes.ok) setExpenses(await eRes.json());
      if (bRes.ok) setBalances(await bRes.json());
      if (sRes.ok) setSettlement(await sRes.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchAll(); }, [sessionId]);

  const addExpense = async () => {
    if (!desc.trim() || !amount || !paidById) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/trips/${sessionId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_by_user_id: paidById,
          description: desc.trim(),
          amount: parseFloat(amount),
          category,
          split_equal: true,
        }),
      });
      if (res.ok) {
        setDesc(""); setAmount(""); setShowAdd(false);
        await fetchAll();
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const deleteExpense = async (id: string) => {
    await fetch(`${API}/api/trips/${sessionId}/expenses/${id}`, { method: "DELETE" });
    await fetchAll();
  };

  const markSettled = async (tx: SettlementTx) => {
    await fetch(`${API}/api/trips/${sessionId}/expenses/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_user_id: tx.from, to_user_id: tx.to, amount: tx.amount }),
    });
    await fetchAll();
  };

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav */}
      <div className="flex items-center gap-0.5 px-4 py-2 border-b border-zinc-800/30 shrink-0">
        {(["list", "balances", "settle"] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-2 py-0.5 text-[9px] font-mono rounded transition-colors ${
              view === v ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            {v === "list" ? "expenses" : v === "balances" ? "balances" : "settle"}
          </button>
        ))}
        <span className="ml-auto text-[9px] font-mono text-zinc-700">
          {total > 0 && `₹${total.toLocaleString("en-IN")}`}
        </span>
        <button
          onClick={() => setShowAdd(p => !p)}
          className="ml-2 text-[9px] font-mono text-zinc-600 hover:text-amber-400 transition-colors"
        >
          {showAdd ? "✕" : "+ add"}
        </button>
      </div>

      {/* Add expense form */}
      {showAdd && (
        <div className="px-4 py-3 border-b border-zinc-800/20 bg-zinc-900/30 shrink-0 space-y-2">
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="What was it for?"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-[10px] text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600"
          />
          <div className="flex gap-1.5">
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="₹ amount"
              type="number"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-[10px] text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600"
            />
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-400 outline-none"
            >
              {["food","transport","hotel","activity","other"].map(c => (
                <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5">
            <input
              value={paidByName}
              onChange={e => setPaidByName(e.target.value)}
              placeholder="Paid by (name)"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-[10px] text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-600"
            />
            <input
              value={paidById}
              onChange={e => setPaidById(e.target.value)}
              placeholder="user-id (UUID)"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-[9px] text-zinc-500 placeholder-zinc-700 outline-none focus:border-zinc-600 font-mono"
            />
          </div>
          <button
            onClick={addExpense}
            disabled={loading || !desc.trim() || !amount || !paidById}
            className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono rounded transition-colors disabled:opacity-40"
          >
            {loading ? "Adding…" : "Add Expense"}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: "thin" } as React.CSSProperties}>
        {view === "list" && (
          expenses.length === 0
            ? <p className="text-[9px] font-mono text-zinc-800 mt-3 px-4">No expenses yet. Add one above.</p>
            : expenses.map(exp => (
              <div key={exp.id} className="px-4 py-2 border-b border-zinc-900/60 group hover:bg-zinc-900/30 transition-colors">
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5 shrink-0">
                    {CATEGORY_ICONS[exp.category] ?? "💸"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[11px] text-zinc-200 truncate">{exp.description}</span>
                      <span className="ml-auto text-[11px] font-mono text-zinc-300 shrink-0">
                        ₹{exp.amount.toLocaleString("en-IN")}
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-zinc-600 mt-0.5">
                      paid by {exp.paid_by_name} · {exp.splits.length} split
                    </div>
                  </div>
                  <button
                    onClick={() => deleteExpense(exp.id)}
                    className="opacity-0 group-hover:opacity-100 text-[9px] text-zinc-700 hover:text-red-400 transition-all shrink-0"
                  >✕</button>
                </div>
              </div>
            ))
        )}

        {view === "balances" && (
          balances.length === 0
            ? <p className="text-[9px] font-mono text-zinc-800 mt-3 px-4">No balances yet.</p>
            : balances.map(b => (
              <div key={b.user_id} className="px-4 py-2.5 border-b border-zinc-900/60 flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-zinc-900 shrink-0"
                  style={{ background: b.avatar_color }}
                >
                  {b.display_name[0]?.toUpperCase()}
                </div>
                <span className="text-[11px] text-zinc-300 flex-1">{b.display_name}</span>
                <span className={`text-[11px] font-mono font-semibold ${
                  b.net_balance > 0 ? "text-emerald-400" : b.net_balance < 0 ? "text-red-400" : "text-zinc-600"
                }`}>
                  {b.net_balance > 0 ? "+" : ""}{b.net_balance > 0 || b.net_balance < 0
                    ? `₹${Math.abs(b.net_balance).toLocaleString("en-IN")}`
                    : "settled"}
                </span>
              </div>
            ))
        )}

        {view === "settle" && (
          settlement.length === 0
            ? <p className="text-[9px] font-mono text-zinc-800 mt-3 px-4">
                {balances.length === 0 ? "No expenses to settle." : "✓ All settled!"}
              </p>
            : settlement.map((tx, i) => (
              <div key={i} className="px-4 py-3 border-b border-zinc-900/60">
                <div className="flex items-center gap-2 mb-1.5">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-zinc-900 shrink-0"
                    style={{ background: tx.from_color }}
                  >
                    {tx.from_name[0]?.toUpperCase()}
                  </div>
                  <span className="text-[10px] text-zinc-400">{tx.from_name}</span>
                  <span className="text-[9px] font-mono text-zinc-700">→</span>
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-zinc-900 shrink-0"
                    style={{ background: tx.to_color }}
                  >
                    {tx.to_name[0]?.toUpperCase()}
                  </div>
                  <span className="text-[10px] text-zinc-400">{tx.to_name}</span>
                  <span className="ml-auto text-[11px] font-mono font-semibold text-amber-400">
                    ₹{tx.amount.toLocaleString("en-IN")}
                  </span>
                </div>
                <button
                  onClick={() => markSettled(tx)}
                  className="text-[8px] font-mono text-zinc-700 hover:text-emerald-400 transition-colors"
                >
                  ✓ Mark settled
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

// ─── Thinking stream ──────────────────────────────────────────────────────────

function ThinkingStream({ thoughts, active }: { thoughts: string[]; active: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thoughts]);

  if (!active && thoughts.length === 0) return null;

  return (
    <div className="w-full mb-5 log-row" style={{ maxWidth: TW }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        {active ? (
          <div className="flex items-end gap-[2px]" style={{ height: 12 }}>
            {[0, 0.15, 0.3].map((delay, i) => (
              <span key={i} className="w-[2px] rounded-full bg-amber-400/70 origin-bottom"
                    style={{ height: i === 1 ? 10 : 6, animation: `barPulse 0.8s ease-in-out ${delay}s infinite` }} />
            ))}
          </div>
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
        )}
        <span className="text-[10px] font-mono text-zinc-400 tracking-[0.08em]">
          Reasoning
        </span>
        {!active && (
          <span className="text-[9px] font-mono text-zinc-700">&nbsp;· complete</span>
        )}
      </div>
      {/* Stream box */}
      <div className="relative rounded-lg border border-zinc-800/50 overflow-hidden"
           style={{ height: 108, background: "rgba(15,15,17,0.9)" }}>
        <div className="absolute inset-x-0 top-0 h-8 z-10 pointer-events-none"
             style={{ background: "linear-gradient(to bottom, #0a0a0b 55%, transparent 100%)" }} />
        <div className="absolute inset-x-0 bottom-0 h-8 z-10 pointer-events-none"
             style={{ background: "linear-gradient(to top, #0a0a0b 55%, transparent 100%)" }} />
        <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-4"
             style={{ scrollbarWidth: "none" } as React.CSSProperties}>
          {thoughts.map((t, i) => {
            const isLast = i === thoughts.length - 1;
            return (
              <div key={i} className="log-row flex items-start gap-2 py-[2px]">
                <span className="mt-[5px] shrink-0 rounded-full"
                      style={{ width: 3, height: 3, background: isLast ? "#71717a" : "#27272a" }} />
                <span className="text-[10px] font-mono leading-relaxed"
                      style={{ color: isLast ? "#e4e4e7" : "#3f3f46" }}>
                  {t}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VStem({ active }: { active: boolean }) {
  return (
    <div className={`w-px h-8 mx-auto transition-colors duration-500 ${active ? "bg-zinc-600" : "bg-zinc-800"}`} />
  );
}

function ForkSVG({ active }: { active: boolean }) {
  const s = active ? "#52525b" : "#27272a";
  return (
    <svg width={TW} height={32} style={{ display: "block", overflow: "visible" }}>
      <line x1={C2} y1={0}  x2={C2} y2={16} stroke={s} strokeWidth="1" />
      <line x1={C1} y1={16} x2={C3} y2={16} stroke={s} strokeWidth="1" />
      {[C1, C2, C3].map(cx => <line key={cx} x1={cx} y1={16} x2={cx} y2={32} stroke={s} strokeWidth="1" />)}
    </svg>
  );
}

function MergeSVG({ active }: { active: boolean }) {
  const s = active ? "#52525b" : "#27272a";
  return (
    <svg width={TW} height={32} style={{ display: "block", overflow: "visible" }}>
      {[C1, C2, C3].map(cx => <line key={cx} x1={cx} y1={0}  x2={cx} y2={16} stroke={s} strokeWidth="1" />)}
      <line x1={C1} y1={16} x2={C3} y2={16} stroke={s} strokeWidth="1" />
      <line x1={C2} y1={16} x2={C2} y2={32} stroke={s} strokeWidth="1" />
    </svg>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let uid = 0;

export default function Home() {
  const [query,     setQuery]     = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [model,     setModel]     = useState<"deepseek-v4-flash" | "deepseek-v4-pro">("deepseek-v4-flash");
  const [agents,    setAgents]    = useState<Record<string, AgentNode>>(
    () => Object.fromEntries(INITIAL_AGENTS.map(a => [a.id, a]))
  );
  const [log,       setLog]       = useState<LogEntry[]>([]);
  const [taskCount, setTaskCount] = useState(0);
  const [thoughts,  setThoughts]  = useState<string[]>([]);
  const [spawned,   setSpawned]   = useState<string[]>(["planner"]);
  const [tripMeta,  setTripMeta]  = useState<{ destination?: string; days?: string; budget?: string } | null>(null);
  const [itinerary, setItinerary] = useState<ItineraryData | null>(null);

  // Auth + collaboration
  const [auth,        setAuth]       = useState<AuthUser | null>(null);
  const [showAuth,    setShowAuth]   = useState(false);
  const [activeTab,   setActiveTab]  = useState<"events" | "expenses">("events");
  const [agentInstr,  setAgentInstr] = useState<Record<string, string>>({});

  // Clarification
  const [clarifying,  setClarifying] = useState(false);       // waiting for LLM questions
  const [questions,   setQuestions]  = useState<{ id: string; question: string; placeholder: string }[]>([]);
  const [answers,     setAnswers]    = useState<Record<string, string>>({});
  const [showClarify, setShowClarify] = useState(false);      // Q&A panel open

  // Custom agents
  const [customAgents,           setCustomAgents]           = useState<CustomAgentDef[]>([]);
  const [selectedCustomAgentIds, setSelectedCustomAgentIds] = useState<string[]>([]);
  const [showCustomAgentPanel,   setShowCustomAgentPanel]   = useState(false);
  const [editingAgent,           setEditingAgent]           = useState<CustomAgentDef | null>(null);
  const [agentEditorOpen,        setAgentEditorOpen]        = useState(false);
  const [testRunResult,          setTestRunResult]          = useState<string | null>(null);
  const [testRunning,            setTestRunning]            = useState(false);
  // AI generate
  const [aiGenField,             setAiGenField]             = useState<"prompt" | "code" | null>(null);
  const [aiGenInput,             setAiGenInput]             = useState("");
  const [aiGenerating,           setAiGenerating]           = useState(false);
  // Lint
  const [lintErrors,             setLintErrors]             = useState<{line: number; col: number; message: string}[]>([]);
  const [linting,                setLinting]                = useState(false);

  const wsRef    = useRef<WebSocket | null>(null);
  const logEnd   = useRef<HTMLDivElement>(null);

  // Load auth from localStorage on mount; also handle ?auth_token= redirect from magic link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get("auth_token");
    if (magicToken) {
      fetch(`${API}/api/auth/verify?token=${magicToken}`)
        .then(r => r.json())
        .then(data => {
          if (data.jwt) {
            localStorage.setItem("tw_token", data.jwt);
            localStorage.setItem("tw_user", JSON.stringify(data.user));
            setAuth({ id: data.user.id, email: data.user.email, displayName: data.user.display_name, avatarColor: data.user.avatar_color });
            // Clean URL
            const clean = new URL(window.location.href);
            clean.searchParams.delete("auth_token");
            window.history.replaceState({}, "", clean.toString());
          }
        })
        .catch(() => {});
    } else {
      const saved = localStorage.getItem("tw_user");
      if (saved) {
        try {
          const u = JSON.parse(saved);
          setAuth({ id: u.id, email: u.email, displayName: u.display_name ?? u.displayName, avatarColor: u.avatar_color ?? u.avatarColor });
        } catch { /* invalid json */ }
      }
    }
  }, []);

  const pushLog = useCallback((agent: string, message: string, level: LogEntry["level"] = "info") =>
    setLog(p => [...p, { uid: ++uid, ts: Date.now(), agent, message, level }]), []);

  const pushThought = useCallback((text: string) =>
    setThoughts(p => [...p, text]), []);

  const patch = useCallback((id: string, diff: Partial<AgentNode>) =>
    setAgents(p => {
      const updated = { ...p[id], ...diff };
      if (diff.status === "running" && p[id]?.status !== "running") {
        updated.startedAt = Date.now();
      }
      return { ...p, [id]: updated };
    }), []);

  const reset = useCallback(() => {
    setAgents(Object.fromEntries(INITIAL_AGENTS.map(a => [a.id, a])));
    setLog([]);
    setTaskCount(0);
    setThoughts([]);
    setSpawned(["planner"]);
    setTripMeta(null);
    setItinerary(null);
  }, []);

  const handleRerun = useCallback(async (taskType: string) => {
    if (!sessionId) return;
    patch(taskType, { status: "waiting" });
    if (taskType !== "itinerary_optimization") patch("itinerary_optimization", { status: "waiting" });
    setItinerary(null);
    pushLog(AGENT_LABEL[taskType] ?? taskType, "re-queued", "warn");
    pushThought(`Re-running ${AGENT_LABEL[taskType] ?? taskType}…`);
    const instructions = agentInstr[taskType] ?? "";
    try {
      const res = await fetch(`${API}/api/trips/${sessionId}/rerun-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_type: taskType, user_instructions: instructions }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setError("Failed to re-run agent — is the API reachable?");
    }
  }, [sessionId, patch, pushLog, pushThought, agentInstr]);

  // Auto-scroll log
  useEffect(() => { logEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);

  // Phase 1: ask the LLM for clarifying questions
  const askQuestions = async () => {
    if (!query.trim()) return;
    setClarifying(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/trips/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_query: query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setQuestions(data.questions ?? []);
      setAnswers({});
      setShowClarify(true);
    } catch {
      // Clarification failed — skip straight to planning
      await startTrip({});
    } finally {
      setClarifying(false);
    }
  };

  // Phase 2: start the actual trip plan (with optional answers)
  const startTrip = async (clarificationAnswers: Record<string, string> = answers) => {
    if (!query.trim()) return;
    setShowClarify(false);
    setQuestions([]);
    setLoading(true);
    setError(null);
    setSessionId(null);
    reset();
    wsRef.current?.close();

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(`${API}/api/trips/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_query: query, model, clarification_answers: clarificationAnswers, custom_agent_ids: selectedCustomAgentIds }),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSessionId(data.session_id);
      patch("planner", { status: "running" });
      pushLog("planner", `Session ${data.session_id.slice(0, 8)}… · ${data.tasks_created} tasks queued`);
      AGENT_THOUGHTS.planner.forEach(t => pushThought(t));
      pushThought(`Waiting for planner to build the task DAG…`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Request timed out (>15s). The planner LLM may be slow — try again.");
      } else {
        setError(e instanceof Error ? e.message : "Unable to start trip planning.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Custom agent CRUD ──────────────────────────────────────────────────────

  const loadCustomAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/custom-agents`);
      if (res.ok) setCustomAgents(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadCustomAgents(); }, [loadCustomAgents]);

  const saveCustomAgent = async (draft: Omit<CustomAgentDef, "id"> & { id?: string }) => {
    const isNew = !draft.id;
    const url   = isNew ? `${API}/api/custom-agents` : `${API}/api/custom-agents/${draft.id}`;
    const res   = await fetch(url, {
      method:  isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(draft),
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    await loadCustomAgents();
    setAgentEditorOpen(false);
    setEditingAgent(null);
    setLintErrors([]);
    setAiGenField(null);
  };

  const deleteCustomAgent = async (id: string) => {
    await fetch(`${API}/api/custom-agents/${id}`, { method: "DELETE" });
    setSelectedCustomAgentIds(p => p.filter(x => x !== id));
    await loadCustomAgents();
  };

  const testRunAgent = async (id: string) => {
    setTestRunning(true);
    setTestRunResult(null);
    try {
      const res = await fetch(`${API}/api/custom-agents/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId ?? "" }),
      });
      const data = await res.json();
      setTestRunResult(data.ok ? JSON.stringify(data.result, null, 2) : `Error: ${data.error}`);
    } catch (e) {
      setTestRunResult(`Network error: ${e}`);
    } finally {
      setTestRunning(false);
    }
  };

  const generateWithAI = async () => {
    if (!editingAgent || !aiGenInput.trim() || !aiGenField) return;
    setAiGenerating(true);
    try {
      const res = await fetch(`${API}/api/custom-agents/ai-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: aiGenField,
          description: aiGenInput,
          agent_name: editingAgent.name,
          current_value: aiGenField === "prompt" ? editingAgent.system_prompt : editingAgent.code,
        }),
      });
      const data = await res.json();
      if (data.content) {
        setEditingAgent(p => p ? {
          ...p,
          [aiGenField === "prompt" ? "system_prompt" : "code"]: data.content,
        } : p);
        setAiGenField(null);
        setAiGenInput("");
        if (aiGenField === "code") setLintErrors([]);
      }
    } catch { /* non-fatal */ }
    finally { setAiGenerating(false); }
  };

  const lintCode = async (code: string) => {
    if (!code.trim()) { setLintErrors([]); return; }
    setLinting(true);
    try {
      const res = await fetch(`${API}/api/custom-agents/lint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      setLintErrors(data.errors ?? []);
    } catch { /* non-fatal */ }
    finally { setLinting(false); }
  };

  // WebSocket listener
  useEffect(() => {
    if (!sessionId) return;
    const ws = new WebSocket(`${WS}/ws/${sessionId}`);
    wsRef.current = ws;

    ws.onmessage = e => {
      const ev = JSON.parse(e.data);
      if (ev.type === "ping") return; // keepalive — ignore
      switch (ev.type) {
        case "planning_started": {
          const count = ev.task_count ?? 0;
          const types: string[] = ev.task_types ?? [];
          const dest = ev.destination ? `${ev.destination}` : "your destination";
          const days = ev.duration_days ? `${ev.duration_days} days` : "";
          const budget = ev.budget_inr ? `₹${Number(ev.budget_inr).toLocaleString("en-IN")}` : "";
          setTaskCount(count);
          setTripMeta({ destination: ev.destination, days: ev.duration_days ? `${ev.duration_days}d` : undefined, budget: ev.budget_inr ? `₹${Number(ev.budget_inr).toLocaleString("en-IN")}` : undefined });
          const nonPlanner = INITIAL_AGENTS.filter(a => a.id !== "planner");
          nonPlanner.forEach(a => patch(a.id, { status: "waiting" }));
          // Spawn custom agents dynamically
          const customAgentsMeta: { id: string; name: string }[] = ev.custom_agents ?? [];
          customAgentsMeta.forEach(ca => {
            const taskType = `custom:${ca.id}`;
            setAgents(p => ({
              ...p,
              [taskType]: { id: taskType, label: ca.name, tier: "Custom", status: "waiting" },
            }));
          });
          const customTaskTypes = customAgentsMeta.map(ca => `custom:${ca.id}`);
          setSpawned([...INITIAL_AGENTS.map(a => a.id), ...customTaskTypes]);
          const tripDesc = [dest, days, budget].filter(Boolean).join(" · ");
          pushLog("planner", `DAG built · ${count} agents spawned · ${tripDesc}`);
          pushThought(`Intent extracted — ${tripDesc}`);
          if (types.length > 0) {
            pushThought(`${count} tasks queued: ${types.map(t => t.replace(/_/g, "-")).join(" → ")}`);
          }
          AGENT_THOUGHTS.planning_started.forEach(t => pushThought(t));
          break;
        }
        case "task_started": {
          patch(ev.task_type, { status: "running" });
          const label = AGENT_LABEL[ev.task_type] ?? ev.task_type;
          pushLog(ev.task_type, "started");
          pushThought(`${label} — starting up`);
          (AGENT_THOUGHTS[ev.task_type] ?? []).forEach(t => pushThought(t));
          break;
        }
        case "task_completed": {
          patch(ev.task_type, { status: "done", resultSummary: ev.result_summary });
          pushLog(ev.task_type, ev.result_summary ? `done — ${ev.result_summary.slice(0, 80)}` : "done", "success");
          pushThought(`${AGENT_LABEL[ev.task_type] ?? ev.task_type} — done ✓`);
          if (ev.task_type === "itinerary_optimization" && ev.result_full) {
            const parsed = parseItinerary(ev.result_full);
            if (parsed) setItinerary(parsed);
          }
          break;
        }
        case "task_failed": {
          patch(ev.task_type, { status: "failed", error: ev.error });
          const label = AGENT_LABEL[ev.task_type] ?? ev.task_type;
          const isCascade = (ev.error ?? "").startsWith("dependency failed");
          pushLog(ev.task_type, isCascade ? `blocked — ${ev.error}` : `failed: ${ev.error ?? "unknown"}`, "error");
          pushThought(isCascade ? `${label} — skipped (${ev.error})` : `${label} — failed`);
          break;
        }
        case "replanning":
          pushLog("planner", `replanning: ${ev.reason ?? ""}`, "warn");
          pushThought(`Replanning — ${ev.reason ?? "re-evaluating dependencies"}`);
          break;
        case "planning_failed":
          patch("planner", { status: "failed", error: ev.error });
          setError(ev.error ?? "Planning failed — check your DeepSeek API key.");
          pushLog("planner", `planning failed: ${ev.error ?? "unknown"}`, "error");
          pushThought(`Planning failed — ${ev.error ?? "check your API key"}`);
          break;
      }
    };

    ws.onerror = () => setError("WebSocket error — is the API reachable?");
    ws.onclose = (ev) => {
      if (!ev.wasClean) {
        setError("Connection dropped. The API may have restarted — try again.");
        patch("planner", { status: "failed" });
        pushLog("planner", "WebSocket closed unexpectedly", "error");
      }
    };
    return () => { ws.close(); wsRef.current = null; };
  }, [sessionId, patch, pushLog]);

  // Auto-complete planner node when all tasks settle
  // Guard: only call patch when planner isn't already in the target status,
  // preventing the agents → patch → agents → patch infinite render loop.
  useEffect(() => {
    if (!sessionId) return;
    const tasks = INITIAL_AGENTS.filter(a => a.id !== "planner");
    const ss = tasks.map(a => agents[a.id]?.status ?? "dormant");
    const plannerStatus = agents["planner"]?.status;
    if (ss.every(s => s === "done") && plannerStatus !== "done") {
      patch("planner", { status: "done" });
    } else if (
      ss.every(s => s === "done" || s === "failed") &&
      ss.some(s => s === "failed") &&
      plannerStatus !== "failed"
    ) {
      patch("planner", { status: "failed" });
    }
  }, [agents, sessionId, patch]);

  const ag = (id: string) => agents[id] ?? INITIAL_AGENTS.find(a => a.id === id)!;

  const t2on = ["waiting","running","done","failed"].includes(ag("destination_research").status);
  const t3on = ["transport_planning","hotel_planning","food_discovery"]
    .some(id => ["waiting","running","done","failed"].includes(ag(id).status));
  const t4on = ["waiting","running","done","failed"].includes(ag("itinerary_optimization").status);
  const allDone   = ag("itinerary_optimization").status === "done";
  const allFailed  = ag("planner").status === "failed";
  const anyFailed  = spawned.some(id => ag(id).status === "failed") && !allDone;

  return (
    <>
      <style>{`
        @keyframes fadeSlide { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .log-row { animation: fadeSlide 0.18s ease-out both; }
        @keyframes spawnIn { from { opacity:0; transform:translateY(10px) scale(0.96); } to { opacity:1; transform:none; } }
        .agent-spawn { animation: spawnIn 0.35s cubic-bezier(0.16,1,0.3,1) both; }
        @keyframes barPulse { 0%,100% { transform: scaleY(0.4); opacity:0.5; } 50% { transform: scaleY(1); opacity:1; } }
      `}</style>

      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">

        {/* ── Topbar ─────────────────────────────────────────────────── */}
        <header className="h-12 px-6 flex items-center justify-between border-b border-zinc-800/50 shrink-0 gap-3">
          <div className="flex items-baseline gap-3 shrink-0">
            <span className="text-[11px] font-mono font-bold tracking-[0.2em] text-zinc-200 uppercase">TripWeave</span>
            <span className="hidden sm:block text-[10px] text-zinc-700 font-mono">multi-agent planner</span>
          </div>

          {/* Member presence (only when a trip is active) */}
          {sessionId && (
            <div className="flex-1 flex justify-center">
              <MemberBar sessionId={sessionId} currentUser={auth} />
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {/* Auth section */}
            {auth ? (
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-zinc-900 shrink-0"
                  style={{ background: auth.avatarColor }}
                  title={auth.email}
                >
                  {auth.displayName[0]?.toUpperCase()}
                </div>
                <span className="text-[10px] font-mono text-zinc-500 hidden sm:block">{auth.displayName}</span>
                <button
                  onClick={() => { localStorage.removeItem("tw_token"); localStorage.removeItem("tw_user"); setAuth(null); }}
                  className="text-[9px] font-mono text-zinc-700 hover:text-zinc-400 transition-colors"
                >out</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {showAuth
                  ? <AuthPrompt onAuth={(user, token) => {
                      localStorage.setItem("tw_token", token);
                      localStorage.setItem("tw_user", JSON.stringify({ id: user.id, email: user.email, display_name: user.displayName, avatar_color: user.avatarColor }));
                      setAuth(user);
                      setShowAuth(false);
                    }} />
                  : <button
                      onClick={() => setShowAuth(true)}
                      className="text-[10px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors px-2 py-1 border border-zinc-800 rounded"
                    >Sign in</button>
                }
              </div>
            )}

            {/* Model pill */}
            <div className="flex items-center gap-0.5 p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
              {(["deepseek-v4-flash", "deepseek-v4-pro"] as const).map(m => (
                <button key={m} onClick={() => setModel(m)}
                  className={`px-3 py-1 rounded-md text-[10px] font-mono transition-all duration-150 ${
                    model === m ? "bg-zinc-800 text-zinc-100" : "text-zinc-600 hover:text-zinc-400"
                  }`}>
                  {m === "deepseek-v4-flash" ? "⚡ flash" : "◆ pro"}
                </button>
              ))}
            </div>

            {/* Custom agents toggle */}
            <button
              onClick={() => setShowCustomAgentPanel(p => !p)}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                showCustomAgentPanel
                  ? "border-violet-600/60 text-violet-300 bg-violet-950/30"
                  : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {selectedCustomAgentIds.length > 0
                ? `⚙ Agents (${selectedCustomAgentIds.length})`
                : "⚙ Agents"}
            </button>
          </div>
        </header>

        {/* ── Query bar ──────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-zinc-800/50 shrink-0">
          <div className="max-w-2xl flex gap-2">
            <input
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-600 transition-colors"
              placeholder="Plan a 7-day Kyoto + Tokyo trip under ₹2,00,000…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !showClarify && askQuestions()}
            />
            <button
              onClick={askQuestions}
              disabled={loading || clarifying || !query.trim()}
              className="bg-zinc-100 text-zinc-900 font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-white disabled:opacity-25 disabled:cursor-not-allowed transition-all active:scale-[0.97] whitespace-nowrap shrink-0"
            >
              {clarifying ? "Thinking…" : loading ? "Spawning…" : "Plan →"}
            </button>
          </div>

          {/* Clarification Q&A panel */}
          {showClarify && questions.length > 0 && (
            <div className="max-w-2xl mt-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-[0.15em]">
                  A few quick questions to improve your plan
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {questions.map(q => (
                  <div key={q.id}>
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1">{q.question}</label>
                    <input
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-600 transition-colors"
                      placeholder={q.placeholder}
                      value={answers[q.id] ?? ""}
                      onChange={e => setAnswers(p => ({ ...p, [q.id]: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && startTrip()}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => startTrip()}
                  className="bg-zinc-100 text-zinc-900 font-semibold text-sm px-5 py-2 rounded-lg hover:bg-white transition-all active:scale-[0.97]"
                >
                  Start Planning →
                </button>
                <button
                  onClick={() => startTrip({})}
                  className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors px-3 py-2"
                >
                  Skip →
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="max-w-2xl mt-2 rounded-lg border border-red-800/40 bg-red-950/20 px-3 py-2 text-[11px] font-mono text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">

          {/* Tree panel */}
          <div className="flex-1 overflow-auto px-6 py-8 flex flex-col items-center">
            <div className="flex items-center gap-3 mb-5 self-start flex-wrap">
              <span className="text-[9px] font-mono text-zinc-700 uppercase tracking-[0.22em]">
                Agent Pipeline{taskCount > 0 && ` · ${taskCount} tasks`}
              </span>
              {tripMeta && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {tripMeta.destination && (
                    <span className="px-2 py-0.5 rounded-md border border-zinc-800 bg-zinc-900 text-[9px] font-mono text-zinc-400">
                      {tripMeta.destination}
                    </span>
                  )}
                  {tripMeta.days && (
                    <span className="px-2 py-0.5 rounded-md border border-zinc-800 bg-zinc-900 text-[9px] font-mono text-zinc-500">
                      {tripMeta.days}
                    </span>
                  )}
                  {tripMeta.budget && (
                    <span className="px-2 py-0.5 rounded-md border border-zinc-800 bg-zinc-900 text-[9px] font-mono text-zinc-500">
                      {tripMeta.budget}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Thinking stream */}
            <ThinkingStream
              thoughts={thoughts}
              active={!!sessionId && ag("itinerary_optimization").status !== "done" && ag("planner").status !== "failed"}
            />

            {/* Tier 0 – Orchestrator */}
            <div className="agent-spawn"><AgentCard node={ag("planner")} wide /></div>

            {spawned.includes("destination_research") && (
              <>
                <VStem active={t2on} />
                {/* Tier 1 – Destination Research */}
                <div style={{ width: TW }} className="flex justify-center">
                  <div className="agent-spawn"><AgentCard node={ag("destination_research")} onRerun={() => handleRerun("destination_research")} instructions={agentInstr["destination_research"]} onInstructionsChange={v => setAgentInstr(p => ({ ...p, destination_research: v }))} /></div>
                </div>
              </>
            )}

            {["transport_planning","hotel_planning","food_discovery"].some(id => spawned.includes(id)) && (
              <>
                <ForkSVG active={t3on} />
                {/* Tier 2 – Parallel agents */}
                <div className="flex gap-3" style={{ width: TW }}>
                  {["transport_planning", "hotel_planning", "food_discovery"].map(id =>
                    spawned.includes(id)
                      ? <div key={id} className="agent-spawn"><AgentCard node={ag(id)} onRerun={() => handleRerun(id)} instructions={agentInstr[id]} onInstructionsChange={v => setAgentInstr(p => ({ ...p, [id]: v }))} /></div>
                      : <div key={id} className="w-40" />
                  )}
                </div>
              </>
            )}

            {spawned.includes("itinerary_optimization") && (
              <>
                <MergeSVG active={t4on} />
                {/* Tier 3 – Synthesis */}
                <div style={{ width: TW }} className="flex justify-center">
                  <div className="agent-spawn"><AgentCard node={ag("itinerary_optimization")} onRerun={() => handleRerun("itinerary_optimization")} instructions={agentInstr["itinerary_optimization"]} onInstructionsChange={v => setAgentInstr(p => ({ ...p, itinerary_optimization: v }))} /></div>
                </div>
              </>
            )}

            {spawned.includes("budget_optimizer") && (
              <>
                <VStem active={ag("budget_optimizer").status === "running" || ag("budget_optimizer").status === "done"} />
                {/* Tier 4 – Finance */}
                <div style={{ width: TW }} className="flex justify-center">
                  <div className="agent-spawn"><AgentCard node={ag("budget_optimizer")} onRerun={() => handleRerun("budget_optimizer")} instructions={agentInstr["budget_optimizer"]} onInstructionsChange={v => setAgentInstr(p => ({ ...p, budget_optimizer: v }))} /></div>
                </div>
              </>
            )}

            {/* Tier 5+ – Custom agents (dynamic) */}
            {spawned
              .filter(id => id.startsWith("custom:"))
              .map(id => (
                <React.Fragment key={id}>
                  <VStem active={ag(id).status === "running" || ag(id).status === "done"} />
                  <div style={{ width: TW }} className="flex justify-center">
                    <div className="agent-spawn">
                      <AgentCard
                        node={ag(id)}
                        onRerun={() => handleRerun(id)}
                        instructions={agentInstr[id]}
                        onInstructionsChange={v => setAgentInstr(p => ({ ...p, [id]: v }))}
                      />
                    </div>
                  </div>
                </React.Fragment>
              ))
            }

            {/* Done banner */}
            {allDone && (
              <div className="mt-8 px-6 py-3 rounded-xl border border-emerald-600/30 bg-emerald-950/20 text-xs text-emerald-300 font-mono text-center">
                Trip plan ready · Itinerary below ↓
              </div>
            )}

            {/* Failed banner */}
            {anyFailed && !allDone && (
              <div className="mt-8 px-5 py-3 rounded-xl border border-red-800/40 bg-red-950/15 text-[11px] text-red-300 font-mono">
                <div className="font-semibold mb-0.5">Pipeline stopped</div>
                <div className="text-red-400/60 text-[10px]">
                  {spawned.filter(id => ag(id).status === "failed").map(id => AGENT_LABEL[id] ?? id).join(", ")} failed
                  {spawned.filter(id => ag(id).status === "failed").some(id => !INITIAL_AGENTS.find(a => a.id === id)?.tier?.includes("Orchestrator")) && " — check your API keys and query"}
                </div>
              </div>
            )}

            {sessionId && (
              <div className="mt-6 text-[9px] font-mono text-zinc-800 tracking-wider">
                {sessionId}
              </div>
            )}

            {/* Itinerary panel */}
            {itinerary && (
              <ItineraryPanel
                data={itinerary}
                onEdit={(dayIdx, field, value) =>
                  setItinerary(prev => {
                    if (!prev) return prev;
                    const updated = [...prev.itinerary];
                    updated[dayIdx] = { ...updated[dayIdx], [field]: value };
                    return { ...prev, itinerary: updated };
                  })
                }
                onRerunAgent={handleRerun}
              />
            )}
          </div>

          {/* Log / Expense panel */}
          <div className="lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-zinc-800/50 flex flex-col" style={{ minHeight: 200 }}>
            {/* Tab header */}
            <div className="px-4 py-2.5 border-b border-zinc-800/30 flex items-center gap-1 shrink-0">
              <button
                onClick={() => setActiveTab("events")}
                className={`px-2 py-0.5 text-[9px] font-mono rounded transition-colors ${
                  activeTab === "events" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                Events {log.length > 0 && <span className="text-zinc-700">{log.length}</span>}
              </button>
              {sessionId && (
                <button
                  onClick={() => setActiveTab("expenses")}
                  className={`px-2 py-0.5 text-[9px] font-mono rounded transition-colors ${
                    activeTab === "expenses" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  Expenses
                </button>
              )}
              {activeTab === "events" && log.length > 0 && (
                <button onClick={() => setLog([])}
                  className="ml-auto text-[9px] font-mono text-zinc-700 hover:text-zinc-400 transition-colors">
                  clear
                </button>
              )}
            </div>

            {/* Events tab */}
            {activeTab === "events" && (
              <div className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: "thin" } as React.CSSProperties}>
                {log.length === 0
                  ? <p className="text-[9px] font-mono text-zinc-800 mt-3 px-4">No events yet.</p>
                  : log.map(entry => (
                    <div key={entry.uid}
                         className={`log-row px-4 py-1.5 border-b border-zinc-900/60 ${
                           entry.level === "error" ? "bg-red-950/10" :
                           entry.level === "success" ? "bg-emerald-950/10" : ""
                         }`}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`w-1 h-1 rounded-full shrink-0 ${
                          entry.level === "error" ? "bg-red-500" :
                          entry.level === "success" ? "bg-emerald-500" :
                          entry.level === "warn" ? "bg-amber-400" : "bg-zinc-600"
                        }`} />
                        <span className={`text-[9px] font-mono font-medium ${
                          entry.level === "error" ? "text-red-400" :
                          entry.level === "success" ? "text-emerald-400" :
                          entry.level === "warn" ? "text-amber-400" : "text-zinc-500"
                        }`}>
                          {(AGENT_LABEL[entry.agent] ?? entry.agent).toUpperCase()}
                        </span>
                        <span className="ml-auto text-[9px] font-mono text-zinc-800">
                          {new Date(entry.ts).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                      <div className={`text-[10px] font-mono leading-relaxed pl-2.5 ${
                        entry.level === "error" ? "text-red-300/70" :
                        entry.level === "success" ? "text-emerald-300/70" :
                        entry.level === "warn" ? "text-amber-300/70" : "text-zinc-500"
                      }`}>
                        {entry.message}
                      </div>
                    </div>
                  ))
                }
                <div ref={logEnd} />
              </div>
            )}

            {/* Expenses tab */}
            {activeTab === "expenses" && sessionId && (
              <ExpensePanel sessionId={sessionId} currentUser={auth} />
            )}
          </div>

        </div>

        {/* ── Custom Agent Panel ─────────────────────────────────── */}
        {showCustomAgentPanel && (
          <div className="fixed inset-y-0 right-0 w-[580px] bg-zinc-950 border-l border-zinc-800 flex flex-col z-50 shadow-2xl">

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 shrink-0">
              <div>
                <div className="text-xs font-mono text-zinc-200 font-semibold">Custom Agents</div>
                <div className="text-[10px] font-mono text-zinc-600 mt-0.5">Python sandbox + AI prompts · runs after built-in pipeline</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingAgent({ id: "", name: "", description: "", system_prompt: "", code: "", api_keys: {} });
                    setAgentEditorOpen(true);
                    setTestRunResult(null);
                    setLintErrors([]);
                    setAiGenField(null);
                  }}
                  className="text-[10px] font-mono px-2.5 py-1 rounded border border-violet-700/50 text-violet-300 hover:bg-violet-950/40 transition-colors"
                >+ New</button>
                <button onClick={() => setShowCustomAgentPanel(false)} className="text-zinc-600 hover:text-zinc-300 text-base px-1">✕</button>
              </div>
            </div>

            {/* ── Agent list (visible when editor is closed) ── */}
            {!agentEditorOpen && (
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {customAgents.length === 0 && (
                  <div className="text-[11px] font-mono text-zinc-700 text-center mt-10">
                    No custom agents yet.<br />Click &ldquo;+ New&rdquo; to create one.
                  </div>
                )}
                {customAgents.map(ca => {
                  const selected = selectedCustomAgentIds.includes(ca.id);
                  return (
                    <div key={ca.id} className={`rounded-lg border px-3 py-2.5 transition-colors ${selected ? "border-violet-600/50 bg-violet-950/20" : "border-zinc-800 bg-zinc-900/40"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-mono text-zinc-200 font-medium truncate">{ca.name}</div>
                          {ca.description && <div className="text-[10px] font-mono text-zinc-600 truncate mt-0.5">{ca.description}</div>}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {ca.system_prompt && <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-950/50 border border-blue-800/40 text-blue-400">prompt</span>}
                            {ca.code && <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-950/50 border border-amber-800/40 text-amber-400">code</span>}
                            {Object.keys(ca.api_keys ?? {}).length > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-950/50 border border-emerald-800/40 text-emerald-400">
                                {Object.keys(ca.api_keys).length} key{Object.keys(ca.api_keys).length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => setSelectedCustomAgentIds(p => selected ? p.filter(x => x !== ca.id) : [...p, ca.id])}
                            className={`text-[9px] font-mono px-2 py-0.5 rounded border transition-colors ${selected ? "border-violet-600/60 text-violet-300 bg-violet-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}
                          >{selected ? "✓ included" : "include"}</button>
                          <button
                            onClick={() => {
                              setEditingAgent({ ...ca, api_keys: ca.api_keys ?? {} });
                              setAgentEditorOpen(true);
                              setTestRunResult(null);
                              setLintErrors([]);
                              setAiGenField(null);
                            }}
                            className="text-[9px] font-mono text-zinc-600 hover:text-zinc-300 px-1.5 py-0.5 border border-zinc-800 rounded"
                          >edit</button>
                          <button
                            onClick={() => deleteCustomAgent(ca.id)}
                            className="text-[9px] font-mono text-red-800 hover:text-red-400 px-1.5 py-0.5 border border-zinc-800 rounded"
                          >del</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Full editor (replaces list when open) ── */}
            {agentEditorOpen && editingAgent !== null && (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

                {/* Editor title */}
                <div className="text-[10px] font-mono text-zinc-400 font-semibold border-b border-zinc-800/60 pb-2">
                  {editingAgent.id ? `Editing: ${editingAgent.name || "Unnamed"}` : "New custom agent"}
                </div>

                {/* Name + Description */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest block mb-1">Name *</label>
                    <input
                      value={editingAgent.name}
                      onChange={e => setEditingAgent(p => p ? { ...p, name: e.target.value } : p)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200 outline-none focus:border-zinc-600"
                      placeholder="e.g. Weather Advisor"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest block mb-1">Description</label>
                    <input
                      value={editingAgent.description}
                      onChange={e => setEditingAgent(p => p ? { ...p, description: e.target.value } : p)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200 outline-none focus:border-zinc-600"
                      placeholder="What it does"
                    />
                  </div>
                </div>

                {/* ── API Keys ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">API Keys <span className="normal-case text-zinc-700">— available as <code className="text-emerald-500">secrets</code> in code</span></label>
                    <button
                      onClick={() => setEditingAgent(p => p ? { ...p, api_keys: { ...p.api_keys, "": "" } } : p)}
                      className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded px-1.5 py-0.5 transition-colors"
                    >+ Add key</button>
                  </div>
                  {Object.keys(editingAgent.api_keys).length === 0 ? (
                    <div className="text-[10px] font-mono text-zinc-700 italic">No keys — add one to call external APIs from your code</div>
                  ) : (
                    <div className="space-y-1.5">
                      {Object.entries(editingAgent.api_keys).map(([k, v], idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <input
                            value={k}
                            onChange={e => {
                              const newK = e.target.value;
                              setEditingAgent(p => {
                                if (!p) return p;
                                const entries = Object.entries(p.api_keys);
                                entries[idx] = [newK, v];
                                return { ...p, api_keys: Object.fromEntries(entries) };
                              });
                            }}
                            placeholder="KEY_NAME"
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-emerald-400 outline-none focus:border-zinc-600 uppercase placeholder:normal-case placeholder:text-zinc-700"
                          />
                          <input
                            value={v}
                            onChange={e => {
                              const newV = e.target.value;
                              setEditingAgent(p => {
                                if (!p) return p;
                                const entries = Object.entries(p.api_keys);
                                entries[idx] = [k, newV];
                                return { ...p, api_keys: Object.fromEntries(entries) };
                              });
                            }}
                            placeholder="sk-…"
                            type="password"
                            className="flex-[2] bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-400 outline-none focus:border-zinc-600"
                          />
                          <button
                            onClick={() => setEditingAgent(p => {
                              if (!p) return p;
                              const entries = Object.entries(p.api_keys).filter((_, i) => i !== idx);
                              return { ...p, api_keys: Object.fromEntries(entries) };
                            })}
                            className="text-[10px] text-red-800 hover:text-red-400 px-1"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── System Prompt ── */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">System Prompt</label>
                    <button
                      onClick={() => { setAiGenField("prompt"); setAiGenInput(""); }}
                      className="text-[9px] font-mono px-2 py-0.5 rounded border border-violet-800/50 text-violet-400 hover:bg-violet-950/30 transition-colors"
                    >✨ Write with AI</button>
                  </div>

                  {/* AI generate for prompt */}
                  {aiGenField === "prompt" && (
                    <div className="mb-2 flex gap-2 items-center">
                      <input
                        autoFocus
                        value={aiGenInput}
                        onChange={e => setAiGenInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generateWithAI(); } if (e.key === "Escape") setAiGenField(null); }}
                        placeholder="Describe what this agent should do…"
                        className="flex-1 bg-zinc-900 border border-violet-800/40 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200 outline-none focus:border-violet-600 placeholder:text-zinc-700"
                      />
                      <button
                        onClick={generateWithAI}
                        disabled={aiGenerating || !aiGenInput.trim()}
                        className="text-[9px] font-mono px-2.5 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 transition-colors whitespace-nowrap"
                      >{aiGenerating ? "Generating…" : "Generate"}</button>
                      <button onClick={() => setAiGenField(null)} className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 px-1.5">✕</button>
                    </div>
                  )}

                  <textarea
                    value={editingAgent.system_prompt}
                    onChange={e => setEditingAgent(p => p ? { ...p, system_prompt: e.target.value } : p)}
                    rows={5}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-[11px] font-mono text-zinc-300 outline-none focus:border-zinc-600 resize-y leading-relaxed"
                    placeholder={"You are a travel safety advisor. Analyse the trip context and return a JSON object with:\n- safety_score (1-10)\n- warnings: list of safety tips\n- emergency_contacts: list for the destination"}
                  />
                </div>

                {/* ── Python Code ── */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <label className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
                        Python Code
                      </label>
                      <span className="ml-2 text-[9px] font-mono text-zinc-700">
                        must assign <code className="text-amber-500">result = {"{"}</code>…<code className="text-amber-500">{"}"}</code>
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => lintCode(editingAgent.code)}
                        disabled={linting || !editingAgent.code.trim()}
                        className={`text-[9px] font-mono px-2 py-0.5 rounded border transition-colors disabled:opacity-40 ${lintErrors.length > 0 ? "border-red-800/60 text-red-400" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}
                      >{linting ? "Linting…" : lintErrors.length > 0 ? `${lintErrors.length} error` : "⚡ Lint"}</button>
                      <button
                        onClick={() => { setAiGenField("code"); setAiGenInput(""); }}
                        className="text-[9px] font-mono px-2 py-0.5 rounded border border-violet-800/50 text-violet-400 hover:bg-violet-950/30 transition-colors"
                      >✨ Write with AI</button>
                    </div>
                  </div>

                  {/* AI generate for code */}
                  {aiGenField === "code" && (
                    <div className="mb-2 flex gap-2 items-center">
                      <input
                        autoFocus
                        value={aiGenInput}
                        onChange={e => setAiGenInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generateWithAI(); } if (e.key === "Escape") setAiGenField(null); }}
                        placeholder="Describe what the code should do… (use context, secrets, http_get)"
                        className="flex-1 bg-zinc-900 border border-violet-800/40 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200 outline-none focus:border-violet-600 placeholder:text-zinc-700"
                      />
                      <button
                        onClick={generateWithAI}
                        disabled={aiGenerating || !aiGenInput.trim()}
                        className="text-[9px] font-mono px-2.5 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 transition-colors whitespace-nowrap"
                      >{aiGenerating ? "Generating…" : "Generate"}</button>
                      <button onClick={() => setAiGenField(null)} className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 px-1.5">✕</button>
                    </div>
                  )}

                  {/* Syntax-highlighted code editor */}
                  <CodeEditor
                    value={editingAgent.code}
                    onChange={v => { setEditingAgent(p => p ? { ...p, code: v } : p); if (lintErrors.length > 0) setLintErrors([]); }}
                    rows={9}
                    placeholder={"# Available globals:\n#   context  — trip data dict\n#   secrets  — your API keys\n#   http_get(url, headers={}) → dict\n#   http_post(url, data={}, headers={}) → dict\n#   json\n\ndestination = context.get('destination', 'unknown')\nresult = {\n    'note': f'Custom analysis for {destination}',\n}"}
                  />

                  {/* Lint errors */}
                  {lintErrors.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {lintErrors.map((e, i) => (
                        <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 rounded bg-red-950/30 border border-red-800/40">
                          <span className="text-red-500 text-[9px] font-mono shrink-0">Line {e.line}:{e.col}</span>
                          <span className="text-[10px] font-mono text-red-300">{e.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Context reference card */}
                  <div className="mt-2 rounded border border-zinc-800/60 bg-zinc-900/30 px-3 py-2">
                    <div className="text-[9px] font-mono text-zinc-700 uppercase tracking-widest mb-1.5">Available in code</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px] font-mono">
                      {[
                        ["context", "destination, budget_inr, itinerary, transport, hotels, food"],
                        ["secrets", "your API key values by name"],
                        ["http_get(url)", "→ dict (GET request)"],
                        ["http_post(url, data)", "→ dict (POST request)"],
                        ["result = {...}", "← required: assign your output"],
                      ].map(([k, v]) => (
                        <React.Fragment key={k}>
                          <span className="text-amber-500/80">{k}</span>
                          <span className="text-zinc-600">{v}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Test run output */}
                {testRunResult !== null && (
                  <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 max-h-40 overflow-y-auto">
                    <div className="text-[9px] font-mono text-zinc-600 mb-1 uppercase tracking-widest">Test output</div>
                    <pre className="text-[10px] font-mono text-zinc-300 whitespace-pre-wrap break-all">{testRunResult}</pre>
                  </div>
                )}

                {/* Action bar */}
                <div className="flex gap-2 pt-1 pb-2 sticky bottom-0 bg-zinc-950 border-t border-zinc-800/60 mt-2 py-3">
                  <button
                    onClick={() => saveCustomAgent(editingAgent)}
                    disabled={!editingAgent.name.trim()}
                    className="flex-1 text-[10px] font-mono py-2 rounded bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 transition-colors font-semibold"
                  >Save Agent</button>
                  {editingAgent.id && (
                    <button
                      onClick={() => testRunAgent(editingAgent.id)}
                      disabled={testRunning}
                      className="text-[10px] font-mono px-3 py-2 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors"
                    >{testRunning ? "Running…" : "▶ Test"}</button>
                  )}
                  <button
                    onClick={() => { setAgentEditorOpen(false); setEditingAgent(null); setTestRunResult(null); setLintErrors([]); setAiGenField(null); }}
                    className="text-[10px] font-mono px-3 py-2 rounded border border-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors"
                  >Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
