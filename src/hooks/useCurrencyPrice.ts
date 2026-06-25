import { useEffect, useState } from "react";

// Gumroad product is priced in USD — use this as base so our displayed price
// matches what Gumroad actually charges at checkout.
const OLD_USD_AMOUNT = 19.99;
const OLD_USD_DISPLAY = "$19.99";
const USD_AMOUNT = 11.99;
const USD_DISPLAY = "$11.99";
let cache: { price: string; oldPrice: string } | null = null;

function detectCurrency(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "INR";
    if (tz === "Europe/London") return "GBP";
    if (tz.startsWith("Australia/")) return "AUD";
    if (tz === "America/Toronto" || tz === "America/Vancouver" || tz === "America/Edmonton" || tz === "America/Winnipeg") return "CAD";
    if (tz === "Asia/Tokyo") return "JPY";
    if (tz === "Asia/Seoul") return "KRW";
    if (tz === "Asia/Shanghai" || tz === "Asia/Chongqing" || tz === "Asia/Beijing") return "CNY";
    if (tz === "America/Sao_Paulo" || tz === "America/Recife") return "BRL";
    if (tz === "Asia/Singapore") return "SGD";
    if (tz === "Asia/Dubai" || tz === "Asia/Muscat") return "AED";
    if (tz.startsWith("Europe/")) return "EUR";
  } catch { /* */ }
  return "USD";
}

export function useCurrencyPrice(): { price: string; oldPrice: string } {
  const [result, setResult] = useState(cache ?? { price: USD_DISPLAY, oldPrice: OLD_USD_DISPLAY });

  useEffect(() => {
    if (cache) { setResult(cache); return; }

    const currency = detectCurrency();
    if (currency === "USD") {
      cache = { price: USD_DISPLAY, oldPrice: OLD_USD_DISPLAY };
      setResult(cache);
      return;
    }

    fetch("https://open.er-api.com/v6/latest/USD")
      .then((r) => r.json())
      .then((data) => {
        const rate = data?.rates?.[currency];
        if (!rate) throw new Error("no rate");
        const fmt = (amt: number) => "≈" + new Intl.NumberFormat(navigator.language, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(Math.round(amt * rate));
        cache = { price: fmt(USD_AMOUNT), oldPrice: fmt(OLD_USD_AMOUNT) };
        setResult(cache);
      })
      .catch(() => {
        cache = { price: USD_DISPLAY, oldPrice: OLD_USD_DISPLAY };
        setResult(cache);
      });
  }, []);

  return result;
}
