import assert from 'assert';
import fs from 'fs';
import { createWriteStream } from 'fs';
import os from 'os';
import pathe from 'pathe';
import semver from 'semver';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';

/**
 * Options for the checkAndUpdate function
 */
export interface CheckAndUpdateOptions {
  /**
   * Whether to enable verbose debug logging
   */
  debug: boolean;

  /**
   * Current version of the CLI
   */
  version: string;

  /**
   * The name of the package to check for updates
   */
  name: string;

  /**
   * Base URL for the npm registry
   * @default "https://registry.npmjs.org"
   */
  registryBase?: string;

  /**
   * Release channel to check for updates
   * @default "latest"
   */
  channel?: 'latest' | 'next' | 'canary' | string;

  /**
   * Whether to skip update checks when running in CI environments
   * @default true
   */
  skipOnCI?: boolean;

  /**
   * Minimum time between update checks in milliseconds
   * @default 21600000 (6 hours)
   */
  updateCheckIntervalMs?: number;

  /**
   * Whether to only print what would happen without actually performing updates
   * @default false
   */
  dryRun?: boolean;

  /**
   * Installation directory of the CLI
   * If not provided, it will be determined automatically
   */
  installDir?: string;

  /**
   * Custom display function for update notifications
   * If provided, this function will be called instead of the default display
   * @param info Object containing update information
   */
  onDisplay?: (info: {
    version: string;
    packageName: string;
    needReinstall: boolean;
    changelogUrl?: string;
  }) => void;
}

/**
 * Package metadata structure from NPM Registry
 */
interface PackageMetadata {
  name: string;
  'dist-tags': {
    [key: string]: string;
  };
  versions: {
    [version: string]: {
      version: string;
      dist: {
        tarball: string;
      };
      [key: string]: any;
    };
  };
}

/**
 * Upgear configuration structure
 */
interface UpgearConfig {
  /**
   * List of files or directories to update
   */
  files: string[];

  /**
   * Whether a manual reinstall is required
   */
  needReinstall?: boolean;

  /**
   * URL to the changelog for this update
   */
  changelogUrl?: string;
}

/**
 * Version information structure
 */
interface VersionInfo {
  /**
   * The version number
   */
  version: string;

  /**
   * URL to download the tarball
   */
  tarballUrl: string;

  /**
   * Upgear configuration
   */
  upgear: UpgearConfig;
}

/**
 * Update paths structure
 */
interface UpdatePaths {
  /**
   * Path to the downloaded tarball file
   */
  tarballPath: string;

  /**
   * Path to the temporary directory for extraction
   */
  extractDir: string;
}

/**
 * Cleanup operations to execute in a finally block
 */
interface CleanupOperations {
  /**
   * Whether temporary files were created and need cleanup
   */
  tempFilesCreated: boolean;

  /**
   * Paths to clean up
   */
  paths: UpdatePaths | null;
}

/**
 * Creates a logger that conditionally outputs messages based on debug flag
 */
function createLogger(debug: boolean) {
  return {
    /**
     * Logs a message only when debug is enabled
     */
    debug: (...args: any[]) => {
      if (debug) {
        console.log('[upgear:debug]', ...args);
      }
    },
    /**
     * Logs a message regardless of debug setting
     */
    info: (...args: any[]) => {
      console.log('[upgear:info]', ...args);
    },
    /**
     * Logs a warning message regardless of debug setting
     */
    warn: (...args: any[]) => {
      console.warn('[upgear:warn]', ...args);
    },
  };
}

/**
 * Checks if the current environment is a CI environment
 */
function isCI(): boolean {
  try {
    return Boolean(
      process.env.CI ||
        process.env.CONTINUOUS_INTEGRATION ||
        process.env.BUILD_NUMBER ||
        process.env.GITHUB_ACTIONS,
    );
  } catch (error) {
    // In case of any error reading environment variables, assume not CI
    return false;
  }
}

/**
 * Gets the path to the update timestamp file
 */
function getTimestampFilePath(): string {
  try {
    const configDir = pathe.join(os.homedir(), '.upgear');
    return pathe.join(configDir, 'update-timestamps.json');
  } catch (error) {
    // If there's an error determining paths, use a default location
    return pathe.join(os.tmpdir(), 'upgear-update-timestamps.json');
  }
}

/**
 * Reads the last update check timestamp for a package
 * @param packageName The name of the package
 * @returns The timestamp in milliseconds, or 0 if not found
 */
