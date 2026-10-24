# Only a fixed result is printed. Any exception output stays in the runner's
# private command file and is projected by the bounded dependency observer.
require 'bundler'

expected_gemfile, expected_lockfile = ARGV
abort 'ROOT_BUNDLE_CONTEXT_MISMATCH' unless ARGV.length == 2 &&
  File.realpath(Bundler.default_gemfile) == File.realpath(expected_gemfile) &&
  File.realpath(Bundler.default_lockfile) == File.realpath(expected_lockfile)
require 'cocoapods'
require 'xcodeproj'
abort 'ROOT_BUNDLE_VERSION_MISMATCH' unless Pod::VERSION == '1.16.2' &&
  Xcodeproj::VERSION == '1.27.0'
puts 'ROOT_BUNDLE_CONTEXT_PASS'
