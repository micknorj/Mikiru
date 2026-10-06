import type { Snapshot } from '../shared/contracts.ts';

export type View = 'landing' | 'chat';
export type ArtworkNavigation = { changeView: (view: View, updateLayout: () => void) => Promise<boolean> };

/** Only the validated current-instance transcript counts; transient attempts are RAM-only. */
export function landingAction(state: Pick<Snapshot, 'turns'> | null): 'Start chatting' | 'Continue chatting' {
  return state?.turns.length ? 'Continue chatting' : 'Start chatting';
}

/** Navigation is ephemeral. A superseded artwork transition cannot reveal an old view. */
export class Navigation {
  private revision = 0;
  constructor(private readonly artwork: ArtworkNavigation, private readonly effects: {
    prepare: (view: View) => void;
    reveal: (view: View) => void;
  }) {}

  async show(view: View): Promise<void> {
    const revision = ++this.revision;
    const completed = await this.artwork.changeView(view, () => this.effects.prepare(view));
    if (completed && revision === this.revision) this.effects.reveal(view);
  }
}
