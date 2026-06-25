import { useState, useEffect, useCallback } from "react";

interface JobRow {
  id: string;
  status: string;
  name_input: string;
  city_input: string;
  district: string;
  player_number: number | null;
  public_id: string | null;
  buyer_email: string | null;
  created_at: string;
  has_token: number;
  video_b64: string | null;
  video_attempts: number;
  video_error: string | null;
  card_video_b64: string | null;
  card_video_attempts: number;
  card_video_error: string | null;
}

interface SyncResult {
  ok: boolean;
  total_sales: number;
  rescued: number;
  rescued_details: { email: string; job_id: string; public_id: string; card_url: string }[];
  skipped: { email?: string; reason: string; job_id?: string; public_id?: string }[];
  error?: string;
}

const STATUS_COLOR: Record<string, string> = {
  DONE: "#00ff7f",
  PREVIEW_READY: "#ffc94a",
  RENDERING: "#00e8ff",
  CREATED: "rgba(255,255,255,0.3)",
  FAILED: "#ff4444",
};

export default function AdminPaidUsers() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem("admin_secret") || "");
  const [authed, setAuthed] = useState(false);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gumroadToken, setGumroadToken] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [filter, setFilter] = useState<"all" | "paid" | "stuck">("all");

  const fetchJobs = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/jobs", { headers: { "x-admin-secret": s } });
      if (res.status === 403) { setError("Wrong password."); setAuthed(false); return; }
      if (!res.ok) { setError("Server error."); return; }
      const data = await res.json();
      setJobs(data);
      setAuthed(true);
      sessionStorage.setItem("admin_secret", s);
    } catch {
      setError("Could not reach server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (secret) fetchJobs(secret);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchJobs(secret);
  };

  const handleSync = async () => {
    if (!gumroadToken.trim()) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/gumroad-sync", {
        method: "POST",
        headers: { "x-admin-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: gumroadToken }),
      });
      const data = await res.json();
      setSyncResult(data);
      if (data.rescued > 0) fetchJobs(secret);
    } catch {
      setSyncResult({ ok: false, error: "Request failed", total_sales: 0, rescued: 0, rescued_details: [], skipped: [] });
    } finally {
      setSyncing(false);
    }
  };

  const filtered = jobs.filter(j => {
    if (filter === "paid") return j.status === "DONE";
    if (filter === "stuck") return j.status === "PREVIEW_READY" && j.has_token;
    return true;
  });

  const paidCount = jobs.filter(j => j.status === "DONE").length;
  const stuckCount = jobs.filter(j => j.status === "PREVIEW_READY" && j.has_token).length;

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#08091a" }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <p className="font-mono text-[9px] tracking-[0.4em] text-white/25 uppercase mb-2">Solara City</p>
            <h1 className="text-xl font-black text-white/85 tracking-tight">Admin Access</h1>
            <p className="font-mono text-[10px] text-white/30 mt-1">Paid users registry</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="font-mono text-[9px] tracking-widest text-white/30 uppercase block mb-2">
                Admin Password
              </label>
              <input
                type="password"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                placeholder="Enter ADMIN_SECRET"
                className="w-full px-4 py-3 rounded-xl font-mono text-sm outline-none transition-colors"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.7)",
                }}
                autoFocus
              />
            </div>

            {error && (
              <p className="font-mono text-[10px] text-[#ff4444] tracking-widest">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !secret}
              className="w-full py-3 rounded-xl font-mono text-[11px] tracking-[0.25em] uppercase font-bold transition-all disabled:opacity-40"
              style={{
                background: "linear-gradient(180deg, #1a0c14 0%, #110710 100%)",
                border: "1px solid rgba(255,32,96,0.35)",
                color: "#ff2060",
              }}
            >
              {loading ? "Checking…" : "Enter →"}
            </button>
          </form>

          <p className="font-mono text-[9px] text-white/15 text-center mt-6 tracking-widest">
            Set ADMIN_SECRET in Railway to use this page
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: "#08091a" }}>
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <p className="font-mono text-[9px] tracking-[0.4em] text-white/25 uppercase mb-1">Solara City Bureau</p>
            <h1 className="text-xl font-black text-white/85">Paid Users Registry</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="font-mono text-[9px] text-white/25 uppercase tracking-widest">Paid</p>
              <p className="font-mono text-lg font-bold" style={{ color: "#00ff7f" }}>{paidCount}</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-[9px] text-white/25 uppercase tracking-widest">Stuck</p>
              <p className="font-mono text-lg font-bold" style={{ color: "#ffc94a" }}>{stuckCount}</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-[9px] text-white/25 uppercase tracking-widest">Total</p>
              <p className="font-mono text-lg font-bold text-white/70">{jobs.length}</p>
            </div>
          </div>
        </div>

        {/* Gumroad sync panel */}
        <div className="rounded-2xl p-5 mb-6" style={{ background: "rgba(255,196,74,0.04)", border: "1px solid rgba(255,196,74,0.15)" }}>
          <p className="font-mono text-[9px] tracking-[0.35em] uppercase mb-1" style={{ color: "rgba(255,196,74,0.6)" }}>
            Sync from Gumroad
          </p>
          <p className="font-mono text-[10px] text-white/30 mb-3">
            Rescues stuck payments. Paste your Gumroad API access token (dashboard → Settings → Advanced → Application).
          </p>
          <div className="flex gap-3 flex-wrap">
            <input
              type="password"
              value={gumroadToken}
              onChange={e => setGumroadToken(e.target.value)}
              placeholder="Gumroad access token…"
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg font-mono text-xs outline-none"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}
            />
            <button
              onClick={handleSync}
              disabled={syncing || !gumroadToken.trim()}
              className="px-5 py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase font-bold transition-all disabled:opacity-40"
              style={{ background: "rgba(255,196,74,0.1)", border: "1px solid rgba(255,196,74,0.3)", color: "#ffc94a" }}
            >
              {syncing ? "Syncing…" : "Sync Now →"}
            </button>
          </div>

          {syncResult && (
            <div className="mt-3 font-mono text-[10px] space-y-1">
              {syncResult.error ? (
                <p style={{ color: "#ff4444" }}>Error: {syncResult.error}</p>
              ) : (
                <>
                  <p style={{ color: syncResult.rescued > 0 ? "#00ff7f" : "rgba(255,255,255,0.4)" }}>
                    {syncResult.total_sales} sale{syncResult.total_sales !== 1 ? "s" : ""} found · {syncResult.rescued} rescued
                  </p>
                  {syncResult.rescued_details.map(r => (
                    <p key={r.job_id} style={{ color: "#00ff7f" }}>
                      ✓ {r.email} → <a href={r.card_url} target="_blank" rel="noopener noreferrer" style={{ color: "#00e8ff", textDecoration: "underline" }}>{r.card_url}</a>
                    </p>
                  ))}
                  {syncResult.skipped.map((s, i) => (
                    <p key={i} style={{ color: "rgba(255,255,255,0.25)" }}>
                      ↷ {s.email ?? "?"} — {s.reason}{s.public_id ? ` → /id/${s.public_id}` : ""}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
          {(["all", "paid", "stuck"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-4 py-1.5 rounded-full font-mono text-[9px] tracking-widest uppercase transition-all"
              style={{
                background: filter === f ? "rgba(255,255,255,0.07)" : "transparent",
                border: `1px solid ${filter === f ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
                color: filter === f ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)",
              }}
            >
              {f === "all" ? `All (${jobs.length})` : f === "paid" ? `Paid (${paidCount})` : `Stuck (${stuckCount})`}
            </button>
          ))}
          <button
            onClick={() => fetchJobs(secret)}
            className="ml-auto px-4 py-1.5 rounded-full font-mono text-[9px] tracking-widest uppercase transition-all"
            style={{ border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.25)" }}
          >
            Refresh
          </button>
        </div>

        {/* Jobs table */}
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-mono text-[10px] text-white/20 tracking-widest uppercase">No entries</p>
            </div>
          ) : (
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  {["#", "Name", "City", "Status", "Email", "Card", "Char Video", "Card Video", "Date"].map(h => (
                    <th key={h} className="px-4 py-3 text-left tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.25)", fontSize: "9px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((job, i) => (
                  <tr
                    key={job.id}
                    style={{
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                    }}
                  >
                    <td className="px-4 py-3" style={{ color: "#ffc94a" }}>
                      {job.player_number ? `#${job.player_number.toString().padStart(4, "0")}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-bold" style={{ color: "rgba(255,255,255,0.7)", maxWidth: "140px" }}>
                      <span className="block truncate">{job.name_input || "—"}</span>
                    </td>
                    <td className="px-4 py-3" style={{ color: "rgba(255,255,255,0.35)" }}>
                      <span className="block truncate max-w-[100px]">{job.city_input || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-[9px] tracking-widest uppercase font-bold"
                        style={{
                          background: `${STATUS_COLOR[job.status] || "rgba(255,255,255,0.1)"}18`,
                          color: STATUS_COLOR[job.status] || "rgba(255,255,255,0.3)",
                          border: `1px solid ${STATUS_COLOR[job.status] || "rgba(255,255,255,0.08)"}44`,
                        }}
                      >
                        {job.status === "PREVIEW_READY" && job.has_token ? "⚠ STUCK" : job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: "rgba(255,255,255,0.3)", maxWidth: "160px" }}>
                      <span className="block truncate">{job.buyer_email || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      {job.public_id ? (
                        <a
                          href={`/id/${job.public_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                          style={{ color: "#00e8ff" }}
                        >
                          View →
                        </a>
                      ) : (
                        <span style={{ color: "rgba(255,255,255,0.15)" }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {job.video_b64 === "DONE" && job.public_id ? (
                          <a
                            href={`/api/public/${job.public_id}/video.mp4?admin=${encodeURIComponent(secret)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                            style={{ color: "#00ff7f" }}
                          >
                            ⬇ MP4
                          </a>
                        ) : job.video_b64 === "ERROR" ? (
                          <span
                            className="px-2 py-0.5 rounded text-[9px] tracking-widest uppercase font-bold cursor-help"
                            title={job.video_error ?? "unknown error"}
                            style={{ background: "rgba(255,68,68,0.12)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.3)" }}
                          >
                            FAILED ⓘ
                          </span>
                        ) : (
                          <span style={{ color: "rgba(255,255,255,0.15)" }}>—</span>
                        )}
                        {job.video_attempts > 0 && (
                          <span className="font-mono text-[9px]" style={{ color: job.video_attempts >= 3 ? "#ff4444" : "rgba(255,255,255,0.25)" }}>
                            {job.video_attempts}/3 attempts
                            {job.video_attempts >= 3 && job.public_id && (
                              <button
                                onClick={async () => {
                                  await fetch(`/api/admin/video-unlock/${job.public_id}`, { method: "POST", headers: { "x-admin-secret": secret } });
                                  fetchJobs(secret);
                                }}
                                className="ml-2 underline"
                                style={{ color: "#ffc94a" }}
                              >
                                unlock
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {job.card_video_b64 === "DONE" && job.public_id ? (
                          <a
                            href={`/api/public/${job.public_id}/card-video.mp4?admin=${encodeURIComponent(secret)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                            style={{ color: "#b478ff" }}
                          >
                            ⬇ MP4
                          </a>
                        ) : job.card_video_b64 === "ERROR" ? (
                          <span
                            className="px-2 py-0.5 rounded text-[9px] tracking-widest uppercase font-bold cursor-help"
                            title={job.card_video_error ?? "unknown error"}
                            style={{ background: "rgba(255,68,68,0.12)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.3)" }}
                          >
                            FAILED ⓘ
                          </span>
                        ) : (
                          <span style={{ color: "rgba(255,255,255,0.15)" }}>—</span>
                        )}
                        {job.card_video_attempts > 0 && (
                          <span className="font-mono text-[9px]" style={{ color: job.card_video_attempts >= 3 ? "#ff4444" : "rgba(255,255,255,0.25)" }}>
                            {job.card_video_attempts}/3 attempts
                            {job.card_video_attempts >= 3 && job.public_id && (
                              <button
                                onClick={async () => {
                                  await fetch(`/api/admin/card-video-unlock/${job.public_id}`, { method: "POST", headers: { "x-admin-secret": secret } });
                                  fetchJobs(secret);
                                }}
                                className="ml-2 underline"
                                style={{ color: "#ffc94a" }}
                              >
                                unlock
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: "rgba(255,255,255,0.2)" }}>
                      {job.created_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Logout */}
        <div className="mt-6 text-center">
          <button
            onClick={() => { sessionStorage.removeItem("admin_secret"); setAuthed(false); setJobs([]); setSecret(""); }}
            className="font-mono text-[9px] tracking-widest text-white/15 hover:text-white/30 uppercase transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
