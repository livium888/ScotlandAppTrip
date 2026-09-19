package com.livium888.scotlandtrip;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges a place shared from Google Maps (see MainActivity) to the web app.
 *
 * Uses notifyListeners(..., retainUntilConsumed = true) rather than a raw
 * evaluateJavascript() call: on a cold start via the share sheet, the event
 * can fire before the WebView has finished loading index.html/app.js, so a
 * fire-and-forget JS call is silently lost. retainUntilConsumed queues the
 * event natively until the JS side actually calls addListener(), which is
 * the same pattern Capacitor's own App plugin uses for cold-start deep links.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class SharePlugin extends Plugin {
  public void deliverSharedPlace(JSObject payload) {
    notifyListeners("sharedPlace", payload, true);
  }
}
