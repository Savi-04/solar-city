import { useState } from "react";
import { Link } from "react-router-dom";

interface Lead {
  page: string;
  country: string;
  country_code: string;
  city: string;
  device: string;
  referrer: string;
  created_at: number;
}

interface Stats {
  total: number;
  byPage: { page: string; n: number }[];
  byCountry: { country: string; country_code: string; n: number }[];
  byDevice: { device: string; n: number }[];
  byReferrer: { referrer: string; n: number }[];
  byDay: { day: string; n: number }[];
  ctaClicks: { page: string; n: number }[];
  leads: Lead[];
}

const FLAGS: Record<string, string> = {
  IE:"🇮🇪",US:"🇺🇸",GB:"🇬🇧",AE:"🇦🇪",IN:"🇮🇳",AU:"🇦🇺",CA:"🇨🇦",
  DE:"🇩🇪",FR:"🇫🇷",NL:"🇳🇱",SG:"🇸🇬",JP:"🇯🇵",BR:"🇧🇷",MX:"🇲🇽",
  ZA:"🇿🇦",PK:"🇵🇰",NG:"🇳🇬",PH:"🇵🇭",IT:"🇮🇹",ES:"🇪🇸",PT:"🇵🇹",
  KR:"🇰🇷",CN:"🇨🇳",RU:"🇷🇺",SA:"🇸🇦",EG:"🇪🇬",TR:"🇹🇷",AR:"🇦🇷",
};

const CTA_LABELS: Record<string, string> = {
  "cta:make-your-card":    "Make Your Card (Hero)",
  "cta:claim-player-card": "Claim My Player Card (Pricing)",
  "cta:claim-resident-id": "Claim Resident ID (Payment)",
};

