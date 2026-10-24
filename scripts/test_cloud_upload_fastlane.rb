# Execute the pinned library's upload control flow with fake boundaries only.
# No login, package build, network, Transporter or store operation is performed.
require 'pilot'
require_relative 'test_cloud_upload_adapters'

class OfflinePilotUpload < Pilot::BuildManager
  attr_reader :events
  def initialize
    @events = []
  end
  def start(options, should_login: true)
    @config = options
  end
  def fetch_app_id; 'synthetic-approved-app'; end
  def fetch_app_platform; 'ios'; end
  def transporter_for_selected_team(_options)
    recorder = @events
    Object.new.tap do |fake|
      fake.define_singleton_method(:upload) do |**_arguments|
        recorder << :binary_upload
        true
      end
    end
  end
  def wait_for_build_processing_to_be_complete(_return_when_build_appears)
    @events << :processing_wait
    :synthetic_build
  end
  def distribute(_options, build:)
    @events << :distribution_and_metadata_path
  end
end

class PinnedPilotUploadTests < CloudUploaderTests
  def run_pinned_upload(old_waiting_flag: false)
    assert_equal '2.225.0', Gem.loaded_specs.fetch('fastlane').version.to_s
    fake = fixture('testflight-upload', '.ipa')
    %w[KEEPER_ASC_KEY_ID KEEPER_ASC_ISSUER_ID KEEPER_ASC_KEY_BASE64].each { |key| ENV[key] = 'synthetic' }
    fake.run(:ios)
    options = fake.events.last[1]
    options = options.merge(skip_waiting_for_build_processing: false) if old_waiting_flag
    manager = OfflinePilotUpload.new
    builder = Object.new
    builder.define_singleton_method(:generate) { |**_arguments| 'synthetic-package' }
    capture_io do
      Dir.stub(:mktmpdir, @tmp) do
        FastlaneCore::IpaUploadPackageBuilder.stub(:new, builder) do
          manager.upload(options)
        end
      end
    end
    manager.events
  end
  def test_pinned_upload_returns_before_processing_distribution_and_metadata
    assert_equal [:binary_upload], run_pinned_upload
  end
  def test_old_waiting_flag_reaches_the_distribution_and_metadata_path
    assert_equal [:binary_upload, :processing_wait, :distribution_and_metadata_path], run_pinned_upload(old_waiting_flag: true)
  end
end
