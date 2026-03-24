#!/bin/bash

# Navigate to the correct directory automatically
cd "$(dirname "$0")"

echo "========================================="
echo "  🚀 Starting Marketing Orchestrator UI  "
echo "========================================="

# Start backend in background
echo "→ Starting Backend (Node.js/Express)..."
cd backend
npm install
node --watch server.js &
BACKEND_PID=$!

# Start frontend
echo "→ Starting Frontend (Vite/React)..."
cd ../frontend
npm install
npm run dev &
FRONTEND_PID=$!

echo "========================================="
echo "  ✅ Dashboard running at http://localhost:5173"
echo "  Press Ctrl+C to stop both servers."
echo "========================================="

# Handle termination gracefully
trap "echo -e '\\n→ Stopping servers...' && kill $BACKEND_PID $FRONTEND_PID 2>/dev/null && exit 0" SIGINT SIGTERM

# Wait indefinitely for both processes
wait
