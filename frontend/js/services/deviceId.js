const STORAGE_KEY = 'nearfield.deviceId';
let cached = null;

export function getDeviceId() {
  if (cached) return cached;
  cached = localStorage.getItem(STORAGE_KEY);
  if (!cached) {
    cached = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, cached);
  }
  return cached;
}
