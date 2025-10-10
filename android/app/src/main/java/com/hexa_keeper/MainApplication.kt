package io.hexawallet.keeper
import android.content.res.Configuration
import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import android.content.Context
import com.facebook.react.ReactInstanceManager
import com.hexa_keeper.CloudBackupPackage
import com.hexa_keeper.KeepScreenAwakePackage
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

class MainApplication : Application(),  ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object: DefaultReactNativeHost(this) {
         override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              add(KeepScreenAwakePackage())
              add(CloudBackupPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)  

  override fun registerReceiver(receiver: BroadcastReceiver?, filter: IntentFilter): Intent? {
     if (Build.VERSION.SDK_INT >= 34 && applicationInfo.targetSdkVersion >= 34) {
         return super.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
          return super.registerReceiver(receiver, filter)
    }
  }

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }

  }
}