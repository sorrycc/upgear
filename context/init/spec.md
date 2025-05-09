## 📋 概要

在现有的 Takumi 项目中新增一个 TypeScript 模块，用于实现 CLI 的自动更新功能。该模块通过查询 npm registry 获取最新版本信息、判断是否需要更新，并基于 `selfUpdate` 字段指示的内容下载、解压、替换文件，以实现无需手动 `npm i -g takumi` 的自动更新。

## 🎯 要求

- 在 Takumi 中实现单独的自动更新模块（TypeScript 编写）。
- 每次运行时自动检查 `dist-tags.latest` 指向的最新版本。
- 使用 `semver` 判断当前版本是否需要更新。
- 基于 `package.json` 中 `selfUpdate` 字段确定更新策略。
- 下载并解压 `.tar` 包中的指定文件到当前安装路径。
- 更新完成后提示用户；需要手动更新时也提示。
- 支持非管理员用户，失败时保持当前版本继续运行。

## 📝 功能规格

### 用户操作和功能反应

- 用户运行 `takumi` CLI 时：
  1. 模块通过 `https://registry.npmjs.org/takumi` 拉取最新版本信息。
  2. 读取 `dist-tags.latest`，比较当前版本与最新版本（使用 `semver`）。
  3. 如果有新版本：
     - 获取 `versions[latestVersion].package.json`。
     - 解析 `selfUpdate`：
       - `files`: 需要更新的文件或文件夹列表。
       - `needReinstall`: 是否需要手动更新。
       - `changelogUrl`: 更新日志地址。
  4. 下载 `dist.tarball` 的 tar 包。
  5. 解压到临时目录。
  6. 将 `selfUpdate.files` 中的文件复制覆盖到当前 CLI 安装目录。
  7. 如果 `needReinstall` 为 `true`，提示用户手动更新。
  8. 更新完成后，终端提示新版本号和 changelog 链接。

### 技术和业务约束条件

- 技术约束：
  - TypeScript 实现，模块化设计（如 `src/update.ts`）。
  - 使用 node 内置的 `fetch` 拉取 npm registry 数据。
  - 使用 `semver` 比较版本。
  - 使用 `tar` 库解压 tar 包。
  - 文件操作需使用 `fs`，用同步。
  - 需兼容 Windows、macOS、Linux。
  - 遇到错误时，catch 后继续正常运行 CLI，不中断主流程。

- 业务约束：
  - 每次启动 CLI 时检查更新。
  - 不区分 major/minor/patch，全版本更新。
  - 离线时跳过更新。
  - 更新完成后在终端输出提示，例如：
    ```
    Takumi has been updated to v1.2.3. Changelog: https://example.com/changelog
    ```
  - `needReinstall` 为 `true` 时：
    ```
    Important update detected, please run: npm i -g takumi
    ```

### 所需数据结构和获取方法

- `npm registry` 响应结构：
  - `dist-tags.latest`: 最新版本号。
  - `versions[version].selfUpdate`: 包含更新信息。
  - `versions[version].dist.tarball`: tar 包下载地址。

- 本地处理：
  - 下载 tar → 解压至 temp 目录 → 复制 `selfUpdate.files` → 覆盖原目录。

## 🔄 交互

- 与 npm registry 的交互：
  - `GET https://registry.npmjs.org/takumi` 拉取元数据。
  - 下载 `dist.tarball` 获取代码包。

- 与文件系统的交互：
  - 临时目录存放解压内容。
  - 根据 `selfUpdate.files` 列表选择性覆盖。
  - 处理文件冲突、备份（如有需要）。

- 与用户交互：
  - 更新完成提示。
  - `needReinstall` 为 `true` 时输出指令提示。

## ❓ 未解决的问题

- 如何处理更新失败后的回滚（当前只保留旧版本）。
- 是否需要在更新前备份被覆盖文件。
- 多次并发运行 CLI 时的锁机制（避免多进程同时写入）。
- tar 包内路径可能包含嵌套目录，需要 normalize。
- 未来是否扩展为插件架构的独立更新。

## 其他

新增文件 `src/checkAndUpdate.ts`，API 设计如下。

```ts
export async function checkAndUpdate(opts: {
  debug: boolean;  // print verbose messages
  version: string; // current version
  registryBase: string; // default: https://registry.npmjs.org/
  name: string; // the name of the package to update
  ...others
}): Promise<void>;
```
