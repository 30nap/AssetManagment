"""Tehran Stock Exchange (TSETMC) provider.

Uses the public ``cdn.tsetmc.com`` JSON API to search instruments by name and
read their latest price. Prices on TSE are quoted in **rial**; they are
converted to **toman** here so the whole app speaks one currency.

Covers both ordinary shares and ETFs (صندوق‌های قابل معامله). ETFs live in the
same instrument table as shares, but two things used to hide them:

1. TSETMC stores names with the *Arabic* letters ي/ك, while a Persian keyboard
   produces ی/ک. The search endpoint matches the stored string fairly
   literally, so «عیار» (Persian yeh) could miss «عيار» (Arabic yeh). Every
   query is therefore folded to the Arabic spelling, and both spellings are
   tried.
2. The ``lastDate == 1`` filter drops any row TSETMC does not flag as the
   current one. When that leaves nothing, the unfiltered rows are used instead
   so a thin/short-history fund still shows up.

Endpoints used:
    search : https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/<query>
    price  : https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/<insCode>
"""

from __future__ import annotations

import requests

SEARCH_URL = "https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/{query}"
PRICE_URL = "https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/{ins_code}"

# TSETMC rejects requests without a browser-like user agent.
HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "fa-IR,fa;q=0.9,en;q=0.8",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125 Safari/537.36"
    ),
    "referer": "https://www.tsetmc.com/",
}

PROVIDER = "tsetmc"

# Persian keyboard -> the Arabic spelling TSETMC stores. ZWNJ and the Arabic
# tatweel are dropped because TSETMC writes «صندوق سرمايه گذاري» with plain
# spaces.
_TO_ARABIC = str.maketrans({"ی": "ي", "ک": "ك", "‌": " ", "ـ": ""})
_TO_PERSIAN = str.maketrans({"ي": "ی", "ك": "ک", "‌": " ", "ـ": ""})

# TSE industry group for صندوق سرمایه‌گذاری قابل معامله (ETF).
_FUND_GROUP_CODES = {"68"}
_FUND_WORDS = ("صندوق", "صندوق سرمايه", "صندوق سرمایه", "etf")


def to_arabic(text: str) -> str:
    """Fold a Persian-typed string to the Arabic spelling TSETMC indexes."""
    return " ".join(str(text or "").translate(_TO_ARABIC).split())


def to_persian(text: str) -> str:
    """Fold an Arabic-spelled TSETMC string back to Persian for display."""
    return " ".join(str(text or "").translate(_TO_PERSIAN).split())


def _query_variants(query: str) -> list[str]:
    """Spellings worth trying, most likely to match first, without repeats."""
    variants = [to_arabic(query), to_persian(query), query.strip()]
    seen: set[str] = set()
    return [v for v in variants if v and not (v in seen or seen.add(v))]


def _raw_search(query: str, timeout: int = 8) -> list[dict]:
    response = requests.get(SEARCH_URL.format(query=query), headers=HEADERS, timeout=timeout)
    response.raise_for_status()
    return response.json().get("instrumentSearch", []) or []


def _is_fund(name: str, group_code: str) -> bool:
    if group_code in _FUND_GROUP_CODES:
        return True
    lowered = to_persian(name).lower()
    return any(word in lowered for word in _FUND_WORDS)


def _to_result(item: dict) -> dict | None:
    ins_code = str(item.get("insCode") or "").strip()
    if not ins_code:
        return None

    symbol = to_persian(item.get("lVal18AFC") or "")
    name = to_persian(item.get("lVal30") or item.get("lSoc30") or "")
    fund = _is_fund(f"{symbol} {name}", str(item.get("cgrValCot") or "").strip())

    return {
        "provider": PROVIDER,
        "code": ins_code,
        "symbol": symbol,
        "name": name,
        "market": (item.get("flowTitle") or "بورس").strip(),
        "currency": "IRR",
        "unit": "واحد" if fund else "سهم",
        "category": "fund" if fund else "stock",
    }


def search(query: str, limit: int = 12) -> list[dict]:
    """Search instruments (shares *and* ETFs) by Persian name/symbol.

    Returns a list of ``{provider, code, symbol, name, market, currency, unit}``
    ready to be added as an asset.
    """
    query = (query or "").strip()
    if not query:
        return []

    current: list[dict] = []
    archived: list[dict] = []
    seen: set[str] = set()
    last_error: Exception | None = None

    for variant in _query_variants(query):
        try:
            items = _raw_search(variant)
        except Exception as error:  # noqa: BLE001 - try the next spelling
            last_error = error
            continue

        for item in items:
            result = _to_result(item)
            if result is None or result["code"] in seen:
                continue
            seen.add(result["code"])
            # ``lastDate == 1`` marks the row TSETMC considers current; older
            # rows (renamed/expired symbols) are kept only as a fallback.
            (current if item.get("lastDate") == 1 else archived).append(result)

        if len(current) >= limit:
            break

    if not current and not archived and last_error is not None:
        raise last_error

    return (current or archived)[:limit]


def fetch_quote(ins_code: str) -> dict:
    """Return ``{"value", "currency"}`` (toman) for one instrument."""
    response = requests.get(PRICE_URL.format(ins_code=ins_code), headers=HEADERS, timeout=8)
    response.raise_for_status()
    info = response.json().get("closingPriceInfo") or {}

    # Last trade price; fall back to closing price when the market is closed
    # (common for thinly traded funds) and then to yesterday's close.
    rial = (
        _to_number(info.get("pDrCotVal"))
        or _to_number(info.get("pClosing"))
        or _to_number(info.get("priceYesterday"))
    )
    if rial <= 0:
        raise ValueError("قیمت نماد در دسترس نیست")

    return {"value": round(rial / 10), "currency": "IRR"}  # rial -> toman


def _to_number(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


if __name__ == "__main__":  # pragma: no cover - manual diagnostic
    # Run where cdn.tsetmc.com is reachable:
    #     python tsetmc.py عیار آگاس آرام نهال موج
    import sys

    for term in sys.argv[1:] or ["عیار", "آگاس", "آرام", "نهال", "موج"]:
        print(f"\n=== {term} (سعی با: {', '.join(_query_variants(term))}) ===")
        try:
            found = search(term)
        except Exception as error:  # noqa: BLE001
            print(f"  خطا: {type(error).__name__}: {error}")
            continue
        if not found:
            print("  نتیجه‌ای پیدا نشد")
        for row in found:
            try:
                price = fetch_quote(row["code"])["value"]
                price_text = f"{price:,} تومان"
            except Exception as error:  # noqa: BLE001
                price_text = f"قیمت نامعلوم ({type(error).__name__})"
            print(f"  {row['symbol']:<10} {row['category']:<6} {row['code']:<20} {row['name']}  →  {price_text}")
