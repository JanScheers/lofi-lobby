/**
 * Resolve a URL for use in href/src. When base is '/' (default), returns a path
 * relative to the current page so the site works when opened via file:// (e.g.
 * dist/index.html). When base is set (e.g. for subpath deploy), returns
 * base-prefixed absolute path.
 */
export function resolveSiteUrl(
  currentPathname: string,
  targetPath: string,
  base: string
): string {
  const absolute = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  if (base !== '') {
    return base + absolute;
  }
  return pathRelativeTo(currentPathname, absolute);
}

/**
 * Return path from current page to target (both as absolute pathnames).
 * e.g. pathRelativeTo('/', '/play/foo/index.html') => 'play/foo/index.html'
 *      pathRelativeTo('/games/foo/', '/play/foo/index.html') => '../../play/foo/index.html'
 */
function pathRelativeTo(currentPathname: string, targetPath: string): string {
  const from = currentPathname.replace(/\/$/, '') || '/';
  const to = targetPath.replace(/^\//, '') || '';
  if (!to) return '.';
  const fromParts = from === '/' ? [] : from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);
  let i = 0;
  while (
    i < fromParts.length &&
    i < toParts.length &&
    fromParts[i] === toParts[i]
  ) {
    i++;
  }
  const up = fromParts.length - i;
  const down = toParts.slice(i);
  const parts = [...Array(up).fill('..'), ...down];
  return parts.join('/') || '.';
}
