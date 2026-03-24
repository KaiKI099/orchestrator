#!/usr/bin/env bash
# Start the orchestrator using the local venv
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -d ".venv" ]; then
  echo "⚙️  Creating Python virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

if ! python -c "import requests" 2>/dev/null; then
  echo "📦 Installing dependencies..."
  pip install -r requirements.txt
fi

echo "✅ Environment ready."
echo ""

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

python orchestrator.py
