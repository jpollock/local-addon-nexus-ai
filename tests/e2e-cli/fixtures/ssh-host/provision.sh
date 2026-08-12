#!/usr/bin/env bash
# Build-time: create two databases and two WordPress installs under one host.
# Two installs is the point — a single-site alias has no '/' in its site id and
# therefore cannot reproduce the vectorSiteId collision.
set -euo pipefail

service mariadb start
until mysqladmin ping --silent; do sleep 1; done
sleep 2  # Extra time for socket to be ready

for site in alpha beta; do
  mysql -e "CREATE DATABASE wp_${site}; \
            CREATE USER 'wp_${site}'@'localhost' IDENTIFIED BY 'wp_${site}_pw'; \
            GRANT ALL ON wp_${site}.* TO 'wp_${site}'@'localhost';"

  su wp -c "php -d memory_limit=512M /usr/local/bin/wp core download --path=/home/wp/${site} --quiet --force"
  su wp -c "php -d memory_limit=512M /usr/local/bin/wp config create --path=/home/wp/${site} \
              --dbname=wp_${site} --dbuser=wp_${site} --dbpass=wp_${site}_pw \
              --dbhost=localhost:/run/mysqld/mysqld.sock --quiet"
  su wp -c "php -d memory_limit=512M /usr/local/bin/wp core install --path=/home/wp/${site} \
              --url=http://${site}.nexus-e2e.test --title='Nexus E2E ${site}' \
              --admin_user=admin --admin_password=nexus-e2e-admin \
              --admin_email=admin@nexus-e2e.test --skip-email --quiet"
  # Distinct post content per install, so 30-external-host-index can prove the
  # two installs did NOT land in the same vector table.
  su wp -c "php -d memory_limit=512M /usr/local/bin/wp post create --path=/home/wp/${site} --post_status=publish \
              --post_title='Marker ${site}' \
              --post_content='unique-marker-for-${site}-install' --quiet"
done

service mariadb stop
