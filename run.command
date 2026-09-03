#!/usr/bin/env bash
# Double-click this file to start the dashboard (macOS), or run ./run.command.
cd "$(dirname "$0")" || exit 1

if command -v python3 >/dev/null 2>&1; then
  python3 run.py
elif command -v python >/dev/null 2>&1; then
  python run.py
else
  echo
  echo "پایتون ۳ پیدا نشد. اول آن را نصب کنید."
  echo
  read -r -p "برای بستن Enter بزنید..."
  exit 1
fi

echo
read -r -p "برای بستن Enter بزنید..."
