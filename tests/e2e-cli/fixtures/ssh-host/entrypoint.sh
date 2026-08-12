#!/usr/bin/env bash
set -euo pipefail
service mariadb start
until mysqladmin ping --silent; do sleep 1; done
# ssh-keygen -A is a no-op if keys already exist, so a rotation performed by
# the test helper survives a container restart.
ssh-keygen -A
exec /usr/sbin/sshd -D -e
