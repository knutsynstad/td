export class TrackedMap<V> extends Map<string, V> {
  private _upserted = new Set<string>();
  private _removed = new Set<string>();

  override set(key: string, value: V): this {
    this._upserted.add(key);
    this._removed.delete(key);
    return super.set(key, value);
  }

  override delete(key: string): boolean {
    if (super.has(key)) {
      if (!this._upserted.delete(key)) {
        this._removed.add(key);
      }
    }
    return super.delete(key);
  }

  override clear(): void {
    for (const key of this.keys()) {
      this._removed.add(key);
    }
    this._upserted.clear();
    super.clear();
  }

  get upserted(): ReadonlySet<string> {
    return this._upserted;
  }

  get removed(): ReadonlySet<string> {
    return this._removed;
  }

  get hasChanges(): boolean {
    return this._upserted.size > 0 || this._removed.size > 0;
  }

  resetTracking(): void {
    this._upserted.clear();
    this._removed.clear();
  }

  static fromRecord<V>(record: Record<string, V>): TrackedMap<V> {
    const map = new TrackedMap<V>();
    for (const [key, value] of Object.entries(record)) {
      super.prototype.set.call(map, key, value);
    }
    return map;
  }

  toRecord(): Record<string, V> {
    const record: Record<string, V> = {};
    for (const [key, value] of this.entries()) {
      record[key] = value;
    }
    return record;
  }
}