function readLastCheckTimestamp(packageName: string): number {
  try {
    const timestampFilePath = getTimestampFilePath();

    if (!fs.existsSync(timestampFilePath)) {
      return 0;
    }

    const content = fs.readFileSync(timestampFilePath, 'utf-8');
    const data = JSON.parse(content);

    return data[packageName] || 0;
  } catch (error) {
    // If there's any error reading the file, return 0 to trigger a check
    return 0;
  }
}

/**
 * Writes the current timestamp as the last check time
 * @param packageName The name of the package
 */
function writeCurrentTimestamp(packageName: string): void {
  try {
    const timestampFilePath = getTimestampFilePath();
    const configDir = pathe.dirname(timestampFilePath);

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    let data: Record<string, number> = {};
    if (fs.existsSync(timestampFilePath)) {
      const content = fs.readFileSync(timestampFilePath, 'utf-8');
      try {
        data = JSON.parse(content);
      } catch {
        // If parsing fails, use empty object
        data = {};
      }
    }

    data[packageName] = Date.now();

    fs.writeFileSync(timestampFilePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    // Silently fail - not being able to write timestamp
    // shouldn't stop the CLI from working
  }
}

/**
 * Builds the URL for the package metadata
 * @param packageName The name of the package
 * @param registryBase The base URL for the registry
 */
function buildPackageUrl(packageName: string, registryBase: string): string {
  try {
    const baseUrl = registryBase.endsWith('/')
      ? registryBase
      : `${registryBase}/`;
    return `${baseUrl}${encodeURIComponent(packageName)}`;
  } catch (error) {
    // If there's an error constructing the URL (e.g., invalid registryBase),
    // return a default URL
    return `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  }
}

/**
 * Fetches package metadata from the npm registry
 * @param packageName The name of the package
 * @param registryBase The base URL for the registry
 * @param logger The logger instance
 * @returns The package metadata, or null if there was an error
 */
async function fetchPackageMetadata(
  packageName: string,
  registryBase: string,
  logger: ReturnType<typeof createLogger>,
): Promise<PackageMetadata | null> {
  let controller: AbortController | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    const url = buildPackageUrl(packageName, registryBase);
    logger.debug(`Fetching package metadata from: ${url}`);

    controller = new AbortController();
    timeoutId = setTimeout(() => controller?.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'upgear',
      },
      signal: controller.signal,
    });

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!response.ok) {
      logger.warn(
        `Failed to fetch package metadata: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();
    logger.debug('Successfully fetched package metadata');
    return data as PackageMetadata;
  } catch (error) {
    logger.warn('Error fetching package metadata:', error);
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Determines if an update is available and needed
 * @param currentVersion The current version
 * @param latestVersion The latest version from npm
 * @param logger The logger instance
 * @returns True if an update is needed, false otherwise
 */
function isUpdateNeeded(
  currentVersion: string,
  latestVersion: string,
  logger: ReturnType<typeof createLogger>,
): boolean {
  try {
    if (!semver.valid(currentVersion) || !semver.valid(latestVersion)) {
      logger.warn(
        `Invalid version format. Current: ${currentVersion}, Latest: ${latestVersion}`,
      );
      return false;
    }
    const updateNeeded = semver.gt(latestVersion, currentVersion);
    logger.debug(
      `Version comparison: Current=${currentVersion}, Latest=${latestVersion}, ` +
        `Update needed: ${updateNeeded}`,
    );
    return updateNeeded;
  } catch (error) {
    logger.warn('Error comparing versions:', error);
    return false;
  }
}

/**
 * Extracts the self-update configuration and tarball URL from the package metadata for a specific version
 * @param metadata The package metadata
 * @param version The version to extract info for
 * @param logger The logger instance
 * @returns The version info, or null if not found or invalid
 */
function extractVersionInfo(
  metadata: PackageMetadata,
  version: string,
  logger: ReturnType<typeof createLogger>,
): VersionInfo | null {
  try {
    const versionData = metadata.versions[version];

    if (!versionData) {
      logger.warn(`Version ${version} not found in package metadata`);
      return null;
    }

    const tarballUrl = versionData.dist.tarball;
    if (!tarballUrl) {
      logger.warn(`No tarball URL found for version ${version}`);
      return null;
    }

    const upgear = versionData.upgear as UpgearConfig | undefined;

    if (!upgear) {
      logger.warn(`No upgear configuration found for version ${version}`);
      return null;
    }

    const files = ['dist', 'package.json'].concat(upgear.files || []);
    if (!Array.isArray(files) || files.length === 0) {
      logger.warn(`Invalid or empty files array in upgear configuration`);
      return null;
    }

    logger.debug(`Extracted version info for ${version}:`, {
      tarballUrl,
      upgear,
    });

    return {
      version,
      tarballUrl,
      upgear: {
        files,
        needReinstall: upgear.needReinstall || false,
        changelogUrl: upgear.changelogUrl,
      },
    };
  } catch (error) {
    logger.warn(`Error extracting version info for ${version}:`, error);
    return null;
  }
}

/**
 * Creates unique temporary paths for download and extraction
 * @param packageName Package name
 * @param version Version number
 * @returns Object containing the tarball path and extract directory path
 */
function createTempPaths(packageName: string, version: string): UpdatePaths {
  try {
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const sanitizedPackageName = packageName.replace(/[^a-zA-Z0-9]/g, '_');

    const tarballPath = pathe.join(
      tempDir,
      `${sanitizedPackageName}-${version}-${timestamp}.tgz`,
    );

    const extractDir = pathe.join(
      tempDir,
      `${sanitizedPackageName}-${version}-${timestamp}-extract`,
    );

    return {
      tarballPath,
      extractDir,
    };
  } catch (error) {
    // In case of any error, return paths in the temp directory with minimal processing
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    return {
      tarballPath: pathe.join(tempDir, `upgear-update-${timestamp}.tgz`),
      extractDir: pathe.join(tempDir, `upgear-update-${timestamp}-extract`),
    };
  }
}

/**
 * Downloads a tarball to a temporary file
 * @param url The URL to download
 * @param targetPath The path to save the downloaded file
 * @param logger The logger instance
 * @param dryRun Whether to simulate the download without actually performing it
 * @returns A promise that resolves when the download is complete, or rejects if there is an error
 */
async function downloadTarball(
  url: string,
  targetPath: string,
  logger: ReturnType<typeof createLogger>,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    logger.info(
      `[DRY RUN] Would download tarball from: ${url} to ${targetPath}`,
    );
    return;
  }

  logger.debug(`Downloading tarball from: ${url} to ${targetPath}`);

  let controller: AbortController | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  let fileStream: fs.WriteStream | null = null;

  try {
    const targetDir = pathe.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    controller = new AbortController();
    timeoutId = setTimeout(() => controller?.abort(), 30000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'upgear',
      },
      signal: controller.signal,
    });

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to download tarball: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    fileStream = createWriteStream(targetPath);

    // @ts-ignore TypeScript doesn't recognize ReadableStream as a valid input to pipeline
    await pipeline(response.body, fileStream);

    logger.debug(`Successfully downloaded tarball to: ${targetPath}`);
  } catch (error) {
    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
      } catch (cleanupError) {
        logger.debug(`Error cleaning up incomplete download: ${cleanupError}`);
      }
    }

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (fileStream) {
      fileStream.end();
    }
  }
}

