const KEY = 'mikiru.settings';
type SettingsStorage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

// UI preferences are separate from committed character state and transcript.
export class Settings {
  constructor(private readonly storage: SettingsStorage) {}
  get descriptions(): boolean {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(KEY) ?? 'null');
      return typeof value === 'object' && value !== null && 'descriptions' in value && value.descriptions === true;
    } catch { return false; }
  }
  setDescriptions(value: boolean): boolean {
    try { this.storage.setItem(KEY, JSON.stringify({ descriptions: value })); return true; }
    catch { return false; }
  }
}
export const SETTINGS_KEY = KEY;
