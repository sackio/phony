#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Set default port if not specified
PORT=${PORT:-24187}

echo "Starting Phony Voice AI Agent on port $PORT..."
echo ""
echo "Backend API: http://localhost:$PORT"
echo "Dashboard UI: http://localhost:$PORT/dashboard/"
echo "Health Check: http://localhost:$PORT/healthz"
echo ""

# Start the FastAPI application
uvicorn backend.main:app --host 0.0.0.0 --port $PORT --reload