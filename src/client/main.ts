import './style.css';
import { Api } from './api.ts';
import { Controller } from './controller.ts';
import { MultiTab } from './multitab.ts';
import { Storage } from './storage.ts';
import { createModal } from './modal.ts';
import { Settings, SETTINGS_KEY } from './settings.ts';
import { createArtwork } from './artwork.ts';
import { Navigation, landingAction } from './navigation.ts';
import { Appearance, APPEARANCE_KEY, applyAppearance, type AppearancePreference } from './appearance.ts';

import { LIMITS } from '../shared/config.ts';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function button(className: string, text: string): HTMLButtonElement {
  const el = node('button', className, text); el.type = 'button'; return el;
}
const app = document.querySelector<HTMLElement>('#app')!;
const api = new Api();
const settings = new Settings({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
const appearance = new Appearance({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) }, matchMedia('(prefers-color-scheme: dark)'), applyAppearance);
const scene = node('div', 'scene'); scene.setAttribute('aria-hidden', 'true');
const artRegion = node('div', 'art-region');
const artSlot = node('div', 'art-slot');
const artwork = createArtwork(artSlot, scene, api.base ? new URL('api/art/mikiru', api.base).href : undefined);
artRegion.append(artSlot);
const landing = node('section', 'landing'); landing.setAttribute('aria-label', 'Mikiru');
const intro = node('div', 'intro');
intro.append(node('h1', 'brand landing-title', 'Mikiru.'));
const landingActions = node('div', 'landing-actions');
const enter = button('primary', 'Start chatting');
enter.disabled = true; enter.style.visibility = 'hidden'; enter.setAttribute('aria-busy', 'true');
const aboutButton = button('secondary', 'About');
landingActions.append(enter, aboutButton); intro.append(landingActions); landing.append(intro, artRegion);

const chat = node('section', 'chat'); chat.hidden = true;
const header = node('header', 'chat-header');
const chatTitle = node('h1');
const home = button('brand brand-home', 'Mikiru'); home.setAttribute('aria-label', 'Mikiru Home');
chatTitle.append(home); header.append(chatTitle);
const headerActions = node('div', 'header-actions'); header.append(headerActions);
const offline = node('span', 'offline', 'Offline'); offline.hidden = navigator.onLine; headerActions.append(offline);
const information = button('information-button', ''); information.setAttribute('aria-label', 'About Mikiru');
const informationIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
informationIcon.setAttribute('viewBox', '0 0 24 24'); informationIcon.setAttribute('aria-hidden', 'true');
for (const [tag, attributes] of [
  ['circle', { cx: '12', cy: '12', r: '9' }],
  ['path', { d: 'M12 11v6' }],
  ['circle', { cx: '12', cy: '7.5', r: '.8', fill: 'currentColor', stroke: 'none' }],
] as const) {
  const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
  informationIcon.append(shape);
}
information.append(informationIcon); headerActions.append(information);
const transcript = node('div', 'transcript'); transcript.setAttribute('role', 'log'); transcript.setAttribute('aria-live', 'polite'); transcript.setAttribute('aria-label', 'Conversation');
const bottom = node('div', 'bottom');
const status = node('p', 'status'); status.id = 'composer-status'; status.setAttribute('role', 'status');

const form = node('form', 'composer');
const inputWrap = node('div', 'input-wrap');
const inputArea = node('div', 'input-area');
const input = node('textarea', 'input'); input.placeholder = 'Say something…'; input.rows = 1; input.setAttribute('aria-label', 'Message');
input.setAttribute('aria-describedby', status.id);
// Do not truncate a pasted message silently. Report the full limit violation locally.
const send = node('button', 'send-button'); send.type = 'submit'; send.setAttribute('aria-label', 'Send'); send.title = 'Send';
const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
arrow.setAttribute('class', 'send-arrow'); arrow.setAttribute('viewBox', '0 0 24 24');
arrow.setAttribute('aria-hidden', 'true'); arrow.setAttribute('focusable', 'false');
const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
arrowPath.setAttribute('d', 'M12 19V5m-6 6 6-6 6 6'); arrow.append(arrowPath); send.append(arrow);
inputArea.append(input); inputWrap.append(inputArea, send); form.append(inputWrap);
bottom.append(status, form); chat.append(header, transcript, bottom);

const dialog = node('dialog', 'reset-dialog');
const dialogTitle = node('h2', '', 'Reset Mikiru?'); dialogTitle.id = 'reset-title'; dialog.setAttribute('aria-labelledby', dialogTitle.id);
const dialogCopy = node('p', '', "This clears your chat, Mikiru's memory, and your progress. This can't be undone.");
dialogCopy.id = 'reset-copy'; dialog.setAttribute('aria-describedby', dialogCopy.id);
const dialogActions = node('div', 'dialog-actions');
const cancelReset = button('secondary', 'Cancel');
const confirmReset = button('danger', 'Reset');
dialogActions.append(cancelReset, confirmReset); dialog.append(dialogTitle, dialogCopy, dialogActions);

const about = node('dialog', 'about-dialog');
const aboutSurface = node('div', 'about-surface');
const aboutHeader = node('div', 'about-header');
const aboutContent = node('div', 'about-content');
const aboutTitle = node('h2', '', 'About Mikiru'); aboutTitle.id = 'about-title'; about.setAttribute('aria-labelledby', aboutTitle.id);
const closeAbout = button('close-about', ''); closeAbout.setAttribute('aria-label', 'Close');
const closeIcon = node('span', 'close-icon'); closeIcon.setAttribute('aria-hidden', 'true'); closeAbout.append(closeIcon);
aboutHeader.append(aboutTitle, closeAbout);
const characterCopy = node('p', 'about-intro', 'Mikiru is blunt, observant, occasionally troublesome, and not especially interested in pretending otherwise.');
const privacyTitle = node('h3', '', 'Your privacy');
const privacyCopy = node('p', '', 'Chats, memory, and character state are stored in this browser. Only selected context needed for a reply is sent through a Cloudflare Worker to Groq. There are no accounts, server-side chat database, or third-party analytics.');
const settingsSection = node('section', 'about-settings');
settingsSection.setAttribute('aria-label', 'Settings');
const settingsTitle = node('h3', '', 'Settings');
const settingsControls = node('div', 'settings-controls');
const descriptionsRow = node('label', 'setting-row');
const descriptionsLabel = node('span', '', 'Scene Detail');
const descriptions = node('input', 'setting-switch'); descriptions.type = 'checkbox'; descriptions.setAttribute('role', 'switch');
descriptions.setAttribute('aria-label', 'Scene Detail');
const appearanceRow = node('label', 'setting-row');
const appearanceLabel = node('span', '', 'Appearance');
const appearanceControl = node('span', 'appearance-control');
const appearanceSelect = node('select', 'appearance-select'); appearanceSelect.setAttribute('aria-label', 'Appearance');
for (const value of ['system', 'light', 'dark'] as const) {
  const option = node('option', '', value[0]!.toUpperCase() + value.slice(1)); option.value = value; appearanceSelect.append(option);
}
const appearanceChevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
appearanceChevron.setAttribute('class', 'appearance-chevron'); appearanceChevron.setAttribute('viewBox', '0 0 24 24');
appearanceChevron.setAttribute('aria-hidden', 'true'); appearanceChevron.setAttribute('focusable', 'false');
const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
chevronPath.setAttribute('d', 'm6 9 6 6 6-6'); appearanceChevron.append(chevronPath);
appearanceControl.append(appearanceSelect, appearanceChevron); appearanceRow.append(appearanceLabel, appearanceControl);
const settingsStatus = node('p', 'setting-status'); settingsStatus.setAttribute('role', 'status');
function refreshSettings(): void {
  descriptions.checked = settings.descriptions;
  appearanceSelect.value = appearance.preference;
}
refreshSettings();
descriptions.onchange = () => {
  settingsStatus.textContent = settings.setDescriptions(descriptions.checked) ? '' : 'Setting could not be saved.';
  refreshSettings();
};
appearanceSelect.onchange = () => {
  settingsStatus.textContent = appearance.setPreference(appearanceSelect.value as AppearancePreference) ? '' : 'Setting could not be saved.';
  refreshSettings();
};
window.addEventListener('storage', event => {
  if (event.key === APPEARANCE_KEY || event.key === null) appearance.refresh();
  if (event.key === SETTINGS_KEY || event.key === APPEARANCE_KEY || event.key === null) refreshSettings();
});
descriptionsRow.append(descriptionsLabel, descriptions);
const startOverTitle = node('h3', '', 'Start over');
const startOverCopy = node('p');
startOverCopy.append('Type ', node('code', 'reset-command', 'reset yourself'), ' to clear everything and start over.');
settingsControls.append(descriptionsRow, appearanceRow); settingsSection.append(settingsTitle, settingsControls, settingsStatus);
const dataSection = node('section', 'about-data'); dataSection.append(privacyTitle, privacyCopy);
const startOverSection = node('section', 'about-start-over'); startOverSection.append(startOverTitle, startOverCopy);
const aboutFooter = node('footer', 'about-footer');
const creditLine = node('p', 'credit-line', "© 2026 micknorj · Mick's Lab · ");
const github = node('a', '', 'GitHub'); github.href = 'https://github.com/micknorj'; github.target = '_blank'; github.rel = 'noopener noreferrer'; creditLine.append(github);
aboutFooter.append(creditLine);
aboutContent.append(characterCopy, dataSection, settingsSection, startOverSection, aboutFooter);
aboutSurface.append(aboutHeader, aboutContent);
about.append(aboutSurface);
app.append(scene, landing, chat, dialog, about);
const aboutModal = createModal(about, { dismissOnBackdrop: true });
const resetModal = createModal(dialog, { dismissOnBackdrop: true });

const storage = new Storage();
let controller: Controller | null = null;
let historyReady = false; let warning = ''; let fatal = ''; let entryEpoch = 0;
let landingError: HTMLParagraphElement | undefined;
const backendWarning = api.base ? '' : 'Chat is unavailable right now.';
let renderedKey = '';
// UI-only nodes preserve outgoing motion/fade progress across pending status and tab updates.
const transientRows = new Map<string, HTMLElement>();
const committedRows = new Map<string, [HTMLElement, HTMLElement]>();
let renderedInstance = '';
function appear(row: HTMLElement): void {
  if (chat.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  row.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 120, easing: 'ease-out' });
}
function isResetCommand(text: string): boolean { return text.trim().toLowerCase() === 'reset yourself'; }
function canSendMessage(): boolean {
  return !!api.base && !!controller?.state && !controller.resetting && !fatal && navigator.onLine && (!controller.pending || controller.pending.status === 'failed');
}
function resizeInput(): void {
  if (chat.hidden) return;
  input.style.height = 'auto';
  // CSS owns the viewport-aware cap, including browsers that keep calc() in computed styles.
  const contentHeight = input.scrollHeight;
  input.style.height = `${contentHeight}px`;
  if (contentHeight > input.clientHeight) {
    // Keep the capped viewport a whole number of text lines.
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight);
    input.style.height = `${Math.max(lineHeight, Math.floor(input.clientHeight / lineHeight) * lineHeight)}px`;
  }
  // Native caret scrolling can stop a few pixels short and clip the preceding line.
  // Only follow the bottom when editing there; preserve scrolling for edits elsewhere.
  if (input.selectionStart === input.value.length && input.selectionEnd === input.value.length) input.scrollTop = input.scrollHeight;
}
const navigation = new Navigation(artwork, {
  prepare(view) {
    landing.hidden = view === 'chat'; chat.hidden = true;
    app.classList.toggle('is-chat', view === 'chat');
    render();
    if (view === 'landing') enter.focus({ preventScroll: true });
  },
  reveal(view) {
    if (view !== 'chat') return;
    chat.hidden = false; resizeInput(); transcript.scrollTop = transcript.scrollHeight;
    // A dialog opened during the art transition retains its native focus trap.
    if (!about.open && !dialog.open) input.focus({ preventScroll: true });
  },
});
function showChat(): void { void navigation.show('chat'); }
function message(speaker: string, text: string, timestamp: string, extraClass = '', read = false): HTMLElement {
  const row = node('article', `message ${speaker === 'You' ? 'user-message' : 'mikiru-message'} ${extraClass}`);
  const bubble = node('div', 'message-bubble'); bubble.append(node('p', 'message-text', text));
  const meta = node('div', 'message-meta');
  const time = node('time', '', new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  time.dateTime = timestamp; time.title = new Date(timestamp).toLocaleString();
  meta.append(node('strong', '', speaker), time);
  if (read) meta.append(node('span', 'read-state', 'Read'));
  row.append(bubble, meta); return row;
}
function typing(): HTMLElement {
  const row = node('div', 'typing-row');
  const indicator = node('p', 'typing-indicator'); indicator.append(node('span', 'sr-only', 'Mikiru is typing'));
  for (let i = 0; i < 3; i++) { const dot = node('span', 'typing-dot'); dot.setAttribute('aria-hidden', 'true'); indicator.append(dot); }
  row.append(indicator); return row;
}
function failedReply(): HTMLElement {
  const row = node('article', 'message failed-reply'); row.setAttribute('aria-label', 'Reply failed');
  const bubble = node('div', 'message-bubble');
  bubble.append(node('span', 'failure-label', 'Reply failed'), node('p', 'message-text'));
  const retry = button('retry', ''); retry.setAttribute('aria-label', 'Retry message'); retry.title = 'Retry message';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M20 7v5h-5M19.2 12a7.2 7.2 0 1 0-1.6 4.5'); icon.append(path); retry.append(icon);
  retry.onclick = () => { void controller?.retry(); }; row.append(bubble, retry); return row;
}
function render(): void {
  if (!controller) return;
  if (landingError) { landingError.textContent = fatal; landingError.hidden = !fatal; }

  enter.textContent = landingAction(controller.state);
  enter.style.visibility = historyReady ? '' : 'hidden';
  enter.setAttribute('aria-busy', String(!historyReady));
  const p = controller.pending;
  const key = [controller.state?.meta.instanceId, controller.state?.meta.revision, p?.localId, p?.status, ...controller.sleepAttempts.map(a => a.localId)].join(':');
  if (key !== renderedKey) {
    renderedKey = key;
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 90;
    const rows: HTMLElement[] = [];
    const liveIds = new Set<string>();
    const instance = controller.state?.meta.instanceId ?? '';
    const animateNewTurns = renderedInstance === instance;
    if (!animateNewTurns) { committedRows.clear(); renderedInstance = instance; }
    const committedIds = new Set<string>();
    for (const turn of controller.state?.turns ?? []) {
      // Read is purely a presentation of a committed turn, never pending/failed/sleep state.
      committedIds.add(turn.turnId);
      let pair = committedRows.get(turn.turnId);
      if (!pair) {
        pair = [message('You', turn.user.text, turn.user.createdAt, '', true), message('Mikiru', turn.assistant.text, turn.assistant.createdAt)];
        committedRows.set(turn.turnId, pair);
        if (animateNewTurns) appear(pair[1]);
      }
      rows.push(...pair);
    }
    for (const id of committedRows.keys()) if (!committedIds.has(id)) committedRows.delete(id);
    if (p) {
      liveIds.add(p.localId);
      let row = transientRows.get(p.localId);
      if (!row) { row = message('You', p.text, p.createdAt, 'pending-message'); transientRows.set(p.localId, row); appear(row); }
      rows.push(row);
      if (p.status === 'failed') {
        const failureId = `failure:${p.localId}`; liveIds.add(failureId);
        let failure = transientRows.get(failureId);
        if (!failure) { failure = failedReply(); transientRows.set(failureId, failure); appear(failure); }
        // Application status only: no invented dialogue, Read marker or persisted turn.
        failure.querySelector('.message-text')!.textContent = controller.error || 'The reply could not be completed. Try again.';
        rows.push(failure);
      }
      if (p.status !== 'failed') rows.push(typing());
    }
    for (const attempt of controller.sleepAttempts) {
      liveIds.add(attempt.localId);
      let row = transientRows.get(attempt.localId);
      if (!row) {
        row = message('You', attempt.text, attempt.createdAt, 'sleep-fade');
        transientRows.set(attempt.localId, row);
        // The controller still owns removal and the exact RAM-only sleep lifetime.
        row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : LIMITS.SLEEP_FADE_MS, easing: 'ease-in', fill: 'forwards' });
      }
      rows.push(row);
    }
    for (const id of transientRows.keys()) if (!liveIds.has(id)) transientRows.delete(id);
    transcript.replaceChildren(...rows);
    if (nearBottom || p || controller.sleepAttempts.length) transcript.scrollTop = transcript.scrollHeight;
    if (controller.state && new TextEncoder().encode(JSON.stringify({ turns: controller.state.turns, memory: controller.state.memory })).byteLength >= LIMITS.STORAGE_WARNING_BYTES) warning = 'Browser storage is getting large. History remains until you reset or clear browser data.';
  }
  // The local reset command must remain reachable even when conversation sends are blocked.
  input.disabled = controller.resetting;
  const resetCommand = isResetCommand(input.value);
  input.setAttribute('aria-invalid', String(!resetCommand && input.value.length > LIMITS.USER_CHARS));
  send.disabled = input.disabled || !input.value.trim() || (!resetCommand && (input.value.length > LIMITS.USER_CHARS || !canSendMessage()));
  enter.disabled = !historyReady || controller.resetting || (!controller.state && !fatal);
  for (const retry of transcript.querySelectorAll<HTMLButtonElement>('.retry')) retry.disabled = !navigator.onLine || controller.resetting;
  offline.hidden = navigator.onLine;
  status.textContent = fatal || controller.error || backendWarning || warning;
}
enter.onclick = showChat;
home.onclick = () => { void navigation.show('landing'); };
function showAbout(): void { refreshSettings(); aboutModal.open(closeAbout); }
aboutButton.onclick = showAbout;
information.onclick = showAbout;
closeAbout.onclick = () => aboutModal.close();
form.onsubmit = event => {
  event.preventDefault(); const text = input.value;
  if (!controller || controller.resetting) return;
  if (!text.trim()) return;
  if (isResetCommand(text)) { resetModal.open(cancelReset); return; }
  if (text.length > LIMITS.USER_CHARS) { controller.error = 'Message exceeds 8,000 characters'; render(); return; }
  if (!canSendMessage()) return;
  input.value = ''; resizeInput(); void controller.send(text);
};
input.oninput = () => {
  resizeInput();
  if (controller) controller.error = !isResetCommand(input.value) && input.value.length > LIMITS.USER_CHARS ? 'Message exceeds 8,000 characters' : '';
  render();
};
input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!send.disabled) form.requestSubmit(); } };
cancelReset.onclick = () => resetModal.close();
dialog.addEventListener('close', () => { if (!input.disabled) input.focus({ preventScroll: true }); });
confirmReset.onclick = () => {
  if (dialog.classList.contains('is-closing') || controller?.resetting) return;
  const epoch = ++entryEpoch;
  resetModal.close(); input.value = ''; resizeInput(); warning = ''; fatal = '';
  void controller?.reset().finally(() => { if (epoch === entryEpoch) { historyReady = true; render(); } });
};
window.addEventListener('resize', resizeInput);
window.addEventListener('offline', render); window.addEventListener('online', render);
window.addEventListener('pagehide', () => { entryEpoch++; controller?.abort(); storage.close(); });
window.addEventListener('pageshow', event => {
  if (!event.persisted || !controller) return;
  const epoch = entryEpoch;
  // A browser back/forward-cache entry is also Home; refresh only authoritative local data.
  historyReady = false; void navigation.show('landing');
  void controller.initialize().then(() => { if (epoch === entryEpoch) fatal = ''; })
    .catch(() => { if (epoch === entryEpoch) fatal = 'Local data could not be opened. Send "reset yourself" to clear Mikiru data.'; })
    .finally(() => { if (epoch === entryEpoch) { historyReady = true; render(); } });
});
const initialEntry = entryEpoch;
try {
  const tabs = new MultiTab(notice => { void controller?.notice(notice); });
  controller = new Controller({ storage, api, tabs, changed: render, descriptions: () => settings.descriptions });
  await controller.initialize();
  if (initialEntry === entryEpoch) { historyReady = true; render(); }
  if (initialEntry === entryEpoch && navigator.storage?.estimate) {
    // Size reporting is advisory; its failure must not disable valid IndexedDB data.
    const estimate = await navigator.storage.estimate().catch((): StorageEstimate => ({}));
    if (initialEntry === entryEpoch && (estimate.usage ?? 0) >= LIMITS.STORAGE_WARNING_BYTES) { warning = 'Browser storage is getting large. History remains until you reset or clear browser data.'; render(); }
  }
} catch {
  if (initialEntry === entryEpoch) {
    fatal = controller ? 'Local data could not be opened. Send "reset yourself" to clear Mikiru data.' : 'Use a current browser with IndexedDB, Web Locks and BroadcastChannel enabled.';
    landingError = node('p', 'status landing-error', fatal); landing.append(landingError);
    if (!controller) enter.disabled = true;
  }
} finally {
  if (initialEntry === entryEpoch) { historyReady = true; render(); }
}
