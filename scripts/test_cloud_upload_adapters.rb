# Fake actions only. No Fastlane gems, shell/provider/network/signing operations.
require 'minitest/autorun'
require 'tmpdir'

module UI
  def self.user_error!(message); raise message; end
end

class FakeCloudUploader
  attr_reader :events
  def initialize
    @lanes = {}; @events = []
    instance_eval(File.read(File.expand_path('../release/cloud/Fastfile', __dir__)))
  end
  def default_platform(_); end
  def platform(name, &block); @platform = name; instance_eval(&block); end
  def lane(name, &block); @lanes[[@platform, name]] = block; end
  def run(platform); @lanes.fetch([platform, :approved_upload]).call; end
  def app_store_connect_api_key(options); @events << [:api_key, options]; :synthetic_key; end
  def upload_to_testflight(options); @events << [:testflight, options]; end
  def upload_to_play_store(options); @events << [:play, options]; end
end

class CloudUploaderTests < Minitest::Test
  def setup
    @previous = ENV.to_h
    @tmp = Dir.mktmpdir
  end
  def teardown
    ENV.replace(@previous)
    FileUtils.remove_entry(@tmp)
  end
  def fixture(operation, suffix)
    file = File.join(@tmp, 'release' + suffix); File.write(file, 'synthetic')
    ENV['KEEPER_RELEASE_OPERATION'] = operation
    ENV['KEEPER_VERIFIED_ARTIFACT'] = file
    FakeCloudUploader.new
  end
  def test_testflight_is_upload_only_without_external_distribution_or_submission
    fake = fixture('testflight-upload', '.ipa')
    %w[KEEPER_ASC_KEY_ID KEEPER_ASC_ISSUER_ID KEEPER_ASC_KEY_BASE64].each { |key| ENV[key] = 'synthetic' }
    fake.run(:ios)
    options = fake.events.last[1]
    assert_equal :testflight, fake.events.last[0]
    assert_equal false, options[:distribute_external]
    assert_equal true, options[:skip_submission]
    assert_equal false, options[:notify_external_testers]
    assert_equal true, options[:skip_waiting_for_build_processing]
    assert_nil options[:changelog]
    assert_equal 'io.hexawallet.keeper', options[:app_identifier]
  end
  def test_play_stays_internal_draft_without_metadata_or_review_submission
    fake = fixture('play-internal-upload', '.aab'); ENV['KEEPER_PLAY_SERVICE_ACCOUNT'] = 'synthetic'
    fake.run(:android); options = fake.events.last[1]
    assert_equal :play, fake.events.last[0]
    assert_equal 'internal', options[:track]
    assert_equal 'draft', options[:release_status]
    assert_equal true, options[:changes_not_sent_for_review]
    assert_equal true, options[:skip_upload_metadata]
  end
  def test_wrong_operation_or_missing_credential_never_calls_upload
    fake = fixture('ios-signed-build', '.ipa')
    assert_raises(RuntimeError) { fake.run(:ios) }
    assert_empty fake.events
    fake = fixture('testflight-upload', '.ipa')
    %w[KEEPER_ASC_KEY_ID KEEPER_ASC_ISSUER_ID KEEPER_ASC_KEY_BASE64].each { |key| ENV.delete(key) }
    assert_raises(RuntimeError) { fake.run(:ios) }
    assert_empty fake.events
  end
end
