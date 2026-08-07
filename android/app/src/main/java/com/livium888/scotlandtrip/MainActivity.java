package com.livium888.scotlandtrip;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Beyond Capacitor's default activity, this app registers as an Android
 * share target (see AndroidManifest.xml) so a place shared from Google Maps
 * ("Share" -> this app) can be picked up and added directly.
 *
 * Google Maps shares one of two shapes:
 *  - a long-form URL with the name and coordinates embedded in the path
 *    (".../maps/place/Name/@lat,lon,zoom") - parsed with no network call.
 *  - a short maps.app.goo.gl link, which is opaque until resolved. A
 *    WebView/JS fetch() can't follow that redirect due to CORS, but native
 *    HTTP code isn't bound by that browser rule, so it's resolved here.
 */
public class MainActivity extends BridgeActivity {

  private static final String TAG = "MapsShare";

  private static final Pattern LONG_URL_PATTERN = Pattern.compile(
    "google\\.[a-z.]+/maps/place/([^/?]+)/@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)"
  );
  private static final Pattern SHORT_URL_PATTERN = Pattern.compile("https?://maps\\.app\\.goo\\.gl/\\S+");
  private static final Pattern ANY_URL_PATTERN = Pattern.compile("https?://\\S+");

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleShareIntent(getIntent());
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleShareIntent(intent);
  }

  private void handleShareIntent(Intent intent) {
    if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
    if (!"text/plain".equals(intent.getType())) return;
    String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
    if (sharedText == null || sharedText.trim().isEmpty()) return;

    final String text = sharedText.trim();
    new Thread(() -> resolveAndDeliver(text)).start();
  }

  private void resolveAndDeliver(String sharedText) {
    String rawName = extractNonUrlLine(sharedText);
    String urlForCoords = sharedText;

    Matcher shortMatch = SHORT_URL_PATTERN.matcher(sharedText);
    if (shortMatch.find()) {
      String resolved = resolveRedirects(shortMatch.group(), 5);
      if (resolved != null) urlForCoords = resolved;
    }

    String name = null;
    Double lat = null;
    Double lon = null;

    Matcher longMatch = LONG_URL_PATTERN.matcher(urlForCoords);
    if (longMatch.find()) {
      try {
        lat = Double.parseDouble(longMatch.group(2));
        lon = Double.parseDouble(longMatch.group(3));
        name = Uri.decode(longMatch.group(1)).replace('+', ' ');
      } catch (Exception e) {
        Log.w(TAG, "coordinate parse failed", e);
      }
    }

    if (name == null || name.isEmpty()) name = rawName;
    deliverToWebView(name, lat, lon, sharedText);
  }

  // Manually follows redirects (rather than letting HttpURLConnection auto-follow)
  // so we can stop the moment we reach a resolved google maps URL.
  private String resolveRedirects(String urlStr, int maxHops) {
    String current = urlStr;
    for (int i = 0; i < maxHops; i++) {
      HttpURLConnection conn = null;
      try {
        conn = (HttpURLConnection) new URL(current).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android)");
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        int code = conn.getResponseCode();
        if (code >= 300 && code < 400) {
          String location = conn.getHeaderField("Location");
          if (location == null) break;
          current = location;
        } else {
          return current;
        }
      } catch (Exception e) {
        Log.w(TAG, "redirect resolution failed at hop " + i, e);
        return current;
      } finally {
        if (conn != null) conn.disconnect();
      }
    }
    return current;
  }

  private String extractNonUrlLine(String text) {
    for (String line : text.split("\\r?\\n")) {
      String trimmed = line.trim();
      if (!trimmed.isEmpty() && !ANY_URL_PATTERN.matcher(trimmed).find()) {
        return trimmed;
      }
    }
    return null;
  }

  private void deliverToWebView(String name, Double lat, Double lon, String rawText) {
    try {
      JSONObject payload = new JSONObject();
      payload.put("name", name);
      payload.put("rawText", rawText);
      if (lat != null && lon != null) {
        payload.put("lat", lat);
        payload.put("lon", lon);
      }
      // Always stash it as a plain property first (can't "fail" the way a
      // call to a maybe-not-yet-defined function could), then also try
      // calling the handler directly in case the page already loaded it.
      String js =
        "window.__sharedPlacePayload = " +
        payload.toString() +
        "; if (window.handleSharedPlace) { window.handleSharedPlace(window.__sharedPlacePayload); }";
      new Handler(Looper.getMainLooper()).post(() -> {
        if (getBridge() != null && getBridge().getWebView() != null) {
          getBridge().getWebView().evaluateJavascript(js, null);
        }
      });
    } catch (Exception e) {
      Log.w(TAG, "deliverToWebView failed", e);
    }
  }
}
