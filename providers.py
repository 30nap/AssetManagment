"""Dispatch search/quote requests across the available market providers."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

import tgju
import tsetmc

PROVIDERS = {
    tgju.PROVIDER: tgju,
    tsetmc.PROVIDER: tsetmc,
}


def search(query: str) -> list[dict]:
    """Search every provider and merge the results.

    TGJU (curated catalog) is fast/local; TSETMC hits the network. If the
    stock lookup fails (e.g. blocked outbound on PythonAnywhere free tier) we
    still return the catalog matches instead of erroring out.
    """
    results = tgju.search(query)
    try:
        results += tsetmc.search(query)
    except Exception:  # noqa: BLE001 - network failure shouldn't break search
        pass
    return results


def fetch_quote(provider: str, code: str) -> dict:
    module = PROVIDERS.get(provider)
    if module is None:
        raise ValueError(f"ارائه‌دهنده ناشناخته: {provider}")
    return module.fetch_quote(code)


def fetch_quotes(items: list[dict], max_workers: int = 8) -> dict:
    """Fetch many quotes concurrently.

    ``items`` is a list of ``{"id", "provider", "code"}``. Returns
    ``{"results": {id: {value, currency}}, "failed": [id, ...]}``.
    """
    results: dict[str, dict] = {}
    failed: list[str] = []

    def _run(item: dict) -> dict:
        return fetch_quote(item["provider"], item["code"])

    valid = [it for it in items if it.get("id") and it.get("provider") and it.get("code")]
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_run, item): item for item in valid}
        for future in as_completed(futures):
            item = futures[future]
            try:
                results[item["id"]] = future.result()
            except Exception:  # noqa: BLE001 - any failure means "price unavailable"
                failed.append(item["id"])

    return {"results": results, "failed": failed}
