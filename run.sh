#!/usr/bin/env bash
# Start the dashboard:
#     ./run.sh
# (first time only: chmod +x run.sh)

cd "$(dirname "$0")" || exit 1

if command -v python3 >/dev/null 2>&1; then
  exec python3 run.py
elif command -v python >/dev/null 2>&1; then
  exec python run.py
fi

echo 'Python 3 was not found. Install it first.' >&2
exit 1
