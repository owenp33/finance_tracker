#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-dev.sh  —  one-command local dev startup (run from WSL)
#
# What it does:
#   1. Starts PostgreSQL (WSL service)
#   2. Activates the Python venv and starts Flask on :5000
#   3. Starts the React dev server on :3000
#   4. If ngrok is installed, opens tunnels for both ports
#   5. On Ctrl-C: kills all processes and stops PostgreSQL cleanly
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  sudo service postgresql stop 2>/dev/null || true
  echo "All stopped."
}
trap cleanup EXIT INT TERM

# ── 1. PostgreSQL ─────────────────────────────────────────────────────────────
echo ">> Starting PostgreSQL..."
sudo service postgresql start || true   # 'already running' exits non-zero, that's fine

# ── 2. Flask backend ──────────────────────────────────────────────────────────
echo ">> Starting Flask backend..."
(
  cd "$BACKEND_DIR"
  # Use a Linux-specific venv so it doesn't conflict with the Windows venv/
  if [ ! -f "venv_linux/bin/activate" ]; then
    echo ">> Creating WSL venv at backend/venv_linux ..."
    if ! python3 -m venv venv_linux; then
      echo ""
      echo "ERROR: Could not create venv. Run this first:"
      echo "  sudo apt install python3-venv -y"
      echo ""
      exit 1
    fi
    source venv_linux/bin/activate
    pip install -r requirements.prod.txt
  else
    source venv_linux/bin/activate
  fi
  python app.py
) &
PIDS+=($!)

# ── 3. React frontend ─────────────────────────────────────────────────────────
echo ">> Starting React frontend..."
(cd "$FRONTEND_DIR" && npm start) &
PIDS+=($!)

# ── 4. ngrok (optional) ───────────────────────────────────────────────────────
if command -v ngrok &>/dev/null; then
  # Give the servers a moment to bind their ports before ngrok tries to tunnel
  sleep 3
  echo ">> Starting ngrok tunnels..."
  ngrok http 3000 --pooling-enabled &
  PIDS+=($!)
  ngrok http 5000 --pooling-enabled &
  PIDS+=($!)
fi

echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Backend:   http://localhost:5000         │"
echo "│  Frontend:  http://localhost:3000         │"
echo "└──────────────────────────────────────────┘"
echo "  Press Ctrl+C to stop everything."
echo ""

# Block until a child exits or Ctrl+C
wait "${PIDS[0]}"
