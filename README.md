# Upgear

Upgear is a CLI tool that helps you update yourself.

## Usage

To start the development server, run:

```bash
$ npm i upgear -S
```

Then you can use it in your project:

```ts
import { checkAndUpdate } from 'upgear';

checkAndUpdate({});
```

## Options

- `debug`: Whether to enable debug mode.
- `version`: The version of the package to check for updates.
- `name`: The name of the package to check for updates.
- `registryBase`: The base URL for the npm registry.
- `channel`: The channel to check for updates, can be `latest`, `next`, `canary` or a custom channel.
- `skipOnCI`: Whether to skip update checks when running in CI environments.
- `updateCheckIntervalMs`: The minimum time between update checks in milliseconds.
- `dryRun`: Whether to only print what would happen without actually performing updates.
- `installDir`: The directory to install the updates.

## LICENSE

MIT
