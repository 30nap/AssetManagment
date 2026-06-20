"""TGJU provider: gold, currencies, coins and crypto.

Reads each instrument's public profile page on tgju.org and extracts the
current price. Rial values are converted to toman. Designed to work behind
the PythonAnywhere outbound proxy: ``requests`` honours the ``HTTPS_PROXY`` /
``HTTP_PROXY`` environment variables PythonAnywhere sets for you.
"""

from __future__ import annotations

import re

import requests

PROVIDER = "tgju"
TGJU_PROFILE = "https://www.tgju.org/profile/"
JINA_PROXY = "https://r.jina.ai/"  # text-rendering fallback if the page is blocked

REQUEST_HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.6",
    "cache-control": "no-cache",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125 Safari/537.36"
    ),
}

# Searchable catalog. ``kind`` is "irr" (rial -> toman) or "usd" (dollar
# price). ``name`` is the Persian label as it appears on TGJU and is used to
# locate the price on the page.
CATALOG = [
    # --- Gold (طلا) ---
    {"code": "geram18", "name": "طلای 18 عیار", "unit": "گرم", "kind": "irr", "category": "gold"},
    {"code": "geram24", "name": "طلای 24 عیار", "unit": "گرم", "kind": "irr", "category": "gold"},
    {"code": "mesghal", "name": "مثقال طلا", "unit": "مثقال", "kind": "irr", "category": "gold"},
    {"code": "gold_17", "name": "طلای 17 عیار", "unit": "گرم", "kind": "irr", "category": "gold"},
    {"code": "ons", "name": "انس طلا", "unit": "اونس", "kind": "usd", "category": "gold"},
    {"code": "silver", "name": "نقره", "unit": "گرم", "kind": "usd", "category": "gold"},
    # --- Coins (سکه) ---
    {"code": "sekee", "name": "سکه", "unit": "عدد", "kind": "irr", "category": "coin"},
    {"code": "sekeb", "name": "سکه بهار آزادی", "unit": "عدد", "kind": "irr", "category": "coin"},
    {"code": "nim", "name": "نیم سکه", "unit": "عدد", "kind": "irr", "category": "coin"},
    {"code": "rob", "name": "ربع سکه", "unit": "عدد", "kind": "irr", "category": "coin"},
    {"code": "gerami", "name": "سکه گرمی", "unit": "عدد", "kind": "irr", "category": "coin"},
    # --- Currencies (ارز) ---
    {"code": "price_dollar_rl", "name": "دلار", "unit": "دلار", "kind": "irr", "category": "currency"},
    {"code": "price_eur", "name": "یورو", "unit": "یورو", "kind": "irr", "category": "currency"},
    {"code": "price_gbp", "name": "پوند انگلیس", "unit": "پوند", "kind": "irr", "category": "currency"},
    {"code": "price_aed", "name": "درهم امارات", "unit": "درهم", "kind": "irr", "category": "currency"},
    {"code": "price_try", "name": "لیر ترکیه", "unit": "لیر", "kind": "irr", "category": "currency"},
    {"code": "price_cny", "name": "یوان چین", "unit": "یوان", "kind": "irr", "category": "currency"},
    {"code": "price_cad", "name": "دلار کانادا", "unit": "دلار", "kind": "irr", "category": "currency"},
    {"code": "price_aud", "name": "دلار استرالیا", "unit": "دلار", "kind": "irr", "category": "currency"},
    {"code": "price_chf", "name": "فرانک سوئیس", "unit": "فرانک", "kind": "irr", "category": "currency"},
    {"code": "price_rub", "name": "روبل روسیه", "unit": "روبل", "kind": "irr", "category": "currency"},
    {"code": "price_iqd", "name": "دینار عراق", "unit": "دینار", "kind": "irr", "category": "currency"},
    {"code": "price_kwd", "name": "دینار کویت", "unit": "دینار", "kind": "irr", "category": "currency"},
    # --- Crypto (ارز دیجیتال) ---
    {"code": "crypto-bitcoin", "name": "بیت کوین", "unit": "BTC", "kind": "usd", "category": "crypto"},
    {"code": "crypto-ethereum", "name": "اتریوم", "unit": "ETH", "kind": "usd", "category": "crypto"},
    {"code": "crypto-tether", "name": "تتر", "unit": "USDT", "kind": "usd", "category": "crypto"},
    {"code": "crypto-ripple", "name": "ریپل", "unit": "XRP", "kind": "usd", "category": "crypto"},
    {"code": "crypto-cardano", "name": "کاردانو", "unit": "ADA", "kind": "usd", "category": "crypto"},
    {"code": "crypto-dogecoin", "name": "دوج کوین", "unit": "DOGE", "kind": "usd", "category": "crypto"},
    {"code": "crypto-solana", "name": "سولانا", "unit": "SOL", "kind": "usd", "category": "crypto"},
    {"code": "crypto-tron", "name": "ترون", "unit": "TRX", "kind": "usd", "category": "crypto"},
    {"code": "crypto-litecoin", "name": "لایت کوین", "unit": "LTC", "kind": "usd", "category": "crypto"},
    {"code": "crypto-binance-coin", "name": "بایننس کوین", "unit": "BNB", "kind": "usd", "category": "crypto"},
    {"code": "crypto-shiba-inu", "name": "شیبا", "unit": "SHIB", "kind": "usd", "category": "crypto"},
]

