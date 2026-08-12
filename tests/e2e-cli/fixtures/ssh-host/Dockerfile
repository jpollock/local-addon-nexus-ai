FROM php:8.3-cli-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server mariadb-server default-mysql-client \
      ca-certificates curl less \
 && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install mysqli pdo_mysql

RUN curl -fsSL -o /usr/local/bin/wp \
      https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
 && chmod +x /usr/local/bin/wp

RUN useradd -m -s /bin/bash wp \
 && mkdir -p /home/wp/.ssh /run/sshd \
 && chown -R wp:wp /home/wp

COPY provision.sh /tmp/provision.sh
RUN chmod +x /tmp/provision.sh && /tmp/provision.sh && rm /tmp/provision.sh

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
