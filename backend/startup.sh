#!/bin/bash
set -e

# Ensure persistent storage directories exist
mkdir -p /home/spine/uploads /home/spine/parsed

echo "Running database migrations..."
python -m alembic upgrade head

echo "Starting Spine API..."
exec python -m uvicorn main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 2 \
  --timeout-keep-alive 120 \
  --log-level info
