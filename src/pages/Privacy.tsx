import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="min-h-screen" style={{ background: "#05050d", color: "#e8e0f5" }}>
      <div className="max-w-2xl mx-auto px-6 py-16">

        <Link to="/" className="inline-flex items-center space-x-1.5 font-mono text-[10px] tracking-widest text-white/30 hover:text-white/60 transition-colors mb-10 uppercase">
          <span>←</span><span>Back to Sunfall City</span>
        </Link>

        <h1 className="text-3xl font-black tracking-tight mb-1" style={{ color: "#ffc94a" }}>Privacy Policy</h1>
        <p className="font-mono text-[10px] text-white/30 tracking-widest mb-10">Last updated: June 2025 · GDPR compliant</p>

        <div className="space-y-8 text-[14px] leading-relaxed text-white/65">

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">1. Who we are</h2>
            <p>Sunfall City County Sheriff is an independent creative project operated by an individual developer. For data-related enquiries: <a href="mailto:shivangsomvanshi124@gmail.com" className="hover:underline" style={{ color: "#ffc94a" }}>shivangsomvanshi124@gmail.com</a>.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">2. What data we collect</h2>
            <ul className="space-y-2 list-none">
              {[
                ["Name and city", "You type these. They appear on your card and are stored so we can display them."],
                ["Consent records", "We log whether you checked the age, ownership, and privacy checkboxes, together with the time and a hashed (not raw) IP address. Required by GDPR Article 7."],
                ["Hashed IP address", "We store a one-way SHA-256 hash of your IP address for rate-limiting and abuse prevention. The raw IP is never persisted."],
              ].map(([label, desc]) => (
                <li key={label} className="flex items-start space-x-3">
                  <span style={{ color: "#ff6b1a" }} className="mt-0.5 shrink-0">▶</span>
                  <span><strong className="text-white/80">{label}:</strong> {desc}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">3. What we do NOT collect or store</h2>
            <ul className="space-y-1.5 list-none">
              {[
                "Your selfie or source photo — it is processed in memory only and never written to any database or storage bucket.",
                "Biometric data or face embeddings of any kind.",
                "Payment details — we do not receive or store your card number or bank details. Payments are processed entirely by Gumroad (see Section 5).",
                "Browser history, cookies for tracking, or any analytics beyond a simple daily card count.",
                "Device fingerprints or session recordings.",
              ].map((item) => (
                <li key={item} className="flex items-start space-x-3">
                  <span className="text-[#00ff7f] mt-0.5 shrink-0">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">4. How we use your data</h2>
            <p className="mb-2">We use the data we collect only to:</p>
            <ul className="space-y-1.5 list-none">
              {[
                "Generate and display your holographic ID card.",
                "Detect and prevent abuse (rate limiting, fraud checks).",
                "Comply with legal obligations (consent logging).",
              ].map((item) => (
                <li key={item} className="flex items-start space-x-3">
                  <span className="text-white/30 mt-0.5 shrink-0">·</span><span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3">We do not sell, rent, or share your data with third parties for marketing.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">5. Third-party processors</h2>
            <p className="mb-3">The following services process data on our behalf:</p>
            <div className="space-y-2">
              {[
                ["Google Gemini API", "Content moderation — your photo is sent to Google's API to check it contains a valid human face, then discarded. Google processes this under their API terms.", "ai.google.dev"],
                ["fal.ai (Fal Inc.)", "AI image stylisation — your portrait is processed via fal.ai's inference API to apply the Sunfall City art style. Images are discarded after processing per their data policy.", "fal.ai/privacy"],
                ["Gumroad Inc.", "Payment processing — your name, email address, and payment details are processed by Gumroad when you purchase a Card. We receive only a confirmation that payment was completed. See Gumroad's privacy policy for details.", "gumroad.com/privacy"],
                ["Cloudflare", "CDN and bot protection. Cloudflare may process your IP to deliver the service.", "cloudflare.com/privacypolicy"],
              ].map(([name, desc, url]) => (
                <div key={name} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="font-bold text-white/80 text-[13px] mb-0.5">{name}</p>
                  <p className="text-[13px]">{desc}</p>
                  <p className="font-mono text-[10px] text-white/30 mt-1">{url}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">6. Data retention</h2>
            <ul className="space-y-1.5 list-none">
              {[
                "Paid card assets (layers, shareable link) — stored indefinitely so your card remains accessible at your unique URL.",
                "Unpaid preview assets (where payment was not completed) — deleted automatically 7 days after creation.",
                "Consent log entries — retained for 12 months to comply with GDPR accountability requirements, then deleted.",
                "Hashed IP addresses — deleted with the consent log entry.",
              ].map((item) => (
                <li key={item} className="flex items-start space-x-3">
                  <span className="text-white/30 mt-0.5 shrink-0">·</span><span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">7. Your rights (GDPR)</h2>
            <p className="mb-3">If you are in the EU or EEA you have the following rights:</p>
            <ul className="space-y-1.5 list-none">
              {[
                ["Access", "Request a copy of the data we hold about you."],
                ["Erasure", "Request deletion of your job and all associated data."],
                ["Restriction", "Request that we stop processing your data while a dispute is resolved."],
                ["Portability", "Receive your data in a machine-readable format."],
                ["Complaint", "Lodge a complaint with your national data protection authority."],
              ].map(([right, desc]) => (
                <li key={right} className="flex items-start space-x-3">
                  <span className="text-white/30 mt-0.5 shrink-0">·</span>
                  <span><strong className="text-white/70">{right}:</strong> {desc}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3">To exercise any right, email <a href="mailto:shivangsomvanshi124@gmail.com" className="hover:underline" style={{ color: "#ffc94a" }}>shivangsomvanshi124@gmail.com</a> with your job ID (from the URL).</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">8. Cookies</h2>
            <p>We use no tracking cookies. The only storage used client-side is session state held in memory for the duration of your visit. No persistent cookies are set.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">9. Changes to this policy</h2>
            <p>If we make material changes we will update the date at the top of this page. Continued use of the service after changes constitutes acceptance.</p>
          </section>

        </div>

        <div className="mt-16 pt-8 border-t border-white/5">
          <Link to="/" className="font-mono text-[10px] text-white/25 hover:text-white/50 tracking-widest uppercase transition-colors">← Sunfall City</Link>
          <span className="mx-4 text-white/10">·</span>
          <Link to="/terms" className="font-mono text-[10px] text-white/25 hover:text-white/50 tracking-widest uppercase transition-colors">Terms of Service →</Link>
        </div>

      </div>
    </div>
  );
}
