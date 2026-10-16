# Execute the real Fastfile lane bodies with fake actions only. No Fastlane gems,
# shell commands, signing, store access or Slack requests are used by this suite.
require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'

module SharedValues
  IPA_OUTPUT_PATH = :ipa_output_path
  GRADLE_AAB_OUTPUT_PATH = :gradle_aab_output_path
  GRADLE_APK_OUTPUT_PATH = :gradle_apk_output_path
  SIGH_NAME = :sigh_name
end

module Actions
  def self.lane_context
    @lane_context ||= {}
  end
end

module CredentialsManager
  module AppfileConfig
    def self.try_fetch_value(key)
      { app_identifier: 'io.hexawallet.keeper', team_id: 'existing-team' }[key]
    end
  end
end

module UI
  def self.user_error!(message)
    raise message
  end

  def self.message(_message); end
  def self.error(_message); end
end

class FakeFastlane
  attr_reader :events, :root
  attr_accessor :failure, :missing_output

  SIGNING_ACTIONS = %i[get_certificates get_provisioning_profile update_project_provisioning update_project_team].freeze
  DISTRIBUTION_ACTIONS = %i[upload_to_testflight upload_to_play_store slack].freeze

  def initialize(target_platform, root)
    @root = root
    @events = []
    @lanes = {}
    file = File.expand_path("../#{target_platform}/fastlane/Fastfile", __dir__)
    # Keep __dir__ resolution and real File.file? checks within the disposable fixture.
    instance_eval(File.read(file), File.join(root, target_platform.to_s, 'fastlane', 'Fastfile'))
    if target_platform == :ios
      real_selector_check = method(:verify_envfile_selector!)
      define_singleton_method(:verify_envfile_selector!) do |production_env, selector = File.join(@root, 'absent-selector')|
        real_selector_check.call(production_env, selector)
      end
    end
  end

  def default_platform(_platform); end
  def desc(_description); end
  def platform(_platform, &block)
    instance_eval(&block)
  end

  def lane(name, &block)
    @lanes[name] = block
  end

  def after_all(&block)
    @after_all = block
  end

  def error(&block)
    @error = block
  end

  def run(name)
    result = @lanes.fetch(name).call
    @after_all&.call(name)
    result
  rescue StandardError => exception
    @error&.call(name, exception)
    raise
  end

  def sh(command, script, *arguments)
    kind = case [command, File.basename(script)]
           when ['node', 'release-version.cjs'] then :preflight
           when ['node', 'verify-channel-config.cjs'] then :config
           when ['python3', 'verify-release-artifact.py'] then :artifact
           else raise "Unexpected shell action: #{command}"
           end
    @events << [kind, script, *arguments]
    raise "Simulated #{kind} failure" if @failure == kind || @failure == arguments.first
  end

  def build_app(options)
    @events << [:build_app, options]
    emit_artifact(:ipa, SharedValues::IPA_OUTPUT_PATH)
  end

  def gradle(options)
    @events << [:gradle, options]
    case options[:task]
    when 'bundle' then emit_artifact(:aab, SharedValues::GRADLE_AAB_OUTPUT_PATH)
    when 'assemble' then emit_artifact(:apk, SharedValues::GRADLE_APK_OUTPUT_PATH)
    when 'clean' then nil
    else raise "Unexpected Gradle task: #{options[:task]}"
    end
  end

  def get_build_number
    620
  end

  def android_get_version_code
    627
  end

  def method_missing(name, *arguments)
    return @events << [name, *arguments] if (SIGNING_ACTIONS + DISTRIBUTION_ACTIONS).include?(name)

    super
  end

  def respond_to_missing?(name, include_private = false)
    (SIGNING_ACTIONS + DISTRIBUTION_ACTIONS).include?(name) || super
  end

  private

  def emit_artifact(extension, key)
    return if @missing_output == extension

    path = File.join(@root, "current.#{extension}")
    File.write(path, 'synthetic artifact')
    Actions.lane_context[key] = path
  end
end