/**
 * Extracts the downloaded tarball to a temporary directory
 * @param tarballPath Path to the downloaded tarball
 * @param extractDir Path to the extraction directory
 * @param logger The logger instance
 * @param dryRun Whether to simulate the extraction without actually performing it
 * @returns A promise that resolves when the extraction is complete, or rejects if there is an error
 */
async function extractTarball(
  tarballPath: string,
  extractDir: string,
  logger: ReturnType<typeof createLogger>,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    logger.info(
      `[DRY RUN] Would extract tarball from ${tarballPath} to ${extractDir}`,
    );
    return;
  }

  logger.debug(`Extracting tarball from ${tarballPath} to ${extractDir}`);

  try {
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }

    await tar.extract({
      file: tarballPath,
      cwd: extractDir,
      // Ignore permissions by extracting everything as readable/writable
      strict: false,
    });

    logger.debug(`Successfully extracted tarball to ${extractDir}`);

    const files = fs.readdirSync(extractDir);
    logger.debug(`Extracted directory contents: ${files.join(', ')}`);

    // NPM tarballs usually have a 'package' directory at the root
    if (files.length === 0) {
      throw new Error('Extraction directory is empty');
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Creates a backup of files before updating them
 * @param files List of files to back up
 * @param installDir Installation directory
 * @param logger Logger instance
 * @param dryRun Whether to simulate the backup without actually performing it
 * @returns A promise that resolves when backups are complete
 */
async function backupFiles(
  files: string[],
  installDir: string,
  logger: ReturnType<typeof createLogger>,
  dryRun: boolean,
): Promise<void> {
  logger.debug(`Starting file backup process for ${files.length} files`);

  for (const filePath of files) {
    const fullPath = pathe.join(installDir, filePath);
    const backupPath = `${fullPath}.bak`;

    if (!fs.existsSync(fullPath)) {
      logger.debug(`Skipping backup of non-existent file: ${fullPath}`);
      continue;
    }

    if (dryRun) {
      logger.info(`[DRY RUN] Would back up ${fullPath} to ${backupPath}`);
      continue;
    }

    try {
      if (fs.existsSync(backupPath)) {
        logger.debug(`Removing existing backup file: ${backupPath}`);
        if (fs.statSync(backupPath).isDirectory()) {
          deleteDirRecursive(backupPath);
        } else {
          fs.unlinkSync(backupPath);
        }
      }

      if (fs.statSync(fullPath).isDirectory()) {
        logger.debug(`Backing up directory: ${fullPath} -> ${backupPath}`);
        fs.mkdirSync(backupPath, { recursive: true });

        const filesList = fs.readdirSync(fullPath);
        for (const file of filesList) {
          const srcFile = pathe.join(fullPath, file);
          const destFile = pathe.join(backupPath, file);

          if (fs.statSync(srcFile).isDirectory()) {
            fs.cpSync(srcFile, destFile, { recursive: true });
          } else {
            fs.copyFileSync(srcFile, destFile);
          }
        }
      } else {
        logger.debug(`Backing up file: ${fullPath} -> ${backupPath}`);
        fs.copyFileSync(fullPath, backupPath);
      }

      logger.debug(`Successfully backed up: ${fullPath}`);
    } catch (error) {
      logger.warn(`Error backing up ${fullPath}:`, error);
      // Continue with other files even if one fails
    }
  }

  logger.debug('File backup process completed');
}

/**
 * Copies updated files from the extracted package to the installation directory
 * @param files List of files to update
 * @param extractDir Extraction directory path
 * @param installDir Installation directory path
 * @param logger Logger instance
 * @param dryRun Whether to simulate the copy without actually performing it
 * @returns A promise that resolves when file copy is complete
 */
async function copyUpdatedFiles(
  files: string[],
  extractDir: string,
  installDir: string,
  logger: ReturnType<typeof createLogger>,
  dryRun: boolean,
): Promise<void> {
  logger.debug(`Starting file copy process for ${files.length} files`);

  // NPM tarballs typically have a 'package' directory at the root that contains all the files
  // We need to check if this directory exists and use it as the source base
  let sourceBase = extractDir;
  const packageDir = pathe.join(extractDir, 'package');
  if (fs.existsSync(packageDir) && fs.statSync(packageDir).isDirectory()) {
    sourceBase = packageDir;
    logger.debug(`Using 'package' subdirectory as source: ${sourceBase}`);
  }

  for (const filePath of files) {
    const sourcePath = pathe.join(sourceBase, filePath);
    const destPath = pathe.join(installDir, filePath);

    if (!fs.existsSync(sourcePath)) {
      logger.warn(`Source file not found in package: ${sourcePath}`);
      continue;
    }

    if (dryRun) {
      logger.info(`[DRY RUN] Would copy ${sourcePath} to ${destPath}`);
      continue;
    }

    try {
      const destDir = pathe.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        logger.debug(`Creating destination directory: ${destDir}`);
        fs.mkdirSync(destDir, { recursive: true });
      }

      if (fs.statSync(sourcePath).isDirectory()) {
        logger.debug(`Copying directory: ${sourcePath} -> ${destPath}`);

        // If destination exists and is a directory, we need to merge
        if (fs.existsSync(destPath) && fs.statSync(destPath).isDirectory()) {
          fs.cpSync(sourcePath, destPath, { recursive: true, force: true });
        } else {
          // If destination doesn't exist or is a file, remove it and copy the directory
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
          fs.cpSync(sourcePath, destPath, { recursive: true });
        }
      } else {
        logger.debug(`Copying file: ${sourcePath} -> ${destPath}`);
        fs.copyFileSync(sourcePath, destPath);
      }

      logger.debug(`Successfully copied: ${destPath}`);
    } catch (error) {
      logger.warn(`Error copying ${sourcePath} to ${destPath}:`, error);
      // Continue with other files even if one fails
    }
  }

  logger.debug('File copy process completed');
}

