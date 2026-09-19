package com.livium888.scotlandtrip;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * Turns what Google Maps puts on the share sheet into a usable place.
 *
 * Ordered by how trustworthy each source is, because scraping Google is the
 * least reliable part of this:
 *
 *  1. The share text itself (EXTRA_SUBJECT / the non-URL lines). The Maps app
 *     hands us the place name for free - no network, nothing to be blocked by.
 *  2. The resolved URL, obtained by following redirects and reading only the
 *     Location headers. Redirects aren't gated by the cookie-consent wall, so
 *     this keeps working where fetching the page body does not.
 *  3. Open Graph tags from the page body - last resort. In the EU/UK, Google
 *     answers with a consent interstitial ("Before you continue to Google
 *     Maps"), so anything scraped here is rejected unless it looks like a
 *     real place name.
 */
final class MapsPlaceResolver {

  private static final String USER_AGENT =
    "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

  private static final int TIMEOUT_MS = 15000;
  private static final int MAX_HOPS = 6;

  private static final Pattern URL_PATTERN = Pattern.compile("https?://\\S+");

  // "@lat,lng" in the path - the classic /maps/place/Name/@55.9,-3.1 form.
  private static final Pattern AT_COORD_PATTERN = Pattern.compile("@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)");
  // "!3d<lat>!4d<lng>" inside the data= blob, which resolved place links
  // carry even when the @ form is absent.
  private static final Pattern DATA_COORD_PATTERN = Pattern.compile("!3d(-?\\d+\\.\\d+)!4d(-?\\d+\\.\\d+)");
  // "?q=lat,lng" / "ll=" / "center=" query forms.
  private static final Pattern QUERY_COORD_PATTERN = Pattern.compile("[?&](?:q|ll|center|daddr)=(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)");
  // "/maps/place/The+Name/" - the name Google itself put in the resolved URL.
  private static final Pattern PLACE_NAME_PATTERN = Pattern.compile("/maps/place/([^/@?]+)");
  // Google's own id for the place, as "!1s0x<feature>:0x<cid>" in the data
  // blob or "ftid=0x<feature>:0x<cid>" in the query. The second half is the
  // CID, which addresses the exact place - no name guessing.
  private static final Pattern CID_PATTERN = Pattern.compile("(?:!1s|ftid=)0x[0-9a-fA-F]+:0x([0-9a-fA-F]+)");
  private static final Pattern EXISTING_CID_PATTERN = Pattern.compile("[?&]cid=(\\d+)");

  // Titles that mean "you got an interstitial, not a place".
  private static final Pattern INTERSTITIAL_TITLE = Pattern.compile(
    "(?i)^(before you continue|sign in|consent|google maps|redirecting|error)\\b.*"
  );

  static final class Place {
    String title;
    String description;
    String imageUrl;
    Double latitude;
    Double longitude;
    String originalUrl;
    String resolvedUrl;
    /** Canonical "?cid=" link to this exact place on Google Maps, if known. */
    String googleUrl;
    /** Set when the page fetch was blocked/consent-walled - for diagnostics. */
    String scrapeNote;
  }

  private MapsPlaceResolver() {}

  static String extractUrl(String sharedText) {
    if (sharedText == null) return null;
    Matcher m = URL_PATTERN.matcher(sharedText);
    if (!m.find()) return null;
    // Trailing punctuation is common when the link ends a sentence.
    return m.group().replaceAll("[.,)\\]]+$", "");
  }

  /**
   * The place name as the Maps app itself gave it to us: the share subject if
   * present, otherwise the first line that isn't a URL. Costs nothing and
   * can't be blocked, so it's preferred over anything scraped.
   */
  static String nameFromShare(String subject, String sharedText) {
    String fromSubject = cleanName(subject);
    if (fromSubject != null) return fromSubject;

    if (sharedText == null) return null;
    for (String line : sharedText.split("\\r?\\n")) {
      // Drop any URL from the line rather than skipping the whole line -
      // Maps often puts the label and the link together on one line.
      String withoutUrls = URL_PATTERN.matcher(line).replaceAll("").trim();
      String cleaned = cleanName(withoutUrls);
      if (cleaned != null) return cleaned;
    }
    return null;
  }

  static Place resolve(String url) {
    Place place = new Place();
    place.originalUrl = url;
    place.resolvedUrl = followRedirects(url);

    applyCoordinates(place);
    applyNameFromUrl(place);
    applyGoogleUrl(place);
    tryScrapeMetadata(place);
    return place;
  }

  /**
   * Builds the canonical "maps?cid=" link, which opens the exact place Google
   * had in mind rather than a name search that can land on the wrong one.
   *
   * The CID is an unsigned 64-bit value and routinely exceeds Long.MAX_VALUE,
   * so it has to be parsed and printed unsigned - signed parsing throws on
   * roughly half of all real ids.
   */
  private static void applyGoogleUrl(Place place) {
    for (String candidate : new String[] { place.resolvedUrl, place.originalUrl }) {
      if (candidate == null) continue;

      Matcher existing = EXISTING_CID_PATTERN.matcher(candidate);
      if (existing.find()) {
        place.googleUrl = "https://www.google.com/maps?cid=" + existing.group(1);
        return;
      }

      Matcher m = CID_PATTERN.matcher(candidate);
      if (m.find()) {
        try {
          long cid = Long.parseUnsignedLong(m.group(1), 16);
          if (cid != 0) {
            place.googleUrl = "https://www.google.com/maps?cid=" + Long.toUnsignedString(cid);
            return;
          }
        } catch (NumberFormatException ignored) {
          // malformed id - fall through, the name search still works
        }
      }
    }
  }

  /**
   * Follows redirects reading only Location headers - never the body. The
   * consent wall is served as a page, so header-only redirect following
   * reaches the real /maps/place/... URL where a body fetch would not.
   */
  private static String followRedirects(String urlStr) {
    String current = urlStr;
    for (int i = 0; i < MAX_HOPS; i++) {
      HttpURLConnection conn = null;
      try {
        conn = (HttpURLConnection) new URL(current).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("User-Agent", USER_AGENT);
        // Pre-accepting consent stops Google bouncing us to the interstitial.
        conn.setRequestProperty("Cookie", "CONSENT=YES+cb; SOCS=CAI");
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);

        int code = conn.getResponseCode();
        if (code < 300 || code >= 400) return current;

        String location = conn.getHeaderField("Location");
        if (location == null || location.isEmpty()) return current;
        if (location.startsWith("/")) {
          URL base = new URL(current);
          location = base.getProtocol() + "://" + base.getHost() + location;
        }
        current = location;

        // A consent bounce carries the URL we actually wanted in ?continue=.
        String unwrapped = unwrapConsentUrl(current);
        if (unwrapped != null) return unwrapped;
      } catch (Exception e) {
        return current;
      } finally {
        if (conn != null) conn.disconnect();
      }
    }
    return current;
  }

  /** consent.google.com/...?continue=<encoded real url> -> the real url. */
  private static String unwrapConsentUrl(String url) {
    if (url == null || !url.contains("consent.google.")) return null;
    Matcher m = Pattern.compile("[?&]continue=([^&]+)").matcher(url);
    if (!m.find()) return null;
    try {
      return URLDecoder.decode(m.group(1), "UTF-8");
    } catch (Exception e) {
      return null;
    }
  }

  private static void applyCoordinates(Place place) {
    for (String candidate : new String[] { place.resolvedUrl, place.originalUrl }) {
      if (candidate == null) continue;
      for (Pattern pattern : new Pattern[] { AT_COORD_PATTERN, DATA_COORD_PATTERN, QUERY_COORD_PATTERN }) {
        Matcher m = pattern.matcher(candidate);
        if (m.find()) {
          try {
            place.latitude = Double.parseDouble(m.group(1));
            place.longitude = Double.parseDouble(m.group(2));
            return;
          } catch (NumberFormatException ignored) {
            // keep looking
          }
        }
      }
    }
  }

  private static void applyNameFromUrl(Place place) {
    if (place.resolvedUrl == null) return;
    Matcher m = PLACE_NAME_PATTERN.matcher(place.resolvedUrl);
    if (!m.find()) return;
    try {
      place.title = cleanName(URLDecoder.decode(m.group(1), "UTF-8").replace('+', ' '));
    } catch (Exception ignored) {
      // leave the title unset; the share text still supplies one
    }
  }

  /**
   * Best-effort only. Fills in description/image, and a title if one wasn't
   * recovered already, but never lets a consent/interstitial page masquerade
   * as the place.
   */
  private static void tryScrapeMetadata(Place place) {
    String target = place.resolvedUrl != null ? place.resolvedUrl : place.originalUrl;
    if (target == null) return;

    try {
      Document doc = Jsoup
        .connect(target)
        .userAgent(USER_AGENT)
        .cookie("CONSENT", "YES+cb")
        .cookie("SOCS", "CAI")
        .followRedirects(true)
        .timeout(TIMEOUT_MS)
        .get();

      String scrapedTitle = cleanTitle(firstNonEmpty(metaContent(doc, "meta[property=og:title]"), doc.title()));
      if (isInterstitial(scrapedTitle)) {
        place.scrapeNote = "consent/interstitial page";
        return;
      }

      if (place.title == null) place.title = scrapedTitle;
      place.description =
        firstNonEmpty(metaContent(doc, "meta[property=og:description]"), metaContent(doc, "meta[name=description]"));
      place.imageUrl =
        firstNonEmpty(metaContent(doc, "meta[property=og:image]"), metaContent(doc, "meta[name=twitter:image]"));
    } catch (IOException e) {
      place.scrapeNote = "fetch failed: " + e.getClass().getSimpleName();
    } catch (Exception e) {
      place.scrapeNote = "parse failed: " + e.getClass().getSimpleName();
    }
  }

  static boolean isInterstitial(String title) {
    return title == null || INTERSTITIAL_TITLE.matcher(title.trim()).matches();
  }

  private static String metaContent(Document doc, String selector) {
    Element el = doc.selectFirst(selector);
    return el == null ? null : el.attr("content");
  }

  private static String cleanTitle(String title) {
    if (title == null) return null;
    String cleaned = title.replaceAll("\\s*[-–]\\s*Google Maps\\s*$", "").trim();
    return cleaned.isEmpty() ? null : cleaned;
  }

  /**
   * Trims a name candidate and rejects the boilerplate Maps wraps around it,
   * so "Check out Edinburgh Castle" becomes "Edinburgh Castle".
   */
  private static String cleanName(String value) {
    if (value == null) return null;
    String cleaned = value.trim();
    cleaned = cleaned.replaceAll("(?i)^(check out|take a look at|see)\\s+", "");
    cleaned = cleaned.replaceAll("(?i)\\s+on google maps[.!]?$", "");
    cleaned = cleaned.replaceAll("^[\"'\\s]+|[\"'\\s]+$", "");
    if (cleaned.isEmpty()) return null;
    if (isInterstitial(cleaned)) return null;
    return cleaned;
  }

  private static String firstNonEmpty(String... values) {
    for (String v : values) {
      if (v != null && !v.trim().isEmpty()) return v.trim();
    }
    return null;
  }
}
