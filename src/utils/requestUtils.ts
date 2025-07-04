import { VersionInfo } from './versionUtils.js';
import { registerCleanup } from './shutdown.js';

let isPatched = false;
let originalFetch: (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function patchGlobalFetch(versionInfo: VersionInfo): {
  'User-Agent': string;
} {
  const headers = {
    'User-Agent': `${versionInfo.name}/${versionInfo.version} (${versionInfo.branch}, ${versionInfo.tag}, ${versionInfo.sha})`
  };

  if (!isPatched) {
    // Store original fetch before patching
    originalFetch = global.fetch;

    // Patch global fetch with version headers
    global.fetch = async function (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> {
      const modifiedInit: RequestInit = {
        ...init,
        headers: {
          ...(init?.headers || {}),
          ...headers
        }
      };
      return originalFetch(input, modifiedInit);
    };

    isPatched = true;

    // Register cleanup to restore original fetch on shutdown
    registerCleanup('global-fetch-patch', async () => {
      cleanup();
    });
  }

  return headers;
}

/**
 * Cleans up the global fetch patch and restores original behavior
 */
export function cleanup(): void {
  if (isPatched && originalFetch) {
    try {
      global.fetch = originalFetch;
      isPatched = false;
    } catch (error) {
      console.error('Failed to restore original fetch:', error);
      // Don't throw to avoid breaking shutdown process
    }
  }
}

/**
 * Checks if the global fetch has been patched
 */
export function isGlobalFetchPatched(): boolean {
  return isPatched;
}

/**
 * Gets the original fetch function if available
 */
export function getOriginalFetch(): typeof fetch | null {
  return originalFetch || null;
}