CATALOG_BY_CODE = {entry["code"]: entry for entry in CATALOG}

CATEGORY_LABELS = {
    "gold": "طلا",
    "coin": "سکه",
    "currency": "ارز",
    "crypto": "ارز دیجیتال",
}

_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_DIGIT_TRANSLATION = {ord(p): str(i) for i, p in enumerate(_PERSIAN_DIGITS)}
_DIGIT_TRANSLATION.update({ord(a): str(i) for i, a in enumerate(_ARABIC_DIGITS)})
# Persian/Arabic thousands (٬) and decimal (٫) separators -> ASCII equivalents.
_DIGIT_TRANSLATION[ord("٬")] = ","
_DIGIT_TRANSLATION[ord("٫")] = "."


def normalize_digits(value: str) -> str:
    return str(value).translate(_DIGIT_TRANSLATION)


def html_to_text(html: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&rlm;", " ")
        .replace("&lrm;", " ")
        .replace("&amp;", "&")
    )
    return re.sub(r"\s+", " ", text).strip()


def parse_localized_number(value: str) -> float:
    cleaned = re.sub(r"[^\d.]", "", normalize_digits(value).replace(",", ""))
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def search(query: str, limit: int = 20) -> list[dict]:
    """Search the catalog by Persian name or category. Returns asset-ready dicts."""
    query = normalize_digits(query.strip())
    results = []
    for entry in CATALOG:
        haystack = f"{entry['name']} {CATEGORY_LABELS[entry['category']]} {entry['code']}"
        if not query or query in haystack:
            results.append(
                {
                    "provider": PROVIDER,
                    "code": entry["code"],
                    "symbol": entry["name"],
                    "name": entry["name"],
                    "market": CATEGORY_LABELS[entry["category"]],
                    "currency": "USD" if entry["kind"] == "usd" else "IRR",
                    "unit": entry["unit"],
                    "category": entry["category"],
                }
            )
        if len(results) >= limit:
            break
    return results


def fetch_quote(code: str) -> dict:
    """Return ``{"value", "currency"}`` for one catalog code (or generic page)."""
    entry = CATALOG_BY_CODE.get(code)
    name = entry["name"] if entry else ""
    kind = entry["kind"] if entry else "irr"

    text = html_to_text(normalize_digits(_fetch_page(code)))
    if kind == "usd":
        value = _parse_usd_price(text, name)
        currency = "USD"
    else:
        value = _parse_irr_price(text, name)
        currency = "IRR"

    if not value:
        raise ValueError(f"قیمت {name or code} پیدا نشد")
    return {"value": value, "currency": currency}


def _fetch_page(code: str, timeout: int = 8) -> str:
    url = f"{TGJU_PROFILE}{code}"
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=timeout)
        response.raise_for_status()
        return response.text
    except requests.RequestException:
        fallback = requests.get(f"{JINA_PROXY}{url}", headers=REQUEST_HEADERS, timeout=timeout + 4)
        fallback.raise_for_status()
        return fallback.text


def _parse_irr_price(text: str, name: str) -> int:
    patterns = []
    if name:
        escaped = re.escape(name).replace(r"\ ", r"\s+")
        patterns.append(rf"{escaped}\s+\|\s+([\d,.]+)\s+\|")
        # Row form: "<name> 161,014,000 (2.79%)"
        patterns.append(rf"{escaped}\s+([\d,.]+)\s+\(")
    patterns += [
        # "نرخ فعلی" is the headline current rate on every TGJU profile page
        # and is always quoted in rial for IRR instruments.
        r"نرخ فعلی\s*:?\s*([\d,.]+)",
        r"در حال حاضر قیمت هر[^\d]{0,80}?([\d,.]+)\s*ریال",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            value = parse_localized_number(match.group(1))
            if value > 0:
                return round(value / 10)  # rial -> toman
    return 0


def _parse_usd_price(text: str, name: str) -> float:
    patterns = []
    if name:
        escaped = re.escape(name).replace(r"\ ", r"\s+")
        patterns.append(rf"{escaped}\s+\|\s+[\d,.]+\s+\|\s+([\d,.]+)\s+\|")
    patterns += [
        r"قیمت دلاری\s+([\d,.]+)",
        r"در حال حاضر قیمت هر[^\d]{0,80}?([\d,.]+)\s*دلار",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            value = parse_localized_number(match.group(1))
            if value > 0:
                return round(value * 100) / 100
    return 0.0
