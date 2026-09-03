"""Asset dashboard web app (Flask).

Serves the Persian asset dashboard and proxies live price lookups to the
market providers (TGJU for gold/currency/crypto, TSETMC for stocks and ETFs).

Run ``run.ps1`` (Windows) or ``run.sh`` (macOS/Linux) to start it. To run it
by hand, with the reloader on::

    pip install -r requirements.txt
    python flask_app.py
    # open http://127.0.0.1:5000/
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, render_template, request

import providers

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/search")
def api_search():
    """Search instruments across all markets: /api/search?q=فولاد"""
    query = (request.args.get("q") or "").strip()
    if len(query) < 2:
        return jsonify({"results": []})
    try:
        results = providers.search(query)
    except Exception as error:  # noqa: BLE001
        return jsonify({"error": str(error)}), 502
    return jsonify({"results": results})


@app.route("/api/quote", methods=["POST"])
def api_quote():
    """Fetch live prices for a batch of refs.

    Body: ``{"items": [{"id": "...", "provider": "...", "code": "..."}]}``
    """
    payload = request.get_json(silent=True) or {}
    items = payload.get("items") or []
    if not isinstance(items, list):
        return jsonify({"error": "ساختار درخواست نامعتبر است"}), 400
    return jsonify(providers.fetch_quotes(items))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
