import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// `?inline` gives the fully-processed (Tailwind-compiled) CSS as a plain
// string, bundled directly into this file rather than emitted as a
// separate .css asset — the integrator needs nothing but the one <script>
// tag. Injected as a <style> child of the shadow root (not document.head)
// so it never leaks out to the host page and the host page's own CSS
// never leaks in. See the plan's "Delivery" section.
import cssText from './styles/index.css?inline';
import { Widget, type WidgetConfig } from './Widget';

interface MountedInstance {
  root: Root;
  shadowHost: HTMLElement;
}

const mounted = new Map<string, MountedInstance>();

/**
 * Mounts the capture widget into `selector`, inside its own Shadow DOM.
 * `config.sessionToken` must be minted server-side by the integrator's own
 * backend (POST /v1/applicants/:id/session-token, authenticated with their
 * real API key) — this SDK never holds or requests that API key itself,
 * only the short-lived, single-applicant token passed in here.
 */
function mount(selector: string, config: WidgetConfig): void {
  const container = document.querySelector(selector);
  if (!container) {
    throw new Error(`LybID.mount: no element found for selector "${selector}"`);
  }
  if (mounted.has(selector)) {
    throw new Error(
      `LybID.mount: "${selector}" is already mounted — call unmount() first`,
    );
  }

  const shadowHost = document.createElement('div');
  container.appendChild(shadowHost);
  const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = cssText;
  shadowRoot.appendChild(style);

  const mountPoint = document.createElement('div');
  shadowRoot.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  root.render(createElement(Widget, { config }));

  mounted.set(selector, { root, shadowHost });
}

/** Unmounts and fully cleans up (including the shadow host, so a fresh
 * mount() on the same selector afterward starts clean). */
function unmount(selector: string): void {
  const instance = mounted.get(selector);
  if (!instance) return;
  instance.root.unmount();
  instance.shadowHost.remove();
  mounted.delete(selector);
}

const LybID = { mount, unmount };

export default LybID;
export type { WidgetConfig };
