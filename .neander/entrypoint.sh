#!/bin/sh
set -eu
if [ -f /run/secrets/neander_environment ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    case "$line" in *=*) ;; *) exit 1 ;; esac
    key=${line%%=*}
    case "$key" in
      DATABASE_URL|BETTER_AUTH_URL|BETTER_AUTH_SECRET|REMINDER_SWEEP_SECRET|RESEND_API_KEY|EMAIL_FROM|TRANSACTIONAL_EMAIL_WEBHOOK_URL|PASSWORD_RESET_WEBHOOK_URL)
        export "$line"
        ;;
      *) exit 1 ;;
    esac
  done < /run/secrets/neander_environment
fi
exec "$@"
