import { useEffect, useState } from 'react';

function normalise(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** The current in-app path, kept in sync with back/forward navigation. */
export function usePathname(): string {
  const [path, setPath] = useState(() => normalise(window.location.pathname));

  useEffect(() => {
    const update = () => setPath(normalise(window.location.pathname));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  return path;
}

export function navigate(to: string): void {
  const next = normalise(to);
  if (normalise(window.location.pathname) === next) {
    window.scrollTo({ top: 0 });
    return;
  }

  window.history.pushState({}, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}
