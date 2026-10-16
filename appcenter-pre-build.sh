#!/usr/bin/env bash
# Creates an .env from ENV variables for use with react-native-config
set -eu

if [ -n "${RN_GASFREE_API_KEY+x}" ] || [ -n "${RN_GASFREE_API_SECRET+x}" ] || [ -n "${RN_LETS_EXCHANGE_API_KEY+x}" ]; then
  printf "Retired API credentials must not be included in a mobile build\n" >&2
  exit 1
fi

ENV_WHITELIST=${ENV_WHITELIST:-"^RN_"}
printf "Creating an .env file with the following whitelist:\n"
printf "%s\n" $ENV_WHITELIST
set | egrep -e $ENV_WHITELIST | sed 's/^RN_//g' > .env
if grep -Eq '^(RN_)?(GASFREE_API_(KEY|SECRET)|LETS_EXCHANGE_API_KEY)=' .env; then
  rm .env
  printf "Retired API credentials must not be included in a mobile build\n" >&2
  exit 1
fi
printf ".env created\n"
