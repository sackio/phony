#!/usr/bin/env bash
set -e

# Navigate to project root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi

# Activate the environment
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Copy env file if missing
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
fi

echo "Setup complete. Edit the .env file with your credentials."
