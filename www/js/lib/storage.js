// The one keeper of what is saved on the phone.
//
// Every part of the app used to reach into localStorage by itself. A guarded
// write and a forgiving read existed, but a handful of places went around
// them, so what to do when the phone is full, or a saved value is damaged,
// was decided in several places and honoured in some. Everything goes through
// here now, and the rules are written once.
//
// The backend is passed in rather than assumed, so the rules can be tested in
// Node against a pretend phone that fills up or refuses to answer.

export function isQuotaError(e) {
  if (!e) return false;
  // Different browsers name it differently, and Safari's is a number.
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

// Derived data with a shelf life: a forecast, a coordinate lookup, the last
// few searches. All of it can be fetched again; none of it is anything
// somebody typed. Named here rather than imported, because a quota failure
// during the very first load happens before the rest of the app has set up
// its own constants. The names do not change.
export const DEFAULT_EXPENDABLE = ["weather-cache-v1", "destination-coords-v1", "recent-searches-v1"];

export function createStorage({
  backend = globalThis.localStorage,
  // Called once, the first time a write cannot be made to fit.
  onFull = () => {},
  // Called before every write, successful or not: a render pass that has
  // cached something read from here must drop it, because a cache that can
  // serve a stale value is worse than none.
  onWrite = () => {},
  expendable = DEFAULT_EXPENDABLE,
} = {}) {
  let told = false;

  function read(key) {
    try {
      return backend.getItem(key);
    } catch {
      // Storage can be blocked outright; the app behaves as if nothing was saved.
      return null;
    }
  }

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(backend.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function remove(key) {
    try {
      backend.removeItem(key);
    } catch {
      /* nothing to forget if storage cannot be reached */
    }
  }

  function removeMany(keys) {
    keys.forEach(remove);
  }

  function makeRoom() {
    let freed = false;
    expendable.forEach((k) => {
      if (read(k) !== null) {
        remove(k);
        freed = true;
      }
    });
    return freed;
  }

  // Answers whether the write actually happened, so a caller that cares can
  // ask. Most do not, and for those the point is that the app keeps working
  // and says out loud, once, that this one did not save.
  function write(key, value) {
    onWrite();
    try {
      backend.setItem(key, value);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      // One attempt at making room, then one honest retry.
      if (makeRoom()) {
        try {
          backend.setItem(key, value);
          return true;
        } catch (again) {
          if (!isQuotaError(again)) throw again;
        }
      }
      if (!told) {
        told = true;
        onFull();
      }
      return false;
    }
  }

  return { read, readJson, write, remove, removeMany };
}
