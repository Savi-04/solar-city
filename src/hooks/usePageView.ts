import { useEffect } from "react";

function sendEvent(page: string) {
  fetch("/api/analytics/pageview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page, referrer: document.referrer || "direct" }),
  }).catch(() => {});
}

export function usePageView(page: string) {
  useEffect(() => { sendEvent(page); }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function trackEvent(event: string) {
  sendEvent(event);
}
