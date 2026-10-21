#!/bin/sh
set -eu
: "${APP_KEY:?Set APP_KEY before deployment}"
: "${INITIAL_ADMIN_PASSWORD:?Set a strong initial administrator password}"
PORT=${PORT:-80}
sed -i "s/^Listen 80$/Listen $PORT/" /etc/apache2/ports.conf
sed -i "s/:80>/:$PORT>/" /etc/apache2/sites-available/000-default.conf
php artisan config:clear
php artisan migrate --force
php deploy-bootstrap.php
php artisan view:cache
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/uniserve.conf
