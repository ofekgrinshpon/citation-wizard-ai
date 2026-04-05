/**
 * SafeStorage — a localStorage wrapper that falls back to an in-memory Map
 * when localStorage is blocked (e.g. cross-origin iframes in Word Online).
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function isLocalStorageAvailable(): boolean {
  try {
    const testKey = "__safe_storage_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export const safeStorage: Storage = isLocalStorageAvailable()
  ? window.localStorage
  : new MemoryStorage();

/**
 * Patches window.localStorage with a memory fallback if blocked.
 * Call this as early as possible (before any library reads localStorage).
 */
export function shimLocalStorageIfNeeded() {
  if (!isLocalStorageAvailable()) {
    console.warn("[ReLex] localStorage blocked (iframe?), using in-memory fallback");
    try {
      Object.defineProperty(window, "localStorage", {
        value: new MemoryStorage(),
        writable: true,
        configurable: true,
      });
    } catch {
      console.warn("[ReLex] Could not shim localStorage");
    }
  }
}
