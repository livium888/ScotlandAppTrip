package com.livium888.scotlandtrip;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A language model living on the phone rather than behind an API key.
 *
 * The point of it is that the app can plan a day, estimate a budget and
 * suggest a trip with no key, no cost, no signal and nothing leaving the
 * device. What it cannot do is search the web, so it cannot find events -
 * the JavaScript side knows that and refuses rather than letting a model
 * answer that question from memory.
 *
 * Three of the four methods here are plain Java and carry no risk: status,
 * download and remove. generate() needs a native inference engine, and this
 * class works without one - it reports that it has none rather than failing
 * to load. That is deliberate: it keeps the APK building while the engine is
 * added separately, and it means a build without the engine degrades to
 * "this provider is not available" instead of crashing.
 */
@CapacitorPlugin(name = "LocalModel")
public class LocalModelPlugin extends Plugin {

  private static final String TAG = "LocalModel";
  private static final String DIR = "models";

  /** Downloads are long; the bridge thread is not the place for them. */
  private final ExecutorService io = Executors.newSingleThreadExecutor();

  /** Whether a native inference engine was linked into this build. */
  private static boolean engineAvailable = false;

  static {
    try {
      System.loadLibrary("wayfare_llm");
      engineAvailable = true;
    } catch (Throwable t) {
      // Expected in any build without the engine. Not an error: the app asks
      // before it calls, and answers "no model" rather than breaking.
      Log.i(TAG, "No local inference engine in this build");
    }
  }

  private File modelsDir() {
    File dir = new File(getContext().getFilesDir(), DIR);
    if (!dir.exists()) dir.mkdirs();
    return dir;
  }

  /** The single model file, whatever it is called. One at a time on purpose. */
  private File currentModel() {
    File[] files = modelsDir().listFiles();
    if (files == null) return null;
    for (File f : files) {
      if (f.isFile() && f.getName().endsWith(".gguf")) return f;
    }
    return null;
  }

  @PluginMethod
  public void status(PluginCall call) {
    File model = currentModel();
    JSObject out = new JSObject();
    out.put("present", model != null && engineAvailable);
    // Said separately, because "there is a file but this build cannot run it"
    // is a different problem from "there is no file", and telling somebody to
    // download a gigabyte that will not run would be worse than useless.
    out.put("engine", engineAvailable);
    out.put("file", model != null);
    if (model != null) {
      out.put("name", model.getName());
      out.put("bytes", model.length());
    }
    call.resolve(out);
  }

  @PluginMethod
  public void download(final PluginCall call) {
    final String url = call.getString("url");
    final String name = call.getString("name");
    if (url == null || name == null || !name.endsWith(".gguf")) {
      call.reject("Need a url and a .gguf name");
      return;
    }
    io.execute(() -> {
      // Into a part file first: a download interrupted halfway through must
      // not leave something that looks like a usable model.
      File target = new File(modelsDir(), name);
      File part = new File(modelsDir(), name + ".part");
      HttpURLConnection conn = null;
      try {
        // One at a time - two models is two gigabytes of nobody's benefit.
        File existing = currentModel();
        if (existing != null && !existing.getName().equals(name)) existing.delete();

        conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(60000);
        conn.connect();
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) {
          call.reject("The download server answered " + code);
          return;
        }
        long total = conn.getContentLengthLong();
        long done = 0;
        long lastReport = 0;
        try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
          byte[] buf = new byte[1 << 16];
          int n;
          while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            done += n;
            // Roughly every megabyte rather than every chunk: a progress
            // event per 64KB is tens of thousands of bridge crossings.
            if (done - lastReport > (1 << 20)) {
              lastReport = done;
              JSObject p = new JSObject();
              p.put("done", done);
              p.put("total", total);
              notifyListeners("modelProgress", p);
            }
          }
        }
        if (!part.renameTo(target)) {
          part.delete();
          call.reject("Couldn't finish writing the model");
          return;
        }
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("name", name);
        out.put("bytes", target.length());
        call.resolve(out);
      } catch (Throwable t) {
        part.delete();
        call.reject("Download failed: " + t.getMessage(), t);
      } finally {
        if (conn != null) conn.disconnect();
      }
    });
  }

  @PluginMethod
  public void remove(PluginCall call) {
    File model = currentModel();
    boolean gone = model == null || model.delete();
    JSObject out = new JSObject();
    out.put("ok", gone);
    call.resolve(out);
  }

  @PluginMethod
  public void generate(final PluginCall call) {
    final String prompt = call.getString("prompt");
    if (prompt == null) {
      call.reject("No prompt");
      return;
    }
    final File model = currentModel();
    if (model == null) {
      call.reject("There is no model on this phone yet");
      return;
    }
    if (!engineAvailable) {
      call.reject("This build has no inference engine");
      return;
    }
    final int maxTokens = call.getInt("maxTokens", 0);
    io.execute(() -> {
      try {
        String text = nativeGenerate(model.getAbsolutePath(), prompt, maxTokens > 0 ? maxTokens : 2048);
        JSObject out = new JSObject();
        out.put("text", text == null ? "" : text);
        // Token counts come back from the engine when it has them; zero is
        // honest rather than a guess, and the usage screen shows what it is
        // told rather than estimating.
        out.put("inTokens", nativeLastPromptTokens());
        out.put("outTokens", nativeLastOutputTokens());
        call.resolve(out);
      } catch (Throwable t) {
        call.reject("The model on this phone couldn't answer: " + t.getMessage(), t);
      }
    });
  }

  private static native String nativeGenerate(String modelPath, String prompt, int maxTokens);

  private static native int nativeLastPromptTokens();

  private static native int nativeLastOutputTokens();
}
