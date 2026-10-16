// Pemancar event sederhana untuk komunikasi antar modul.
const handlers = new Map();

export const bus = {
  on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => handlers.get(event).delete(fn);
  },
  emit(event, data) {
    const set = handlers.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(data); } catch (e) { console.error(`Handler untuk "${event}" gagal:`, e); }
    }
  },
};
