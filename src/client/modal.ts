const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Keep the native dialog's focus trap and restoration throughout its transition. */
export function createModal(dialog: HTMLDialogElement, { dismissOnBackdrop = false } = {}) {
  let transition: Animation | null = null;
  let closing = false;
  let pointerStartedOutside = false;

  function finishClose(): void {
    transition?.cancel(); transition = null;
    dialog.close();
    dialog.classList.remove('is-closing'); closing = false; pointerStartedOutside = false;
  }

  function open(focus: HTMLElement): void {
    if (dialog.open) return;
    dialog.showModal(); focus.focus({ preventScroll: true });
    if (!reducedMotion.matches) {
      transition = dialog.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 160, easing: 'ease-out' });
    }
  }

  function close(): void {
    if (!dialog.open || closing) return;
    if (reducedMotion.matches) { finishClose(); return; }
    closing = true;
    const current = getComputedStyle(dialog);
    const from = { opacity: current.opacity, transform: current.transform };
    transition?.cancel();
    dialog.classList.add('is-closing');
    transition = dialog.animate([from, { opacity: 0, transform: 'translateY(6px)' }], {
      duration: 120, easing: 'ease-in', fill: 'forwards',
    });
    void transition.finished.then(finishClose).catch(() => {});
  }

  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  if (dismissOnBackdrop) {
    const outside = (event: MouseEvent): boolean => {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    dialog.addEventListener('pointerdown', event => {
      pointerStartedOutside = event.target === dialog && outside(event);
    });
    dialog.addEventListener('pointercancel', () => { pointerStartedOutside = false; });
    dialog.addEventListener('click', event => {
      const dismiss = pointerStartedOutside && event.target === dialog && outside(event);
      pointerStartedOutside = false;
      if (!dismiss) return;
      // Keep this click in the top layer, including when reduced motion closes immediately.
      event.preventDefault(); event.stopPropagation(); close();
    });
  }
  dialog.addEventListener('close', () => {
    transition?.cancel(); transition = null;
    dialog.classList.remove('is-closing'); closing = false; pointerStartedOutside = false;
  });
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    if (closing) finishClose();
    else { transition?.cancel(); transition = null; }
  });
  return { open, close };
}
