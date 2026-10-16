// Mesin simpan otomatis generik (catatan dan desain memakainya).
// - Perubahan terakhir selalu menang; simpan berjalan berurutan (tidak pernah tumpang tindih).
// - Draf pemulihan ditulis cepat; berkas utama ditulis dengan jeda (debounce).
// - Jika gagal: status "error", data tetap aman di memori + draf, dicoba lagi otomatis.

export class Saver {
  /**
   * @param api   { writeItem(id, content, extra), writeDraft(id, content), clearDraft(id) }
   * @param getExtra () => argumen tambahan untuk writeItem (mis. thumbnail desain)
   */
  constructor({ api, id, content, autosaveMs = 1200, draftMs = 300, retryMs = 5000, getExtra = null, onState = () => {}, onSaved = () => {} }) {
    this.api = api;
    this.id = id;
    this.content = content;
    this.saved = content;
    this.autosaveMs = autosaveMs;
    this.draftMs = draftMs;
    this.retryMs = retryMs;
    this.getExtra = getExtra;
    this.onState = onState;
    this.onSaved = onSaved;
    this.state = 'saved';
    this.saving = null;
    this.saveTimer = null;
    this.draftTimer = null;
    this.retryTimer = null;
    this.draftWritten = false;
    this.disposed = false;
    this.lastError = null;
  }

  _setState(state, message) {
    this.state = state;
    this.lastError = state === 'error' ? message : null;
    this.onState({ state, message });
  }

  get dirty() { return this.content !== this.saved; }

  setContent(text) {
    if (this.disposed) return;
    this.content = text;
    if (!this.dirty) {
      clearTimeout(this.saveTimer); clearTimeout(this.draftTimer);
      if (this.state !== 'saving') this._setState('saved');
      return;
    }
    if (this.state !== 'saving') this._setState(this.state === 'error' ? 'error' : 'dirty', this.lastError);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.save(); }, this.autosaveMs);
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this._writeDraft(), this.draftMs);
  }

  _writeDraft() {
    if (this.disposed || !this.dirty) return;
    const snapshot = this.content;
    this.draftWritten = true;
    Promise.resolve(this.api.writeDraft(this.id, snapshot)).catch(() => { /* draf gagal tidak fatal */ });
  }

  /** Menyimpan sekarang. Mengembalikan true jika berhasil / tidak ada yang perlu disimpan. */
  save() {
    if (this.saving) return this.saving;
    this.saving = this._runSave().finally(() => { this.saving = null; });
    return this.saving;
  }

  async _runSave() {
    clearTimeout(this.saveTimer);
    clearTimeout(this.retryTimer);
    while (this.dirty && !this.disposed) {
      const snapshot = this.content;
      this._setState('saving');
      try {
        const extra = this.getExtra ? this.getExtra() : undefined;
        const meta = await this.api.writeItem(this.id, snapshot, extra);
        this.saved = snapshot;
        this.onSaved(meta, snapshot);
      } catch (e) {
        this._setState('error', e && e.message ? e.message : 'Gagal menyimpan.');
        if (!this.disposed) this.retryTimer = setTimeout(() => { this.save(); }, this.retryMs);
        return false;
      }
    }
    if (!this.disposed) {
      clearTimeout(this.draftTimer);
      if (this.draftWritten) { this.draftWritten = false; Promise.resolve(this.api.clearDraft(this.id)).catch(() => {}); }
      this._setState('saved');
    }
    return true;
  }

  /** Dipanggil sebelum pindah dokumen / menutup aplikasi. */
  async flush() {
    clearTimeout(this.saveTimer);
    clearTimeout(this.draftTimer);
    if (this.saving) await this.saving;
    if (this.dirty) return this.save();
    return true;
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.saveTimer); clearTimeout(this.draftTimer); clearTimeout(this.retryTimer);
  }
}
