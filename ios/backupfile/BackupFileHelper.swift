import Foundation

@objc class BackupFileHelper: NSObject {
  
  override init() {
    super.init()
  }
  
  @objc func setFileProtection(filePath: String, callback: @escaping ((Bool, String?) -> Void)) {
    let fileManager = FileManager.default
    
    do {
      // Set file protection attribute
      try fileManager.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: filePath
      )
      callback(true, nil)
    } catch {
      callback(false, error.localizedDescription)
    }
  }
}
