package com.livium888.scotlandtrip;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;

/**
 * Turns the text Google Maps puts on the clipboard/share sheet into a usable
 * place: name, description, image and coordinates.
 *
 * The share text is typically a single line mixing a label and a short link
 * ("Check out Edinburgh Castle https://maps.app.goo.gl/xyz"), so the name
 * can't be recovered by splitting lines. Instead the link is followed and the
 * resulting page's Open Graph tags are read, which is where Maps puts the
 * real place title. Coordinates still come from the resolved URL, since the
 * page markup doesn't carry them.
 *
 * Runs on a background thread - Jsoup performs blocking network I/O.
 */
final class MapsPlaceResolver {

  private static final String USER_AGENT =
    "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

  private static final int TIMEOUT_MS = 15000;

  private static final Pattern URL_PATTERN = Pattern.compile("https?://\\S+");
  private static final Pattern COORD_PATTERN = Pattern.compile("@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)");
  // Fallback for resolved links that carry the point as a query parameter
  // (e.g. "?q=55.9486,-3.1999") rather than the usual "@lat,lng" path form.
  private static final Pattern QUERY_COORD_PATTERN = Pattern.compile("[?&](?:q|ll|center)=(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)");

  static final class Place {
    String title;
    String description;
    String imageUrl;
    Double latitude;
    Double longitude;
    String originalUrl;
    String resolvedUrl;
  }

  private MapsPlaceResolver() {}

  static String extractUrl(String sharedText) {
    if (sharedText == null) return null;
    Matcher m = URL_PATTERN.matcher(sharedText);
    if (!m.find()) return null;
    // Trailing punctuation is common when the link ends a sentence.
    return m.group().replaceAll("[.,)\\]]+$", "");
  }

  static Place resolve(String url) throws Exception {
    Place place = new Place();
    place.originalUrl = url;
    place.resolvedUrl = url;

    Document doc = Jsoup
      .connect(url)
      .userAgent(USER_AGENT)
      .followRedirects(true)
      .timeout(TIMEOUT_MS)
      .get();

    if (doc.location() != null) place.resolvedUrl = doc.location();

    place.title = cleanTitle(firstNonEmpty(metaContent(doc, "meta[property=og:title]"), doc.title()));
    place.description =
      firstNonEmpty(metaContent(doc, "meta[property=og:description]"), metaContent(doc, "meta[name=description]"));
    place.imageUrl =
      firstNonEmpty(metaContent(doc, "meta[property=og:image]"), metaContent(doc, "meta[name=twitter:image]"));

    applyCoordinates(place);
    return place;
  }

  private static void applyCoordinates(Place place) {
    for (String candidate : new String[] { place.resolvedUrl, place.originalUrl }) {
      if (candidate == null) continue;
      for (Pattern pattern : new Pattern[] { COORD_PATTERN, QUERY_COORD_PATTERN }) {
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

  private static String metaContent(Document doc, String selector) {
    org.jsoup.nodes.Element el = doc.selectFirst(selector);
    return el == null ? null : el.attr("content");
  }

  private static String cleanTitle(String title) {
    if (title == null) return null;
    String cleaned = title.replaceAll("\\s*[-–]\\s*Google Maps\\s*$", "").trim();
    return cleaned.isEmpty() ? null : cleaned;
  }

  private static String firstNonEmpty(String... values) {
    for (String v : values) {
      if (v != null && !v.trim().isEmpty()) return v.trim();
    }
    return null;
  }
}
