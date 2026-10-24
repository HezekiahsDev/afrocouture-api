#!/usr/bin/env bash
# Puts the AfroCouture API behind nginx with a Let's Encrypt certificate,
# mirroring the dali-api.alcance.ng setup on this server.
#
#   sudo bash setup-nginx.sh [domain] [app-port] [certbot-email]
#
# Defaults: afrocouture-api.alcance.ng, port 3001, no email (certbot will ask).
# Before running: create a DNS A record for the domain pointing at this server
# (in Cloudflare, same as dali-api.alcance.ng).
set -euo pipefail

DOMAIN="${1:-afrocouture-api.alcance.ng}"
PORT="${2:-3001}"
EMAIL="${3:-}"
SITE="/etc/nginx/sites-available/$DOMAIN"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0 $*" >&2
  exit 1
fi

echo "==> Checking the API is running on port $PORT"
if ! curl -fsS -m 5 "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "Nothing healthy on 127.0.0.1:$PORT/health. Start the API (pm2) first." >&2
  exit 1
fi

echo "==> Checking DNS for $DOMAIN"
if ! getent hosts "$DOMAIN" >/dev/null; then
  echo "$DOMAIN does not resolve yet. Add the DNS record, wait a minute, then re-run." >&2
  exit 1
fi

if [[ -e "$SITE" ]]; then
  backup="$SITE.bak.$(date +%Y%m%d%H%M%S)"
  echo "==> $SITE exists; backing it up to $backup"
  cp "$SITE" "$backup"
fi

echo "==> Writing $SITE"
cat >"$SITE" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    # Uploads (KYC documents, CAC certificates, photos) are up to 10 MB each.
    # nginx's 1 MB default would reject them with a bare 413 before the app sees them.
    client_max_body_size 12m;

    # Socket.IO (chat, next phase) — long-lived WebSocket connections.
    location /socket.io/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        # Uploads to Cloudinary can take a while on slow connections.
        proxy_read_timeout 120s;
    }
}
NGINX

ln -sfn "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"

echo "==> Testing nginx config"
nginx -t
systemctl reload nginx

echo "==> Requesting a certificate (certbot adds the HTTPS server block and redirect)"
certbot_args=(--nginx -d "$DOMAIN" --redirect)
if [[ -n "$EMAIL" ]]; then
  certbot_args+=(--non-interactive --agree-tos -m "$EMAIL")
fi
certbot "${certbot_args[@]}"

echo "==> Verifying https://$DOMAIN/health"
sleep 2
if curl -fsS -m 10 "https://$DOMAIN/health"; then
  echo
  echo "Done. API is live at https://$DOMAIN"
else
  echo
  echo "nginx and the certificate are in place, but https://$DOMAIN/health did not answer yet." >&2
  echo "If the Cloudflare record is proxied (orange cloud), set SSL/TLS mode to 'Full (strict)'." >&2
  exit 1
fi

cat <<NEXT

Next:
  1. In the API .env set FRONTEND_URL=https://afrocouture-web.vercel.app  (comma-separate extra origins)
  2. Deploy the new API build (pnpm deploy from your machine), then on this server:
       cd ~/projects/afrocouture-api && pnpm migration:run && pnpm seed
       pnpm admin:create <email> '<password>' "<Full Name>"
NEXT
