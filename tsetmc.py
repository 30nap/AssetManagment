"""Tehran Stock Exchange (TSETMC) provider.

Uses the public ``cdn.tsetmc.com`` JSON API to search instruments by name and
read their latest price. Prices on TSE are quoted in **rial**; they are
converted to **toman** here so the whole app speaks one currency.

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


def search(query: str, limit: int = 12) -> list[dict]:
    """Search instruments by Persian name/symbol.

    Returns a list of ``{provider, code, symbol, name, market, currency, unit}``
    ready to be added as an asset.
    """
    query = query.strip()
    if not query:
        return []

    response = requests.get(SEARCH_URL.format(query=query), headers=HEADERS, timeout=8)
    response.raise_for_status()
    items = response.json().get("instrumentSearch", []) or []

    results: list[dict] = []
    seen: set[str] = set()
    for item in items:
        # ``lastDate == 1`` marks the instrument as currently active/listed.
        if item.get("lastDate") != 1:
            continue
        ins_code = str(item.get("insCode") or "")
        if not ins_code or ins_code in seen:
            continue
        seen.add(ins_code)
        results.append(
            {
                "provider": PROVIDER,
                "code": ins_code,
                "symbol": (item.get("lVal18AFC") or "").strip(),
                "name": (item.get("lVal30") or "").strip(),
                "market": (item.get("flowTitle") or "بورس").strip(),
                "currency": "IRR",
                "unit": "سهم",
                "category": "stock",
            }
        )
        if len(results) >= limit:
            break

    return results


def fetch_quote(ins_code: str) -> dict:
    """Return ``{"value", "currency"}`` (toman) for one instrument."""
    response = requests.get(PRICE_URL.format(ins_code=ins_code), headers=HEADERS, timeout=8)
    response.raise_for_status()
    info = response.json().get("closingPriceInfo") or {}

    # Last trade price; fall back to closing price when the market is closed.
    rial = _to_number(info.get("pDrCotVal")) or _to_number(info.get("pClosing"))
    if rial <= 0:
        raise ValueError("قیمت سهم در دسترس نیست")

    return {"value": round(rial / 10), "currency": "IRR"}  # rial -> toman


def _to_number(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
