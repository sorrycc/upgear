import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CheckAndUpdateOptions, checkAndUpdate } from '.';

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/mock/home'),
}));

vi.mock('pathe', () => ({
  join: vi.fn((...args) => args.join('/')),
  dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/')),
}));

vi.mock('semver', () => ({
  valid: vi.fn().mockReturnValue(true),
  gt: vi.fn().mockReturnValue(false),
}));

// Mock environment variables for CI detection
delete process.env.CI;
delete process.env.CONTINUOUS_INTEGRATION;
delete process.env.BUILD_NUMBER;
delete process.env.GITHUB_ACTIONS;

describe('checkAndUpdate', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock global fetch
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        name: 'takumi',
        'dist-tags': {
          latest: '1.1.0',
        },
        versions: {
          '1.0.0': { version: '1.0.0' },
          '1.1.0': { version: '1.1.0' },
        },
      }),
    }));

    // Reset mock implementations
    vi.resetAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  test('should apply default values', async () => {
    // Arrange
    const options: CheckAndUpdateOptions = {
      debug: true,
      version: '1.0.0',
      name: 'takumi',
    };

    // Act
    await checkAndUpdate(options);

    // Assert - verify debug logs with default values
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[takumi:update:debug]',
      'Starting update check with options:',
      expect.objectContaining({
        registryBase: 'https://registry.npmjs.org',
        channel: 'latest',
        skipOnCI: true,
        updateCheckIntervalMs: 21600000,
        dryRun: false,
      }),
    );
  });

  test('should respect custom values', async () => {
    // Arrange
    const options: CheckAndUpdateOptions = {
      debug: true,
      version: '1.0.0',
      name: 'takumi',
      registryBase: 'https://custom-registry.com',
      channel: 'next',
      skipOnCI: false,
      updateCheckIntervalMs: 3600000,
      dryRun: true,
    };

    // Act
    await checkAndUpdate(options);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[takumi:update:debug]',
      'Starting update check with options:',
      expect.objectContaining({
        registryBase: 'https://custom-registry.com',
        channel: 'next',
        skipOnCI: false,
        updateCheckIntervalMs: 3600000,
        dryRun: true,
      }),
    );
  });

  test('should skip update in CI environment', async () => {
    // Arrange
    process.env.CI = 'true';
    const options: CheckAndUpdateOptions = {
      debug: true,
      version: '1.0.0',
      name: 'takumi',
    };

    // Act
    await checkAndUpdate(options);

    // Assert
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[takumi:update:debug]',
      'Skipping update check in CI environment',
    );
  });
});
