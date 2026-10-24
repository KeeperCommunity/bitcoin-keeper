package io.hexawallet.keeper

import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "hexa_keeper"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    // React Native owns screen state; discard stale native screen fragments on recreation.
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    super.onCreate(savedInstanceState)

    window.decorView.post {
      val rootView = window.decorView.findViewById<View>(android.R.id.content)
      setActivityWindowListener(rootView)
    }
  }

  private fun setActivityWindowListener(root: View) {
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val statusBarHeight = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
      val navigationBarHeight = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      val imeHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom

      val rawBottomInset = maxOf(navigationBarHeight, imeHeight)

      val bottomPadding = (rawBottomInset - 16).coerceAtLeast(0)

      view.setPadding(0, statusBarHeight, 0, bottomPadding)

      insets 
    }
  }
}
