import { useSyncExternalStore } from 'react';

function normalise(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Back/forward still arrives as popstate from the browser.
  const onPopState = () => listener();
  window.addEventListener('popstate', onPopState);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', onPopState);
  };
}

/**
 * The current in-app path. This is an external store rather than local state
 * because a redirect can run its effect before the component that renders it
 * has subscribed. `useSyncExternalStore` re-checks the snapshot after
 * subscribing, so such a redirect still lands instead of leaving the app on
 * the transition screen.
 */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => normalise(window.location.pathname));
}

export function navigate(to: string): void {
  const next = normalise(to);
  if (normalise(window.location.pathname) === next) {
    window.scrollTo({ top: 0 });
    return;
  }

  window.history.pushState({}, '', next);
  for (const listener of listeners) listener();
  window.scrollTo({ top: 0 });
}
