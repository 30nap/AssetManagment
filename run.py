"""Start the dashboard and open it in the browser.

Meant to be launched by double-clicking ``run.bat`` (Windows) or
``run.command`` (macOS/Linux), so it does the setup a first-time run needs:
creates ``.venv``, installs the requirements into it, then serves the app.
Stop it with Ctrl+C.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
VENV_DIR = PROJECT_DIR / ".venv"
REQUIREMENTS = PROJECT_DIR / "requirements.txt"
HOST = "127.0.0.1"
FIRST_PORT = 5000


def venv_python() -> Path:
    """Path to the interpreter inside .venv (Windows keeps it in Scripts/)."""
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def running_inside_venv() -> bool:
    try:
        return Path(sys.executable).resolve() == venv_python().resolve()
    except OSError:
        return False


def ensure_venv() -> Path | None:
    """Create .venv if needed. Returns its interpreter, or None if unavailable.

    A missing venv module (common on Debian/Ubuntu without python3-venv) is not
    fatal: we fall back to the interpreter that launched us.
    """
    if venv_python().exists():
        return venv_python()

    print("• ساخت محیط مجازی (.venv) — این کار فقط بار اول انجام می‌شود...")
    try:
        subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)
    except (subprocess.CalledProcessError, OSError) as error:
        print(f"! ساخت محیط مجازی ممکن نشد ({error}); با پایتون فعلی ادامه می‌دهم.")
        return None
    return venv_python()


def ensure_requirements(python: Path) -> None:
    """Install Flask/requests if they aren't importable yet.

    Skipped once they are, so a normal start doesn't wait on the network —
    which also means an offline machine still launches after the first setup.
    """
    probe = subprocess.run(
        [str(python), "-c", "import flask, requests"],
        capture_output=True,
    )
    if probe.returncode == 0:
        return

    print("• نصب وابستگی‌ها (Flask و requests)...")
    install = subprocess.run(
        [str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(REQUIREMENTS)],
    )
    if install.returncode != 0:
        print(
            "\n! نصب وابستگی‌ها ناموفق بود. اگر دسترسی به PyPI محدود است،"
            "\n  یک آینه تنظیم کنید و دوباره اجرا کنید، مثلا:"
            "\n      pip config set global.index-url https://mirror-pypi.runflare.com/simple"
        )
        raise SystemExit(1)


def free_port(start: int = FIRST_PORT, tries: int = 20) -> int:
    """First open port at or after ``start`` (5000 is taken by AirPlay on macOS)."""
    for port in range(start, start + tries):
        with socket.socket() as probe:
            if probe.connect_ex((HOST, port)) != 0:
                return port
    return start


def serve(port: int) -> None:
    # Imported here so the dependency check above has already run.
    from flask_app import app

    url = f"http://{HOST}:{port}/"

    def announce() -> None:
        # Runs on a timer so it lands after Flask's own startup banner,
        # leaving the address as the last thing on screen.
        print(f"\n✔ داشبورد آماده است: {url}")
        print("  برای بستن، در همین پنجره Ctrl+C بزنید.\n")
        webbrowser.open(url)

    threading.Timer(1.0, announce).start()
    # debug=False: the reloader would re-open the browser on every edit.
    app.run(host=HOST, port=port, debug=False)


def main() -> None:
    os.chdir(PROJECT_DIR)

    # Re-exec inside .venv so the app runs against the installed packages.
    if not running_inside_venv():
        python = ensure_venv()
        if python is not None:
            ensure_requirements(python)
            os.execv(str(python), [str(python), str(Path(__file__).resolve())])
        ensure_requirements(Path(sys.executable))

    try:
        serve(free_port())
    except KeyboardInterrupt:
        print("\nداشبورد بسته شد.")


if __name__ == "__main__":
    main()
