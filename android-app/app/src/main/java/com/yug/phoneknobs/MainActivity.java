package com.yug.phoneknobs;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * Phone Knobs app: a full-screen, landscape, screen-on WebView that shows the knob page served by
 * the program on your computer. The address is typed once on the connect screen and remembered.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "phoneknobs";
    private static final String KEY_URL = "server_url";
    private static final String ASSET_PREFIX = "file:///android_asset/";
    private static final String CONNECT_PAGE = ASSET_PREFIX + "connect.html";

    private WebView web;
    private SharedPreferences prefs;
    private volatile boolean onConnectScreen = true;
    private long lastBack = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(0xFFAB7248);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true;
            }
        });
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // the knob page keeps your pages and values in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                onConnectScreen = url != null && url.startsWith(ASSET_PREFIX);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !onConnectScreen) {
                    showConnect(true);
                }
            }
        });

        String saved = prefs.getString(KEY_URL, "");
        if (saved.isEmpty()) {
            showConnect(false);
        } else {
            onConnectScreen = false;
            web.loadUrl(saved);
        }
    }

    private void showConnect(boolean failed) {
        onConnectScreen = true;
        web.loadUrl(CONNECT_PAGE + (failed ? "?err=1" : ""));
    }

    /** "192.168.1.20" -> "http://192.168.1.20:3000/". Returns null if it isn't an address. */
    private static String normalize(String raw) {
        if (raw == null) return null;
        String t = raw.trim();
        if (t.isEmpty()) return null;
        if (!t.contains("://")) t = "http://" + t;
        Uri u = Uri.parse(t);
        String host = u.getHost();
        if (host == null || host.isEmpty()) return null;
        int port = u.getPort();
        if (port == -1) port = 3000;
        String scheme = "https".equals(u.getScheme()) ? "https" : "http";
        return scheme + "://" + host + ":" + port + "/";
    }

    /** Only the bundled connect screen may use this; the knob page served by your computer gets nothing. */
    public class Bridge {
        @JavascriptInterface
        public String saved() {
            return onConnectScreen ? prefs.getString(KEY_URL, "") : "";
        }

        @JavascriptInterface
        public boolean connect(String raw) {
            if (!onConnectScreen) return false;
            final String url = normalize(raw);
            if (url == null) return false;
            prefs.edit().putString(KEY_URL, url).apply();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    onConnectScreen = false;
                    web.loadUrl(url);
                }
            });
            return true;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (onConnectScreen) {
            super.onBackPressed();   // leave the app
            return;
        }
        // Edges of the screen are right next to the knobs, so a stray swipe must not kick you out.
        long now = SystemClock.uptimeMillis();
        if (now - lastBack < 1500) {
            showConnect(false);
        } else {
            lastBack = now;
            Toast.makeText(this, "Press back again to change server", Toast.LENGTH_SHORT).show();
        }
    }

    @SuppressWarnings("deprecation")
    private void goImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    protected void onResume() {
        super.onResume();
        goImmersive();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
