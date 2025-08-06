import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Gets the current directory in a way that works in both ES modules and CommonJS
 */
function getCurrentDirectory(): string {
  // For Jest/test environment, just use a reliable fallback
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return path.resolve(process.cwd(), 'src', 'utils');
  }

  // Check if we're in an ES module context by looking for import.meta
  if (typeof globalThis !== 'undefined' && 'importMeta' in globalThis) {
    try {
      // This would be set by runtime that supports ES modules
      return path.dirname(fileURLToPath((globalThis as any).importMeta.url));
    } catch {
      // Fall through to default
    }
  }

  // Default fallback for all environments
  return path.resolve(process.cwd(), 'src', 'utils');
}

export interface VersionInfo {
  name: string;
  version: string;
  sha: string;
  tag: string;
  branch: string;
}

/**
 * Gets version information from multiple sources with fallback strategy
 */
export function getVersionInfo(): VersionInfo {
  const name = 'Mapbox MCP server';

  // Try multiple strategies in order of preference
  return (
    tryVersionJson(name) ||
    tryPackageJson(name) ||
    tryEnvironmentVariables(name) ||
    getDefaultVersionInfo(name)
  );
}

/**
 * Attempts to read version info from version.json
 */
function tryVersionJson(name: string): VersionInfo | null {
  try {
    const dirname = getCurrentDirectory();

    // Try to read from version.json first (for build artifacts)
    const versionJsonPath = path.resolve(dirname, '..', 'version.json');
    try {
      const versionData = readFileSync(versionJsonPath, 'utf-8');
      let info = JSON.parse(versionData) as VersionInfo;
      info['name'] = name;
      return info;
    } catch {
      // Fall back to package.json
      const packageJsonPath = path.resolve(dirname, '..', '..', 'package.json');
      const packageData = readFileSync(packageJsonPath, 'utf-8');
      const packageInfo = JSON.parse(packageData);

      return {
        name: name,
        version: packageInfo.version || '0.0.0',
        sha: 'unknown',
        tag: 'unknown',
        branch: 'unknown'
      };
    }
  } catch (_error) {
    // Continue to next strategy
  }

  return null;
}

/**
 * Attempts to read version info from package.json
 */
function tryPackageJson(name: string): VersionInfo | null {
  try {
    const dirname = getCurrentDirectory();
    const possiblePaths = [
      path.resolve(dirname, '..', '..', 'package.json'),
      path.resolve(process.cwd(), 'package.json')
    ];

    for (const filePath of possiblePaths) {
      if (existsSync(filePath)) {
        const data = readFileSync(filePath, 'utf-8');
        const pkg = JSON.parse(data);

        return {
          name,
          version: pkg.version || '0.0.0',
          sha: 'from-package',
          tag: `v${pkg.version || '0.0.0'}`,
          branch: 'unknown'
        };
      }
    }
  } catch (_error) {
    // Continue to next strategy
  }

  return null;
}

/**
 * Attempts to read version info from environment variables
 */
function tryEnvironmentVariables(name: string): VersionInfo | null {
  try {
    // Support common CI/CD environment variables
    const version =
      process.env.npm_package_version ||
      process.env.VERSION ||
      process.env.APP_VERSION;

    const sha =
      process.env.GIT_SHA ||
      process.env.GITHUB_SHA ||
      process.env.CI_COMMIT_SHA ||
      process.env.COMMIT_SHA;

    const tag =
      process.env.GIT_TAG ||
      process.env.GITHUB_REF_NAME ||
      process.env.CI_COMMIT_TAG;

    const branch =
      process.env.GIT_BRANCH ||
      process.env.GITHUB_REF_NAME ||
      process.env.CI_COMMIT_BRANCH;

    if (version) {
      return {
        name,
        version,
        sha: sha || 'unknown',
        tag: tag || `v${version}`,
        branch: branch || 'unknown'
      };
    }
  } catch (_error) {
    // Continue to default
  }

  return null;
}

/**
 * Returns default version information as last fallback
 */
function getDefaultVersionInfo(name: string): VersionInfo {
  return {
    name,
    version: '0.2.0', // Match package.json default
    sha: 'development',
    tag: 'v0.2.0',
    branch: 'main'
  };
}
