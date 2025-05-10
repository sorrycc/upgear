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

### Custom Update Display

You can customize how update notifications are displayed:

```ts
import { checkAndUpdate } from 'upgear';

checkAndUpdate({
  // required options
  debug: false,
  version: '1.0.0',
  name: 'my-cli',
  
  // custom display function
  onDisplay: ({ version, packageName, needReinstall, changelogUrl }) => {
    if (needReinstall) {
      console.log(`🔄 Please reinstall ${packageName} to version ${version}`);
    } else {
      console.log(`🎉 Successfully updated ${packageName} to ${version}!`);
      if (changelogUrl) {
        console.log(`📝 Release notes: ${changelogUrl}`);
      }
    }
  }
});
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
- `onDisplay`: A custom function for displaying update notifications, receives an object with `version`, `packageName`, `needReinstall`, and `changelogUrl` properties.

## LICENSE

MIT