/**
 * Displays update notifications to the user
 * @param version New version number
 * @param packageName Package name
 * @param needReinstall Whether manual reinstall is required
 * @param changelogUrl URL to the changelog (optional)
 * @param logger Logger instance
 * @param dryRun Whether this is a dry run
 * @param onDisplay Custom display function (optional)
 */
function displayUpdateNotification(
  version: string,
  packageName: string,
  needReinstall: boolean,
  changelogUrl: string | undefined,
  logger: ReturnType<typeof createLogger>,
  dryRun: boolean,
  onDisplay?: CheckAndUpdateOptions['onDisplay'],
): void {
  if (dryRun) {
    logger.info(
      `[DRY RUN] Would display update notification for ${packageName} to version ${version}`,
    );
    return;
  }

  // Use custom display function if provided
  if (onDisplay) {
    logger.debug('Using custom display function for update notification');
    onDisplay({
      version,
      packageName,
      needReinstall,
      changelogUrl,
    });
    return;
  }

  // Default display implementation
  const hr = '─'.repeat(60);

  if (needReinstall) {
    console.log(`\n${hr}`);
    console.log(
      `New version ${version} of ${packageName} is available, but requires reinstallation.`,
    );
    console.log(`Please run: npm i -g ${packageName}`);
    console.log(`${hr}\n`);
  } else {
    console.log(`\n${hr}`);
    console.log(`✅ ${packageName} has been updated to version ${version}`);
    if (changelogUrl) {
      console.log(`Changelog: ${changelogUrl}`);
    }
    console.log(`${hr}\n`);
  }
}

