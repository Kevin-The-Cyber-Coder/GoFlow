import type { AnchorHTMLAttributes, MouseEvent } from 'react';

import { navigate } from './router';

/**
 * An anchor that keeps in-app navigation client-side. Modified clicks,
 * external URLs and in-page hashes behave like normal links.
 */
export function Link({
  href,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    if (!href.startsWith('/') || href.startsWith('//')) return;

    event.preventDefault();
    navigate(href);
  }

  return <a href={href} onClick={handleClick} {...rest} />;
}
