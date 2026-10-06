/** One decoded private WebP, shared between the normal-flow hero and chat atmosphere. */
export function createArtwork(slot: HTMLElement, scene: HTMLElement, url?: string): {
  changeView: (view: 'landing' | 'chat', updateLayout: () => void) => Promise<boolean>;
} {
  const surface = document.createElement('div'); surface.className = 'artwork'; surface.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img'); image.className = 'portrait';
  image.alt = ''; image.draggable = false; image.crossOrigin = 'anonymous';
  image.width = image.height = 3000; image.decoding = 'async'; image.fetchPriority = 'high';
  surface.append(image); slot.append(surface);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let view: 'landing' | 'chat' = 'landing';
  let motion: Animation | undefined;
  let complete: ((settled: boolean) => void) | undefined;
  let completion: Promise<boolean> | undefined;
  let ready = false;
  const settle = (settled = true): void => {
    motion?.cancel(); motion = undefined;
    if (surface.classList.contains('is-transitioning')) {
      surface.classList.remove('is-transitioning'); surface.removeAttribute('style');
      (view === 'chat' ? scene : slot).append(surface);
    }
    const notify = complete; complete = undefined; completion = undefined; notify?.(settled);
  };
  reduced.addEventListener('change', () => settle());
  window.addEventListener('resize', () => settle());

  image.onload = async () => {
    try {
      await image.decode(); ready = true; surface.classList.add('is-ready'); slot.classList.add('is-ready');
      if (!reduced.matches) {
        motion = surface.animate([{ opacity: 0 }, { opacity: getComputedStyle(surface).opacity }], { duration: 360, easing: 'ease-out' });
      }
    } catch { image.hidden = true; }
  };
  image.onerror = () => { settle(); image.hidden = true; };
  if (url) image.src = url;

  return {
    changeView(next, updateLayout) {
      if (next === view) { updateLayout(); return completion ?? Promise.resolve(true); }
      // Capture the current visual pose, including an interrupted transition.
      const transitioning = surface.classList.contains('is-transitioning');
      const before = surface.getBoundingClientRect(); const style = getComputedStyle(surface);
      const opacity = style.opacity;
      const maskSize = style.maskSize;
      // Filters scale with the surface: preserve the perceived blur when reversing.
      const radius = style.filter === 'none' ? 0 : parseFloat(style.filter.slice(5));
      const blur = radius * (transitioning ? before.width / surface.offsetWidth : 1);
      const crop = (rect: DOMRect, region: DOMRect): string => `inset(0 0 ${Math.min(1, Math.max(0, rect.bottom - region.bottom) / rect.height) * 100}% 0)`;
      const beforeCrop = transitioning ? style.clipPath : view === 'landing' ? crop(before, slot.getBoundingClientRect()) : 'inset(0 0 0% 0)';
      settle(false); view = next; (next === 'chat' ? scene : slot).append(surface); updateLayout();
      if (!ready || reduced.matches || !before.width) return Promise.resolve(true);
      const after = surface.getBoundingClientRect(); const target = getComputedStyle(surface);
      const end = { opacity: target.opacity, filter: target.filter, maskSize: target.maskSize };
      const scale = before.width / after.width;
      const filter = `blur(${blur / scale}px)`;
      const from = `matrix(${scale}, 0, 0, ${scale}, ${before.x - after.x}, ${before.y - after.y})`;
      // Interpolate only the source-bottom crop; never introduce viewport side/top edges.
      const sourceCrop = next === 'landing' ? crop(after, slot.getBoundingClientRect()) : 'inset(0 0 0% 0)';
      // One source-sized transparent surface owns the complete transition. Keep it in
      // the scene until finished, so neither destination container can clip it early.
      scene.append(surface); surface.classList.add('is-transitioning');
      Object.assign(surface.style, { position: 'fixed', inset: 'auto', left: `${after.x}px`, top: `${after.y}px`,
        width: `${after.width}px`, height: `${after.height}px`, opacity: end.opacity, filter: end.filter,
        maskSize: end.maskSize, clipPath: sourceCrop });
      // The same group owns light and image in every state. All presentation properties
      // follow one progress curve; settling only removes the temporary geometry.
      motion = surface.animate([
        { transform: from, opacity, filter, maskSize, clipPath: beforeCrop, offset: 0 },
        { transform: 'none', ...end, clipPath: sourceCrop, offset: 1 },
      ], { duration: 620, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' });
      const current = motion;
      const finished = new Promise<boolean>(resolve => { complete = resolve; });
      completion = finished;
      void current.finished.then(() => { if (motion === current) settle(); }).catch(() => {});
      // External cancellation must also settle geometry and release navigation.
      current.oncancel = () => { if (motion === current) settle(); };
      return finished;
    },
  };
}