/**
 * Recursively deletes a directory and all its contents
 * @param dirPath The path to the directory to delete
 */
function deleteDirRecursive(dirPath: string): void {
  try {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach((file) => {
        const curPath = pathe.join(dirPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          deleteDirRecursive(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(dirPath);
    }
  } catch (error) {
    // Silently fail cleanup errors
    // This is a best-effort cleanup function
  }
}

/**
 * Cleans up temporary files created during the update process
 * @param paths The paths to clean up
 * @param logger The logger instance
 * @param dryRun Whether this is a dry run
 */
function cleanupTemporaryFiles(
  paths: UpdatePaths | null,
  logger: ReturnType<typeof createLogger>,
  dryRun: boolean = false,
): void {
  if (dryRun || !paths) {
    return;
  }

  logger.debug('Cleaning up temporary files');

  try {
    if (fs.existsSync(paths.tarballPath)) {
      fs.unlinkSync(paths.tarballPath);
      logger.debug(`Deleted tarball: ${paths.tarballPath}`);
    }

    if (fs.existsSync(paths.extractDir)) {
      deleteDirRecursive(paths.extractDir);
      logger.debug(`Deleted extraction directory: ${paths.extractDir}`);
    }
  } catch (error) {
    logger.warn('Error cleaning up temporary files:', error);
  }
}

/**
 * Checks for and performs CLI updates if available
 *
 * @param opts Options for the update check
 * @returns A promise that resolves when the check/update process is complete
 */
export async function checkAndUpdate(
  opts: CheckAndUpdateOptions,
): Promise<void> {
  const options = {
    debug: opts.debug,
    version: opts.version,
    name: opts.name,
    registryBase: opts.registryBase ?? 'https://registry.npmjs.org',
    channel: opts.channel ?? 'latest',
    skipOnCI: opts.skipOnCI ?? true,
    updateCheckIntervalMs: opts.updateCheckIntervalMs ?? 21600000, // 6 hours in ms
    dryRun: opts.dryRun ?? false,
    installDir: opts.installDir,
    onDisplay: opts.onDisplay,
  };

  const logger = createLogger(options.debug);

  logger.debug('Starting update check with options:', options);

  let updatePaths: UpdatePaths | null = null;

  const cleanup: CleanupOperations = {
    tempFilesCreated: false,
    paths: null,
  };

  try {
    if (options.skipOnCI && isCI()) {
      logger.debug('Skipping update check in CI environment');
      return;
    }

    if (!options.dryRun && options.updateCheckIntervalMs > 0) {
      const lastCheckTime = readLastCheckTimestamp(options.name);
      const timeSinceLastCheck = Date.now() - lastCheckTime;

      if (
        lastCheckTime > 0 &&
        timeSinceLastCheck < options.updateCheckIntervalMs
      ) {
        logger.debug(
          `Skipping update check - last check was ${timeSinceLastCheck}ms ago, ` +
            `interval is ${options.updateCheckIntervalMs}ms`,
        );
        return;
      }

      logger.debug(
        `Proceeding with update check - last check was ${timeSinceLastCheck}ms ago, ` +
          `interval is ${options.updateCheckIntervalMs}ms`,
      );
    }

    // We're going to check, so record the timestamp (unless it's a dry run)
    if (!options.dryRun) {
      writeCurrentTimestamp(options.name);
    }

    const metadata = await fetchPackageMetadata(
      options.name,
      options.registryBase,
      logger,
    );

    // If metadata couldn't be fetched, exit gracefully
    if (!metadata) {
      logger.warn(`Could not check for updates for ${options.name}`);
      return;
    }

    const latestVersion = metadata['dist-tags'][options.channel];

    if (!latestVersion) {
      logger.warn(`Channel '${options.channel}' not found for ${options.name}`);
      return;
    }

    logger.debug(
      `Current version: ${options.version}, Latest version: ${latestVersion}`,
    );

    if (!isUpdateNeeded(options.version, latestVersion, logger)) {
      logger.debug('No update needed, already at the latest version');
      return;
    }

    logger.debug(
      `Update available for ${options.name}: ${options.version} → ${latestVersion}`,
    );

    const versionInfo = extractVersionInfo(metadata, latestVersion, logger);
    if (!versionInfo) {
      logger.warn(
        `Cannot update to version ${latestVersion}: missing or invalid upgear configuration`,
      );
      return;
    }

    logger.debug('Upgear configuration:', versionInfo.upgear);

    // If needReinstall is true, skip download and update, just notify
    if (versionInfo.upgear.needReinstall) {
      logger.debug('Skipping download and update as needReinstall is true');
      displayUpdateNotification(
        versionInfo.version,
        options.name,
        true,
        versionInfo.upgear.changelogUrl,
        logger,
        options.dryRun,
        options.onDisplay,
      );
      return;
    }

    // Create temporary paths for download and extraction only if we're not in dry run
    // For dry run mode, we'll still compute the paths but not actually create files
    updatePaths = createTempPaths(options.name, versionInfo.version);
    logger.debug('Created temporary paths:', updatePaths);

    cleanup.paths = updatePaths;

    try {
      await downloadTarball(
        versionInfo.tarballUrl,
        updatePaths.tarballPath,
        logger,
        options.dryRun,
      );

      // Mark that we've created files (unless in dry run)
      if (!options.dryRun) {
        cleanup.tempFilesCreated = true;
      }

      await extractTarball(
        updatePaths.tarballPath,
        updatePaths.extractDir,
        logger,
        options.dryRun,
      );

      if (!options.dryRun && fs.existsSync(updatePaths.tarballPath)) {
        fs.unlinkSync(updatePaths.tarballPath);
        logger.debug(`Deleted tarball: ${updatePaths.tarballPath}`);
      }

      const installDir = options.installDir;
      assert(installDir, 'installDir is required');
      logger.debug(`CLI installation directory: ${installDir}`);

      await backupFiles(
        versionInfo.upgear.files,
        installDir,
        logger,
        options.dryRun,
      );

      await copyUpdatedFiles(
        versionInfo.upgear.files,
        updatePaths.extractDir,
        installDir,
        logger,
        options.dryRun,
      );

      displayUpdateNotification(
        versionInfo.version,
        options.name,
        !!versionInfo.upgear.needReinstall,
        versionInfo.upgear.changelogUrl,
        logger,
        options.dryRun,
        options.onDisplay,
      );

      logger.debug(
        `Update to version ${versionInfo.version} completed successfully`,
      );
    } catch (error) {
      logger.warn('Error during update process:', error);
    } finally {
      if (cleanup.tempFilesCreated && cleanup.paths) {
        cleanupTemporaryFiles(cleanup.paths, logger, options.dryRun);
        cleanup.tempFilesCreated = false;
        cleanup.paths = null;
      }
    }
  } catch (error) {
    // Catch and log any errors, but don't throw - we don't want to disrupt the CLI
    logger.warn('Error during update check:', error);
  } finally {
    // Extra safety check to ensure cleanup happens in all scenarios
    // Only if files were created and we're not in dry run
    if (cleanup.tempFilesCreated && cleanup.paths) {
      cleanupTemporaryFiles(cleanup.paths, logger, options.dryRun);
    }
  }
}
