#!/usr/bin/env ruby
# frozen_string_literal: true

# Use react-native-config's own reader so this checks the same ENVFILE,
# /tmp/envfile override, and .env fallback that its code generator will use.
reader_directory, environment_root = ARGV
abort('Missing react-native-config environment inputs') unless reader_directory && environment_root

retired_names = %w[GASFREE_API_KEY GASFREE_API_SECRET LETS_EXCHANGE_API_KEY]
retired_names += retired_names.map { |name| "RN_#{name}" }
failure = 'Retired API credentials must not be included in an iOS build'

abort(failure) if retired_names.any? { |name| ENV.key?(name) }

require File.join(reader_directory, 'ReadDotEnv')
dotenv, = read_dot_env(environment_root)
abort(failure) if retired_names.any? { |name| dotenv.key?(name) }