function parseSource(referrer: string): string {
  if (!referrer || referrer === "direct") return "Direct";
  try {
    const host = new URL(referrer).hostname.replace("www.", "").replace("l.", "");
    if (host.includes("tiktok")) return "TikTok";
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("twitter") || host.includes("x.com")) return "X / Twitter";
    if (host.includes("facebook")) return "Facebook";
    if (host.includes("youtube")) return "YouTube";
    if (host.includes("google")) return "Google";
    return host;
  } catch { return referrer.slice(0, 30); }
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60000) return "just now";
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl p-4 text-center" style={{ background: "#0a0814", border: "1px solid rgba(255,255,255,0.06)" }}>
      <p className="font-mono text-[8px] text-white/25 tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-black" style={{ color }}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-6 mb-6" style={{ background: "#0a0814", border: "1px solid rgba(255,255,255,0.06)" }}>
      <p className="font-mono text-[9px] text-white/25 tracking-widest mb-4 uppercase">{title}</p>
      {children}
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/stats", { headers: { "x-admin-secret": s } });
      if (!res.ok) throw new Error("bad");
      setStats(await res.json());
      setAuthed(true);
    } catch {
      setError("Invalid secret.");
    } finally {
      setLoading(false);
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#05050d" }}>
        <div className="w-full max-w-xs px-6">
          <p className="font-mono text-[10px] tracking-[0.35em] text-white/25 uppercase mb-6 text-center">Analytics · Solara City</p>
          <input
            type="password" placeholder="Admin secret" value={secret}
            onChange={e => setSecret(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetchStats(secret)}
            className="w-full rounded-lg px-4 py-3 font-mono text-sm text-white/80 outline-none mb-3"
            style={{ background: "#0a0814", border: "1px solid rgba(255,255,255,0.08)" }}
            autoFocus
          />
          <button onClick={() => fetchStats(secret)} disabled={loading}
            className="w-full py-3 rounded-lg font-mono text-xs tracking-widest font-bold"
            style={{ background: "#ff2060", color: "#fff", opacity: loading ? 0.6 : 1 }}>
            {loading ? "LOADING…" : "VIEW STATS"}
          </button>
          {error && <p className="font-mono text-[11px] text-red-400 mt-3 text-center">{error}</p>}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const maxDay = Math.max(...stats.byDay.map(d => d.n), 1);
  const mobileN = stats.byDevice.find(d => d.device === "mobile")?.n ?? 0;
  const mobilePercent = stats.total > 0 ? Math.round((mobileN / stats.total) * 100) : 0;
  const days = [...stats.byDay].reverse().slice(-14);
  const totalCtaClicks = stats.ctaClicks.reduce((s, c) => s + c.n, 0);

  return (
    <div className="min-h-screen" style={{ background: "#05050d", color: "#e8e0f5" }}>
      <div className="max-w-4xl mx-auto px-6 py-16">

        <Link to="/" className="inline-flex items-center space-x-1.5 font-mono text-[10px] tracking-widest text-white/30 hover:text-white/60 transition-colors mb-10 uppercase">
          <span>←</span><span>Back to Solara City</span>
        </Link>

        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-black tracking-tight" style={{ color: "#ff2060" }}>Analytics</h1>
          <div className="flex items-center space-x-4">
            <span className="font-mono text-[9px] text-white/25 tracking-widest uppercase">Last 30 days</span>
            <button onClick={() => fetchStats(secret)}
              className="font-mono text-[9px] text-white/30 hover:text-white/60 tracking-widest transition-colors">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* ── Footfall summary ─────────────────────────────────────────── */}
        <p className="font-mono text-[9px] text-white/20 tracking-widest uppercase mb-3">Footfall</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="TOTAL VISITS" value={stats.total} color="#ff2060" />
          <StatCard label="LANDING /" value={stats.byPage.find(p => p.page === "/")?.n ?? 0} color="#00e8ff" />
          <StatCard label="CREATE /create" value={stats.byPage.find(p => p.page === "/create")?.n ?? 0} color="#9b59ff" />
          <StatCard label="MOBILE" value={`${mobilePercent}%`} color="#ffc94a" />
        </div>

        {/* ── Daily chart ───────────────────────────────────────────────── */}
        <Section title="Daily Visits (last 14 days)">
          {days.length === 0 ? (
            <p className="font-mono text-[11px] text-white/20 text-center py-6">No data yet</p>
          ) : (
            <div className="flex items-end gap-1 h-28">
              {days.map(d => (
                <div key={d.day} className="flex flex-col items-center flex-1 min-w-0">
                  <span className="font-mono text-[8px] text-white/30 mb-1">{d.n}</span>
                  <div className="w-full rounded-t" style={{
                    height: `${Math.max(4, Math.round((d.n / maxDay) * 72))}px`,
                    background: "linear-gradient(180deg, #ff2060 0%, #9b59ff 100%)",
                  }} />
                  <span className="font-mono text-[7px] text-white/20 mt-1 truncate w-full text-center">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Geo + Sources ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <Section title="Top Countries">
            {stats.byCountry.length === 0 ? (
              <p className="font-mono text-[11px] text-white/20">No data yet</p>
            ) : (
              <div className="space-y-2.5">
                {stats.byCountry.slice(0, 10).map(c => (
                  <div key={c.country_code} className="flex items-center justify-between">
                    <span className="font-mono text-xs text-white/55">{FLAGS[c.country_code] ?? "🌐"} {c.country}</span>
                    <span className="font-mono text-xs font-bold" style={{ color: "#ff2060" }}>{c.n}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Traffic Sources">
            {stats.byReferrer.length === 0 ? (
              <p className="font-mono text-[11px] text-white/20">No data yet</p>
            ) : (
              <div className="space-y-2.5">
                {stats.byReferrer.slice(0, 10).map(r => (
                  <div key={r.referrer} className="flex items-center justify-between">
                    <span className="font-mono text-xs text-white/55">{parseSource(r.referrer)}</span>
                    <span className="font-mono text-xs font-bold" style={{ color: "#00e8ff" }}>{r.n}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* ── Device split ──────────────────────────────────────────────── */}
        <Section title="Device Split">
          <div className="flex items-center space-x-4">
            <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full" style={{
                width: `${mobilePercent}%`,
                background: "linear-gradient(90deg, #ff2060, #9b59ff)",
                transition: "width 0.7s ease",
              }} />
            </div>
            <span className="font-mono text-[11px] text-white/40 shrink-0">
              {mobilePercent}% mobile · {100 - mobilePercent}% desktop
            </span>
          </div>
        </Section>

        {/* ── CTA Performance ───────────────────────────────────────────── */}
        <p className="font-mono text-[9px] text-white/20 tracking-widest uppercase mb-3 mt-2">CTA Performance (last 30 days)</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <StatCard label="TOTAL CTA CLICKS" value={totalCtaClicks} color="#ff2060" />
          <StatCard
            label="MAKE YOUR CARD (HERO)"
            value={stats.ctaClicks.find(c => c.page === "cta:make-your-card")?.n ?? 0}
            color="#00e8ff"
          />
          <StatCard
            label="CLAIM PLAYER CARD (PRICING)"
            value={stats.ctaClicks.find(c => c.page === "cta:claim-player-card")?.n ?? 0}
            color="#9b59ff"
          />
          <StatCard
            label="CLAIM RESIDENT ID (PAYMENT)"
            value={stats.ctaClicks.find(c => c.page === "cta:claim-resident-id")?.n ?? 0}
            color="#ffc94a"
          />
          {stats.ctaClicks.filter(c => !Object.keys(CTA_LABELS).includes(c.page)).map(c => (
            <StatCard key={c.page} label={c.page.replace("cta:", "").toUpperCase()} value={c.n} color="#b478ff" />
          ))}
        </div>

        {/* ── Leads table ───────────────────────────────────────────────── */}
        <Section title={`Leads — CTA clicks (${stats.leads.length} most recent)`}>
          {stats.leads.length === 0 ? (
            <p className="font-mono text-[11px] text-white/20 text-center py-4">
              No CTA clicks yet — they'll appear here as soon as someone clicks a button.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["When", "CTA", "Geo", "Source", "Device"].map(h => (
                      <th key={h} className="font-mono text-[8px] text-white/25 tracking-widest pb-3 pr-4 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.leads.map((lead, i) => (
                    <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <td className="font-mono text-[10px] text-white/35 py-2 pr-4 whitespace-nowrap">
                        {timeAgo(lead.created_at)}
                      </td>
                      <td className="font-mono text-[10px] py-2 pr-4 whitespace-nowrap" style={{ color: "#ff2060" }}>
                        {CTA_LABELS[lead.page] ?? lead.page}
                      </td>
                      <td className="font-mono text-[10px] text-white/55 py-2 pr-4 whitespace-nowrap">
                        {FLAGS[lead.country_code] ?? "🌐"} {lead.city !== "—" ? `${lead.city}, ` : ""}{lead.country}
                      </td>
                      <td className="font-mono text-[10px] py-2 pr-4 whitespace-nowrap" style={{ color: "#00e8ff" }}>
                        {parseSource(lead.referrer)}
                      </td>
                      <td className="font-mono text-[10px] text-white/35 py-2 capitalize whitespace-nowrap">
                        {lead.device}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}
