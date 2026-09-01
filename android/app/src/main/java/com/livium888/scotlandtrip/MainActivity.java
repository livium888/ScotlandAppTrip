package com.livium888.scotlandtrip;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.EditText;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginHandle;

/**
 * Beyond Capacitor's default activity, this app registers as an Android
 * share target (see AndroidManifest.xml) so a place shared from Google Maps
 * ("Share" -> this app) can be picked up and added directly.
 *
 * See MapsPlaceResolver for how the shared text and link are turned into a
 * place, and why the share text is trusted ahead of anything scraped.
 */
public class MainActivity extends BridgeActivity {

  private static final String TAG = "MapsShare";

  /** Set true to show a dialog of exactly what a share was parsed into. */
  private static final boolean SHARE_DIAGNOSTICS = false;

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
    final String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
    new Thread(() -> resolveAndDeliver(subject, text)).start();
  }

  private void resolveAndDeliver(String subject, String sharedText) {
    // Taken first because the Maps app hands it over directly - no network,
    // nothing that a consent wall or bot check can take away.
    String nameFromShare = MapsPlaceResolver.nameFromShare(subject, sharedText);

    String url = MapsPlaceResolver.extractUrl(sharedText);
    MapsPlaceResolver.Place place = null;
    if (url != null) {
      try {
        place = MapsPlaceResolver.resolve(url);
      } catch (Exception e) {
        // Never let a lookup failure lose the share; the name from the
        // share text is usually enough to search on.
        Log.w(TAG, "place resolution failed for " + url, e);
      }
    }

    deliverSharedPlace(nameFromShare, sharedText, subject, place);
  }

  private void deliverSharedPlace(
    String nameFromShare,
    String rawText,
    String subject,
    MapsPlaceResolver.Place place
  ) {
    String nameFromUrl = place != null ? place.title : null;
    String name = nameFromShare != null ? nameFromShare : nameFromUrl;

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
      if (place.googleUrl != null) payload.put("googleUrl", place.googleUrl);
    }

    final String report = buildDiagnosticReport(name, nameFromShare, nameFromUrl, rawText, subject, place);

    new Handler(Looper.getMainLooper())
      .post(() -> {
        try {
          PluginHandle handle = getBridge().getPlugin("ShareReceiver");
          if (handle != null) {
            ((SharePlugin) handle.getInstance()).deliverSharedPlace(payload);
          }
          if (SHARE_DIAGNOSTICS) showDiagnostics(report);
        } catch (Exception e) {
          Log.w(TAG, "deliverSharedPlace failed", e);
          if (SHARE_DIAGNOSTICS) showDiagnostics(report + "\n\nDELIVERY FAILED: " + e);
        }
      });
  }

  private String buildDiagnosticReport(
    String name,
    String nameFromShare,
    String nameFromUrl,
    String rawText,
    String subject,
    MapsPlaceResolver.Place place
  ) {
    StringBuilder sb = new StringBuilder();
    sb.append("USED NAME: ").append(name).append("\n\n");
    sb.append("EXTRA_SUBJECT: ").append(subject).append("\n\n");
    sb.append("EXTRA_TEXT:\n").append(rawText).append("\n\n");
    sb.append("name from share text: ").append(nameFromShare).append("\n");
    sb.append("name from URL path: ").append(nameFromUrl).append("\n\n");
    if (place == null) {
      sb.append("RESOLVED URL: (no link resolved)");
    } else {
      sb
        .append("COORDS: ")
        .append(place.latitude == null ? "none" : place.latitude + "," + place.longitude)
        .append("\n\nGOOGLE LINK: ")
        .append(place.googleUrl == null ? "none" : place.googleUrl)
        .append("\n\nRESOLVED URL:\n")
        .append(place.resolvedUrl)
        .append("\n\nscrape: ")
        .append(place.scrapeNote == null ? "ok" : place.scrapeNote);
    }
    return sb.toString();
  }

  /**
   * A selectable dialog rather than a Toast: the useful values here are long
   * URLs that a Toast truncates and hides before they can be read.
   */
  private void showDiagnostics(String report) {
    if (isFinishing() || isDestroyed()) return;
    EditText view = new EditText(this);
    view.setText(report);
    view.setTextIsSelectable(true);
    view.setTextSize(11f);
    view.setPadding(40, 40, 40, 40);
    new AlertDialog.Builder(this)
      .setTitle("share-debug-4")
      .setView(view)
      .setPositiveButton("OK", null)
      .show();
  }
}
