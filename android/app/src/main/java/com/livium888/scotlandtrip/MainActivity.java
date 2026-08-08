package com.livium888.scotlandtrip;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginHandle;

/**
 * Beyond Capacitor's default activity, this app registers as an Android
 * share target (see AndroidManifest.xml) so a place shared from Google Maps
 * ("Share" -> this app) can be picked up and added directly.
 *
 * The link is followed and its Open Graph tags read natively (see
 * MapsPlaceResolver): a WebView/JS fetch() can't do this itself because
 * cross-origin redirects and page reads are blocked by CORS, but native HTTP
 * isn't bound by that browser rule.
 */
public class MainActivity extends BridgeActivity {

  private static final String TAG = "MapsShare";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    // Deliberately not also calling handleShareIntent(getIntent()) here:
    // BridgeActivity's onCreate() ends by calling this.load(), which itself
    // calls this.onNewIntent(getIntent()) - virtual dispatch sends that to
    // the override below, so the initial intent is already handled once
    // super.onCreate() returns. Calling it again here would double-fire
    // (and, with retainUntilConsumed, double-queue) every cold-start share.
    registerPlugin(SharePlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleShareIntent(intent);
  }

  private void handleShareIntent(Intent intent) {
    if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;

    String type = intent.getType();
    // Matched with startsWith rather than equals: senders may attach
    // parameters such as "text/plain; charset=utf-8".
    if (type == null || !type.startsWith("text/plain")) return;

    String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
    if (sharedText == null || sharedText.trim().isEmpty()) return;

    final String text = sharedText.trim();
    new Thread(() -> resolveAndDeliver(text)).start();
  }

  private void resolveAndDeliver(String sharedText) {
    String url = MapsPlaceResolver.extractUrl(sharedText);

    if (url == null) {
      // Nothing to follow - hand the raw text over so the web app can at
      // least prefill its search box with it.
      deliverSharedPlace(sharedText, sharedText, null);
      return;
    }

    try {
      deliverSharedPlace(null, sharedText, MapsPlaceResolver.resolve(url));
    } catch (Exception e) {
      // Timeouts, no connectivity, unexpected markup - fall back to the raw
      // shared text rather than dropping the share on the floor.
      Log.w(TAG, "place resolution failed for " + url, e);
      deliverSharedPlace(sharedText, sharedText, null);
    }
  }

  private void deliverSharedPlace(String fallbackName, String rawText, MapsPlaceResolver.Place place) {
    String name = place != null && place.title != null ? place.title : fallbackName;

    JSObject payload = new JSObject();
    payload.put("name", name);
    payload.put("rawText", rawText);
    if (place != null) {
      if (place.description != null) payload.put("description", place.description);
      if (place.imageUrl != null) payload.put("imageUrl", place.imageUrl);
      if (place.latitude != null && place.longitude != null) {
        payload.put("lat", place.latitude);
        payload.put("lon", place.longitude);
      }
      if (place.resolvedUrl != null) payload.put("resolvedUrl", place.resolvedUrl);
    }

    final String diagnostic =
      "share-debug-3: name=" +
      name +
      " coords=" +
      (place != null && place.latitude != null ? place.latitude + "," + place.longitude : "none");

    new Handler(Looper.getMainLooper())
      .post(() -> {
        // TEMPORARY DIAGNOSTIC (share-debug-3) - remove once the share flow
        // is confirmed working end to end.
        Toast.makeText(this, diagnostic, Toast.LENGTH_LONG).show();
        try {
          PluginHandle handle = getBridge().getPlugin("ShareReceiver");
          if (handle != null) {
            ((SharePlugin) handle.getInstance()).deliverSharedPlace(payload);
          }
        } catch (Exception e) {
          Log.w(TAG, "deliverSharedPlace failed", e);
          Toast.makeText(this, "share-debug-3: delivery failed - " + e, Toast.LENGTH_LONG).show();
        }
      });
  }
}
