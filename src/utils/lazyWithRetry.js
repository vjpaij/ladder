import React, { lazy } from 'react';

/**
 * Enhanced lazy loader that handles dynamic import failures due to network blips,
 * server restarts, or stale bundle chunks.
 *
 * It retries the import up to maxRetries times with exponential backoff.
 * If all retries fail and the error is a dynamic import chunk error,
 * it performs a one-time clean page reload (guarded by sessionStorage to avoid infinite reload loops).
 */
export function lazyWithRetry(componentImport, key = 'generic') {
  return lazy(async () => {
    const pageHasAlreadyBeenForceRefreshed = JSON.parse(
      window.sessionStorage.getItem(`retry-lazy-refreshed-${key}`) || 'false'
    );

    let attempts = 0;
    const maxRetries = 2;

    while (attempts <= maxRetries) {
      try {
        const component = await componentImport();
        // If successful, reset the forced refresh flag
        window.sessionStorage.removeItem(`retry-lazy-refreshed-${key}`);
        return component;
      } catch (error) {
        attempts++;
        const isDynamicImportError =
          error?.message?.includes('Failed to fetch dynamically imported module') ||
          error?.message?.includes('error loading dynamically imported module') ||
          error?.message?.includes('Importing a module script failed');

        if (attempts <= maxRetries && isDynamicImportError) {
          // Wait 350ms before retrying
          await new Promise((resolve) => setTimeout(resolve, 350 * attempts));
          continue;
        }

        // If retries exhausted and not force refreshed yet, reload page to fetch fresh index & module map
        if (!pageHasAlreadyBeenForceRefreshed && isDynamicImportError) {
          window.sessionStorage.setItem(`retry-lazy-refreshed-${key}`, 'true');
          window.location.reload();
          return new Promise(() => {}); // Suspend promise until reload triggers
        }

        // Rethrow if already force refreshed or if error is an actual syntax/runtime exception
        throw error;
      }
    }
  });
}
