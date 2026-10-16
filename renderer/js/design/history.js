// Riwayat undo/redo berbasis snapshot string dengan batas jumlah dan batas memori.

export class History {
  constructor({ limit = 100, budgetChars = 40 * 1024 * 1024 } = {}) {
    this.limit = limit;
    this.budget = budgetChars;
    this.stack = [];
    this.index = -1;
    this.lastKey = null;
    this.lastTs = 0;
  }

  reset(snapshot) {
    this.stack = [snapshot];
    this.index = 0;
    this.lastKey = null;
    this.lastTs = 0;
  }

  current() { return this.stack[this.index]; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.stack.length - 1; }

  /** key: perubahan berurutan dengan key sama dalam 800 ms digabung menjadi satu langkah undo. */
  push(snapshot, key = null, now = Date.now()) {
    if (snapshot === this.current()) return false;
    this.stack.length = this.index + 1; // buang cabang redo
    const merge = key && key === this.lastKey && now - this.lastTs < 800 && this.index > 0;
    if (merge) this.stack[this.index] = snapshot;
    else { this.stack.push(snapshot); this.index++; }
    this.lastKey = key;
    this.lastTs = now;
    this._trim();
    return true;
  }

  _trim() {
    let total = 0;
    for (const s of this.stack) total += s.length;
    while (this.stack.length > 1 && (this.stack.length > this.limit || total > this.budget)) {
      total -= this.stack[0].length;
      this.stack.shift();
      this.index--;
    }
    if (this.index < 0) this.index = 0;
  }

  undo() {
    if (!this.canUndo) return null;
    this.index--;
    this.lastKey = null;
    return this.stack[this.index];
  }

  redo() {
    if (!this.canRedo) return null;
    this.index++;
    this.lastKey = null;
    return this.stack[this.index];
  }

  get size() { return this.stack.length; }
}
