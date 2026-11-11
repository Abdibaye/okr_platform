#!/bin/sh
set -eu
# The runner writes literal KEY=value lines. Never source/eval this file.
if [ -f /run/secrets/neander_environment ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    case "$line" in *=*) ;; *) exit 1 ;; esac
    key=${line%%=*}
    case "$key" in ''|[0-9]*|*[!a-zA-Z0-9_]*) exit 1 ;; esac
    export "$line"
  done < /run/secrets/neander_environment
fi
exec "$@"
