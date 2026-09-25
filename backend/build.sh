#!/usr/bin/env bash
# Render build step for the API (TICKET-026), run from backend/ on every deploy.
# See render.yaml and the README's "Deploying to Render".
set -o errexit

python --version
pip install -r requirements.txt

# Django Admin / DRF CSS and JS -> staticfiles/, served by WhiteNoise.
python manage.py collectstatic --no-input

# Free Render services have no shell, so migrations run here. The first one
# also creates the btree_gist extension the no-double-booking rule needs.
python manage.py migrate --no-input

# Demo data only on the very first deploy: --if-empty skips it as soon as any
# property exists, so later deploys never wipe or duplicate anything.
if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  python manage.py seed_demo_data --if-empty
fi
