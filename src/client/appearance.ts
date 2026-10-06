export const APPEARANCE_KEY = 'mikiru.appearance';
export type AppearancePreference = 'system' | 'light' | 'dark';
export type AppearanceMode = Exclude<AppearancePreference, 'system'>;
type AppearanceStorage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SystemAppearance = Pick<MediaQueryList, 'matches' | 'addEventListener'>;

function preference(value: string | null): AppearancePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Presentation only: never enters a chat request or committed character state. */
export class Appearance {
  private choice: AppearancePreference = 'system';
  constructor(private readonly storage: AppearanceStorage, private readonly system: SystemAppearance,
    private readonly apply: (mode: AppearanceMode) => void) {
    this.refresh();
    system.addEventListener('change', () => { if (this.choice === 'system') this.apply(this.resolved); });
  }
  get preference(): AppearancePreference { return this.choice; }
  get resolved(): AppearanceMode { return this.choice === 'system' ? (this.system.matches ? 'dark' : 'light') : this.choice; }
  refresh(): void {
    try { this.choice = preference(this.storage.getItem(APPEARANCE_KEY)); }
    catch { this.choice = 'system'; }
    this.apply(this.resolved);
  }
  setPreference(value: AppearancePreference): boolean {
    if (!['system', 'light', 'dark'].includes(value)) return false;
    this.choice = value; this.apply(this.resolved);
    try {
      if (value === 'system') this.storage.removeItem(APPEARANCE_KEY);
      else this.storage.setItem(APPEARANCE_KEY, value);
      return true;
    } catch { return false; }
  }
}

export function applyAppearance(mode: AppearanceMode): void {
  document.documentElement.dataset.appearance = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#000000' : '#ffe0e0');
}
