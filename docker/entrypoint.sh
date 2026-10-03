#!/bin/sh
# Applies pending database migrations, then starts the web server.
# Migrations take an advisory lock, so parallel starts are safe.
set -eu

node /app/db/src/cli.ts migrate
exec node /app/web/apps/web/server.js
