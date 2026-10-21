FROM php:8.4-apache
RUN apt-get update && apt-get install -y --no-install-recommends git unzip supervisor libonig-dev libzip-dev libicu-dev \
    && docker-php-ext-install pdo_mysql mbstring intl zip bcmath pcntl sockets opcache \
    && a2enmod rewrite headers proxy proxy_http proxy_wstunnel \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /var/www/html/backend
COPY backend/ ./
RUN composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader \
    && mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache
COPY Landing/ public/Landing/
COPY User/ public/User/
COPY Admin/ public/Admin/
COPY ["Super Admin/", "public/Super Admin/"]
COPY shared/ public/shared/
COPY deploy/apache.conf /etc/apache2/sites-available/000-default.conf
COPY deploy/supervisord.conf /etc/supervisor/conf.d/uniserve.conf
COPY deploy/start.sh /usr/local/bin/uniserve-start
RUN chmod +x /usr/local/bin/uniserve-start
ENV APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr REVERB_HOST=127.0.0.1 REVERB_PORT=8081 REVERB_SCHEME=http REVERB_PUBLIC_PORT=443 REVERB_PUBLIC_SCHEME=wss
EXPOSE 80
CMD ["/usr/local/bin/uniserve-start"]
