import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="min-h-screen" style={{ background: "#05050d", color: "#e8e0f5" }}>
      <div className="max-w-2xl mx-auto px-6 py-16">

        <Link to="/" className="inline-flex items-center space-x-1.5 font-mono text-[10px] tracking-widest text-white/30 hover:text-white/60 transition-colors mb-10 uppercase">
          <span>←</span><span>Back to Solara City</span>
        </Link>

        <h1 className="text-3xl font-black tracking-tight mb-1" style={{ color: "#ff6b1a" }}>Terms of Service</h1>
        <p className="font-mono text-[10px] text-white/30 tracking-widest mb-10">Last updated: June 2025</p>

        <div className="space-y-8 text-[14px] leading-relaxed text-white/65">

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">1. Service description</h2>
            <p>Solara City Bureau of Residents ("the Service") is a web application that allows users to upload a selfie, have it stylised using AI, and receive a holographic resident ID card ("the Card"). Solara City is an original fictional universe created for this project — it is not affiliated with, endorsed by, or connected to any real person, company, game, or publisher.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">2. Eligibility</h2>
            <p>You must be at least 18 years old to use the Service. By submitting the consent checkbox on upload, you confirm you meet this requirement.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">3. Photo requirements and ownership</h2>
            <ul className="space-y-2 list-none">
              {[
                "The photo you upload must be your own photo, or you must have explicit written permission from the person depicted to use it for this purpose.",
                "You must not upload photos of minors.",
                "You must not upload photos that are obscene, illegal, or that violate third-party rights.",
                "By uploading a photo, you grant us a limited, non-exclusive licence to process it solely for the purpose of generating your Card. This licence terminates when your job data is deleted.",
                "We do not claim ownership of your image or the generated Card.",
              ].map((item) => (
                <li key={item} className="flex items-start space-x-3">
                  <span style={{ color: "#ff6b1a" }} className="mt-0.5 shrink-0">▶</span><span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">4. Pricing and delivery</h2>
            <ul className="space-y-2 list-none">
              {[
                ["Current pricing", "The Service is currently free during the beta period. Pricing may be introduced in future — you will be informed before any charge is made."],
                ["Delivery", "Your Card is delivered digitally within approximately 2 minutes of submission. You will receive a shareable link immediately on the result page."],
                ["Data expiry", "Generated assets (card layers, shareable links) may be deleted 7 days after creation. Download or bookmark your card promptly if you wish to keep it."],
              ].map(([label, desc]) => (
                <li key={label} className="flex items-start space-x-3">
                  <span className="text-white/30 mt-0.5 shrink-0">·</span>
                  <span><strong className="text-white/80">{label}:</strong> {desc}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">5. Intellectual property</h2>
            <p className="mb-3">The Solara City name, brand, visual design, districts, and card aesthetic are original works. The generated Cards include your AI-stylised portrait. You own the right to use your Card for personal, non-commercial purposes including social media sharing.</p>
            <p className="mb-3">The Service does not use, reference, or reproduce any trademarks, characters, logos, or other intellectual property belonging to any third party. Solara City is entirely original fiction.</p>
            <p>You may not re-sell the Card or use it for commercial purposes without our written consent.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">6. Acceptable use</h2>
            <p className="mb-2">You agree not to use the Service to:</p>
            <ul className="space-y-1.5 list-none">
              {[
                "Upload photos of other people without their permission.",
                "Attempt to generate content depicting real public figures in a deceptive or harmful manner.",
                "Automate requests or scrape the service.",
                "Attempt to reverse-engineer or circumvent any security measure.",
                "Use the output for fraud, impersonation, or any illegal purpose.",
              ].map((item) => (
                <li key={item} className="flex items-start space-x-3">
                  <span className="text-white/30 mt-0.5 shrink-0">·</span><span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">7. Content moderation</h2>
            <p>Uploaded images are automatically checked for adult content, violence, and the presence of a human face before processing. We reserve the right to reject any image that fails these checks without liability.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">8. Limitation of liability</h2>
            <p className="mb-3">The Service is provided "as is." To the maximum extent permitted by law, we exclude all warranties, express or implied. We are not liable for:</p>
            <ul className="space-y-1.5 list-none">
              {[
                "The quality or appearance of the AI-stylised portrait (results vary by photo quality).",
                "Loss of data after the expiry window.",
                "Any indirect, incidental, or consequential losses.",
              ].map((item) => (
                <li key={item} className="flex items-start space-x-3">
                  <span className="text-white/30 mt-0.5 shrink-0">·</span><span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">9. Governing law</h2>
            <p>These Terms are governed by the laws of the Republic of India. Any disputes will be resolved in the courts of that jurisdiction, except where mandatory consumer protection laws provide otherwise.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-white/90 mb-3 tracking-wide">10. Changes to these Terms</h2>
            <p>We may update these Terms. Continued use of the Service after the updated date constitutes acceptance of the new Terms.</p>
          </section>

        </div>

        <div className="mt-16 pt-8 border-t border-white/5">
          <Link to="/" className="font-mono text-[10px] text-white/25 hover:text-white/50 tracking-widest uppercase transition-colors">← Solara City</Link>
          <span className="mx-4 text-white/10">·</span>
          <Link to="/privacy" className="font-mono text-[10px] text-white/25 hover:text-white/50 tracking-widest uppercase transition-colors">Privacy Policy →</Link>
        </div>

      </div>
    </div>
  );
}