class FastlaneBuildOnlyTest < Minitest::Test
  ENV_KEYS = %w[ENVFILE KEEPER_NOTIFY_SLACK KEEPER_ANDROID_KEYSTORE STORE_PASSWORD KEY_PASSWORD KEY_ALIAS].freeze

  def setup
    @saved_env = ENV_KEYS.to_h { |key| [key, ENV[key]] }
    @root = Dir.mktmpdir('keeper-fastlane-test-')
    File.write(File.join(@root, '.env.production'), 'synthetic reviewed config')
    FileUtils.mkdir_p(File.join(@root, 'android', 'app'))
    File.write(File.join(@root, 'android', 'app', 'release.keystore'), 'synthetic keystore')
    ENV['KEEPER_NOTIFY_SLACK'] = '1' # build_only must ignore even the opt-in.
    ENV.delete('KEEPER_ANDROID_KEYSTORE')
    %w[STORE_PASSWORD KEY_PASSWORD KEY_ALIAS].each { |key| ENV[key] = 'synthetic' }
    Actions.lane_context.clear
  end

  def teardown
    @saved_env.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    Actions.lane_context.clear
    FileUtils.remove_entry(@root)
  end

  def distribution_events(fastlane)
    fastlane.events.select { |event| FakeFastlane::DISTRIBUTION_ACTIONS.include?(event.first) }
  end

  def test_ios_selector_rejects_an_unreviewed_environment
    fastlane = FakeFastlane.new(:ios, @root)
    selector = File.join(@root, 'envfile-selector')
    File.write(selector, File.join(@root, 'other.env'))
    assert_match(/override the reviewed/, assert_raises(RuntimeError) {
      fastlane.verify_envfile_selector!(File.join(@root, '.env.production'), selector)
    }.message)
    File.write(selector, File.join(@root, '.env.production'))
    fastlane.verify_envfile_selector!(File.join(@root, '.env.production'), selector)
  end

  %i[ios android].each do |platform|
    define_method("test_#{platform}_build_only_verifies_current_production_artifacts_without_distribution") do
      fastlane = FakeFastlane.new(platform, @root)
      fastlane.run(:build_only)
      assert_empty distribution_events(fastlane)
      assert_equal %i[preflight config], fastlane.events.take(2).map(&:first)
      assert_equal ['release-check'], fastlane.events.first.drop(2)
      assert_equal File.join(@root, '.env.production'), ENV['ENVFILE']
      artifacts = fastlane.events.select { |event| event.first == :artifact }.map(&:last)
      extensions = platform == :ios ? %w[ipa] : %w[aab apk]
      assert_equal extensions.map { |ext| File.join(@root, "current.#{ext}") }, artifacts
      if platform == :ios
        options = fastlane.events.find { |event| event.first == :build_app }.last
        assert_equal 'hexa_keeper', options[:scheme]
        assert_equal 'app-store', options[:export_method]
        assert_equal true, options[:clean]
        assert_equal({ 'io.hexawallet.keeper' => 'io.hexawallet.keeper AppStore' }, options[:export_options][:provisioningProfiles])
      else
        builds = fastlane.events.select { |event| event.first == :gradle }.map(&:last)
        assert_equal %w[clean bundle assemble], builds.map { |options| options[:task] }
        assert builds.drop(1).all? { |options| options[:build_type] == 'productionRelease' }
        assert builds.drop(1).all? { |options| options[:properties]['android.injected.signing.store.file'] == File.join(@root, 'android', 'app', 'release.keystore') }
      end
    end

    %i[preflight config artifact].each do |failure|
      define_method("test_#{platform}_build_only_stops_on_#{failure}_failure_without_distribution") do
        fastlane = FakeFastlane.new(platform, @root)
        fastlane.failure = failure
        assert_raises(RuntimeError) { fastlane.run(:build_only) }
        assert_empty distribution_events(fastlane)
        if failure != :artifact
          assert_empty fastlane.events.select { |event| (FakeFastlane::SIGNING_ACTIONS + %i[build_app gradle artifact]).include?(event.first) }
        end
      end
    end

    define_method("test_#{platform}_build_only_rejects_missing_reviewed_environment_without_distribution") do
      File.delete(File.join(@root, '.env.production'))
      fastlane = FakeFastlane.new(platform, @root)
      assert_match(/Missing reviewed/, assert_raises(RuntimeError) { fastlane.run(:build_only) }.message)
      assert_equal [:preflight], fastlane.events.map(&:first)
      assert_empty distribution_events(fastlane)
    end

    define_method("test_#{platform}_live_still_uploads_only_after_verification") do
      fastlane = FakeFastlane.new(platform, @root)
      fastlane.run(:live)
      upload = platform == :ios ? :upload_to_testflight : :upload_to_play_store
      assert_equal 1, fastlane.events.count { |event| event.first == upload }
      artifact_positions = fastlane.events.each_index.select { |index| fastlane.events[index].first == :artifact }
      assert artifact_positions.all? { |index| index < fastlane.events.index { |event| event.first == upload } }
      options = fastlane.events.find { |event| event.first == upload }.last
      assert_equal File.join(@root, platform == :ios ? 'current.ipa' : 'current.aab'), options[platform == :ios ? :ipa : :aab]
      assert_equal 'internal', options[:track] if platform == :android
      assert_equal platform == :android ? 1 : 0, fastlane.events.count { |event| event.first == :slack }
    end

    define_method("test_#{platform}_live_does_not_upload_after_failed_artifact_verification") do
      fastlane = FakeFastlane.new(platform, @root)
      fastlane.failure = :artifact
      assert_raises(RuntimeError) { fastlane.run(:live) }
      assert_empty fastlane.events.select { |event| %i[upload_to_testflight upload_to_play_store].include?(event.first) }
    end
  end

  { ios: { ipa: SharedValues::IPA_OUTPUT_PATH }, android: { aab: SharedValues::GRADLE_AAB_OUTPUT_PATH, apk: SharedValues::GRADLE_APK_OUTPUT_PATH } }.each do |platform, outputs|
    outputs.each do |extension, key|
      define_method("test_#{platform}_rejects_stale_#{extension}_from_prior_invocation") do
        stale = File.join(@root, "stale.#{extension}")
        File.write(stale, 'old artifact')
        Actions.lane_context[key] = stale
        fastlane = FakeFastlane.new(platform, @root)
        fastlane.missing_output = extension
        assert_match(/path/, assert_raises(RuntimeError) { fastlane.run(:build_only) }.message)
        assert_empty distribution_events(fastlane)
        assert_empty fastlane.events.select { |event| event.first == :artifact }
        refute Actions.lane_context.key?(key)
      end
    end
  end

  def test_android_rejects_missing_signing_credentials_before_building
    ENV.delete('STORE_PASSWORD')
    fastlane = FakeFastlane.new(:android, @root)
    assert_match(/signing credentials/, assert_raises(RuntimeError) { fastlane.run(:build_only) }.message)
    assert_empty fastlane.events.select { |event| event.first == :gradle }
    assert_empty distribution_events(fastlane)
  end

  def test_android_rejects_missing_keystore_before_building
    File.delete(File.join(@root, 'android', 'app', 'release.keystore'))
    fastlane = FakeFastlane.new(:android, @root)
    assert_match(/keystore/, assert_raises(RuntimeError) { fastlane.run(:build_only) }.message)
    assert_empty fastlane.events.select { |event| event.first == :gradle }
    assert_empty distribution_events(fastlane)
  end

  def test_android_build_only_checks_apk_even_after_aab_passes
    fastlane = FakeFastlane.new(:android, @root)
    fastlane.failure = File.join(@root, 'current.apk')
    assert_raises(RuntimeError) { fastlane.run(:build_only) }
    assert_equal %w[aab apk], fastlane.events.select { |event| event.first == :artifact }.map { |event| File.extname(event.last).delete_prefix('.') }
    assert_empty distribution_events(fastlane)
  end
end
