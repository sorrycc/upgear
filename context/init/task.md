## 📋 概要

本任务旨在指导初级工程师完成 Takumi CLI 自动更新模块的开发。该模块的核心功能是在 CLI 启动时，自动检查 npm registry 获取包的最新版本，并根据 `package.json` 中 `selfUpdate` 字段的配置，下载、解压、并替换指定文件，从而实现 CLI 的自动更新。

## ✅ 任务清单

### 阶段 1: 项目初始化与基本结构搭建

1.  **任务 1.1: 创建模块文件与定义 API 接口**
    *   概要: 创建 `src/checkAndUpdate.ts` 文件，并根据 `design-doc.md` 定义 `CheckAndUpdateOptions` 接口和 `checkAndUpdate` 函数签名。
    *   完成条件:
        *   [ ] `src/checkAndUpdate.ts` 文件已创建。
        *   [ ] `CheckAndUpdateOptions` 接口已定义，包含所有在 `design-doc.md` 中指定的字段 (`debug`, `version`, `registryBase?`, `name`, `channel?`, `skipOnCI?`, `updateCheckIntervalMs?`, `dryRun?`)。
        *   [ ] `checkAndUpdate(opts: CheckAndUpdateOptions): Promise<void>` 函数签名已定义并导出。
        *   [ ] 编写初步的单元测试，验证函数可以被调用。
    *   动作确认:
        *   [ ] `pnpm test` (或项目指定测试命令) 测试通过。
        *   [ ] `pnpm build` (或项目指定编译命令) 无编译错误。
    *   备注: 确保 TypeScript 类型定义清晰。

2.  **任务 1.2: 实现参数默认值处理与基本日志**
    *   概要: 在 `checkAndUpdate` 函数内部处理输入参数 `opts` 的默认值，并实现一个简单的日志工具，根据 `debug` 选项输出日志。
    *   完成条件:
        *   [ ] 为 `CheckAndUpdateOptions` 中的可选参数设置默认值（如 `registryBase`, `channel`, `skipOnCI`, `updateCheckIntervalMs`）。
        *   [ ] 实现一个内部日志函数，当 `opts.debug` 为 `true` 时，打印详细日志；否则，仅打印关键信息或警告。
        *   [ ] 在函数入口打印接收到的参数 (如果 `debug` 为 `true`)。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过（包括测试参数默认值和日志输出逻辑）。
        *   [ ] `pnpm build` 无编译错误。
        *   [ ] 手动确认: 调用函数并观察不同 `debug` 设置下的日志输出。

### 阶段 2: 与 NPM Registry 交互

1.  **任务 2.1: 实现上次检查时间戳管理**
    *   概要: 实现逻辑来存储和读取上次成功检查更新的时间戳，以支持 `updateCheckIntervalMs`。
    *   完成条件:
        *   [ ] 设计存储机制（例如，在用户配置目录下的一个简单文件中存储 `{[packageName]: lastCheckTimestamp}`).
        *   [ ] 实现读取上次检查时间戳的函数。
        *   [ ] 实现写入当前时间戳为上次检查时间的函数。
        *   [ ] `checkAndUpdate` 函数开始时，如果 `skipOnCI` 为 `true`且在 CI 环境中，则跳过检查。
        *   [ ] 如果 `updateCheckIntervalMs` 已设置，并且距离上次检查时间未超过该间隔，则跳过后续检查（除非 `dryRun` 为 `true`）。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (覆盖时间戳读写、CI跳过、检查间隔逻辑)。
        *   [ ] `pnpm build` 无编译错误。
    *   备注: 考虑错误处理，如无法读写时间戳文件时应如何表现（例如，默认执行检查）。

2.  **任务 2.2: 查询 NPM Registry 获取包元数据**
    *   概要: 使用 Node.js 内置的 `fetch` API (或可靠的HTTP客户端库) 从 npm registry (如 `https://registry.npmjs.org/`) 获取指定包 (`opts.name`) 的元数据。
    *   完成条件:
        *   [ ] 实现一个函数，根据包名和 registry 地址构建请求 URL。
        *   [ ] 实现通过 HTTP GET 请求获取包的 JSON 元数据。
        *   [ ] 处理网络请求成功和失败的情况 (包括超时、DNS错误等)。
        *   [ ] 成功时解析 JSON 数据。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (mock `fetch`，测试 URL 构建、成功解析、错误处理)。
        *   [ ] `pnpm build` 无编译错误。
        *   [ ] 手动确认: (可选) 使用一个真实存在的包名进行测试，观察是否能获取数据。
    *   备注: 确保遵循 `design-doc.md` 中关于错误处理的要求 (catch 异常，使用 `console.warn()`)。

3.  **任务 2.3: 版本比较与更新判断**
    *   概要: 使用 `semver` 库比较当前 CLI 版本 (`opts.version`) 与从 registry 获取到的最新版本 (`dist-tags[opts.channel]`，默认为 `latest`)。
    *   完成条件:
        *   [ ] 从获取的包元数据中提取指定 `channel` (如 `latest`, `next`) 的版本号。
        *   [ ] 使用 `semver.gt()` (或类似函数) 比较最新版本与当前版本。
        *   [ ] 根据比较结果判断是否需要更新。
        *   [ ] 如果不需要更新，则记录日志并提前结束流程。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (覆盖不同版本号比较场景，如 newer, older, same)。
        *   [ ] `pnpm build` 无编译错误。

### 阶段 3: 更新包处理与文件操作

1.  **任务 3.1: 获取新版本 `package.json` 及 `selfUpdate` 配置**
    *   概要: 如果判断需要更新，则从包元数据中提取目标版本的 `package.json` 内容，特别是 `selfUpdate` 字段 (`files`, `needReinstall`, `changelogUrl`) 和 `dist.tarball` URL。
    *   完成条件:
        *   [ ] 从完整的包元数据中，根据已确定的最新版本号，找到对应版本的详细信息。
        *   [ ] 提取该版本的 `package.json` 对象。
        *   [ ] 从 `package.json` 中解析 `selfUpdate` 对象。如果不存在或格式不正确，则中止更新并警告。
        *   [ ] 提取 `dist.tarball` URL。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (mock 包元数据，测试提取 `selfUpdate` 和 `tarball` URL 的逻辑，包括 `selfUpdate` 不存在或无效的场景)。
        *   [ ] `pnpm build` 无编译错误。

2.  **任务 3.2: 下载 Tarball**
    *   概要: 实现下载 `dist.tarball` 到临时目录 (`os.tmpdir()`)。
    *   完成条件:
        *   [ ] 使用 `fetch` 或 HTTP 客户端下载 tarball。
        *   [ ] 将下载的 tarball 保存到由 `os.tmpdir()` 和一个唯一名称（例如，包名+版本号）组成的临时文件中。
        *   [ ] 实现下载进度提示 (可选，但对用户体验友好，尤其是在 `debug` 模式下)。
        *   [ ] 处理下载过程中的错误 (网络问题、磁盘空间不足等)。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (mock 下载过程，验证临时文件路径生成、错误处理)。
        *   [ ] `pnpm build` 无编译错误。
        *   [ ] 手动确认: (可选) 尝试下载一个真实的、小的 tarball 文件。

3.  **任务 3.3: 解压 Tarball**
    *   概要: 使用 `tar` 库 (如 `node-tar`) 将下载的 tarball 解压到一个新的临时目录中。
    *   完成条件:
        *   [ ] 创建一个新的唯一临时目录用于存放解压后的文件 (例如，在 `os.tmpdir()` 下)。
        *   [ ] 使用 `tar` 库解压下载的 tarball 文件到此目录。
        *   [ ] 处理解压过程中的错误。
        *   [ ] 解压后，清理下载的 tarball 临时文件。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (使用一个简单的测试 tarball 文件，验证解压逻辑和错误处理)。
        *   [ ] `pnpm build` 无编译错误。
    *   备注: 注意 tar 包内文件路径可能包含前缀 (如 `package/`)，需要正确处理以定位文件。

### 阶段 4: 核心更新逻辑与用户通知

1.  **任务 4.1: 实现文件备份**
    *   概要: 在覆盖文件之前，根据 `selfUpdate.files` 列表，备份当前安装目录中将被替换的文件或文件夹。
    *   完成条件:
        *   [ ] 确定当前 CLI 的安装目录 (这可能需要一种可靠的方式来定位，例如基于 `__dirname` 或传递的路径)。
        *   [ ] 遍历 `selfUpdate.files` 列表。
        *   [ ] 对于每个待更新的文件/文件夹，在目标位置创建一个备份 (例如，追加 `.bak` 后缀或移动到备份子目录)。
        *   [ ] 如果 `opts.dryRun` 为 `true`，则仅打印将要备份的文件路径，不执行实际备份。
        *   [ ] 处理备份过程中的错误。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (模拟文件系统，测试备份逻辑、`dryRun` 模式)。
        *   [ ] `pnpm build` 无编译错误。
        *   [ ] 手动确认: 运行更新（非 dryRun），检查文件是否已备份。
    *   备注: `design-doc.md` 指出备份文件目前不自动清理。

2.  **任务 4.2: 实现文件覆盖**
    *   概要: 将解压到临时目录中的新文件 (根据 `selfUpdate.files` 指定) 复制并覆盖到当前 CLI 安装目录。
    *   完成条件:
        *   [ ] 遍历 `selfUpdate.files` 列表。
        *   [ ] 对每个条目，从解压的临时目录中找到对应的文件/文件夹 (注意处理 tar 包内可能存在的路径前缀，如 `package/`)。
        *   [ ] 将这些文件/文件夹复制到 CLI 安装目录的相应位置，覆盖现有文件。
        *   [ ] 使用 `fs.promises` 或类似的异步文件操作，并确保跨平台兼容性 (`path`模块)。
        *   [ ] 如果 `opts.dryRun` 为 `true`，则仅打印将要复制和覆盖的文件路径，不执行实际操作。
        *   [ ] 处理文件复制/覆盖过程中的错误。如果任何一个文件操作失败，应考虑是否需要回滚（目前设计是保留旧版本，不回滚）。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (模拟文件系统，测试文件复制、覆盖、路径处理、`dryRun` 模式)。
        *   [ ] `pnpm build` 无编译错误。
        *   [ ] 手动确认: 运行更新（非 dryRun），检查文件是否已更新。

3.  **任务 4.3: 实现用户通知**
    *   概要: 更新完成后（或根据 `needReinstall` 判断），向用户显示相应的提示信息。
    *   完成条件:
        *   [ ] 如果 `selfUpdate.needReinstall` 为 `true`，打印提示用户手动运行 `npm i -g <package-name>` 的信息。
        *   [ ] 如果更新成功且 `needReinstall` 为 `false`，打印更新成功的消息，包括新版本号和 `selfUpdate.changelogUrl` (如果提供)。格式参考 `spec.md`。
        *   [ ] 如果 `opts.dryRun` 为 `true`，则打印将要显示的通知，而不是实际认为更新已完成。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (测试不同条件下通知的正确性)。
        *   [ ] `pnpm build` 无编译错误。
        *   [ ] 手动确认: 触发不同更新场景，检查终端输出。

### 阶段 5: 错误处理与健壮性

1.  **任务 5.1: 全局错误捕获与处理**
    *   概要: 确保 `checkAndUpdate` 函数中的所有异步操作和关键步骤都有错误捕获机制，防止更新失败时中断 CLI 主流程。
    *   完成条件:
        *   [ ] 在 `checkAndUpdate` 函数顶层使用 `try...catch` 块。
        *   [ ] 所有 Promise-based 操作 (如 `fetch`, 文件操作) 都有 `.catch()` 或在 `try...catch` 中 `await`。
        *   [ ] 发生错误时，使用 `console.warn()` (或 `debug` 日志) 记录错误信息。
        *   [ ] 确保即使更新失败，函数也会正常返回 `Promise<void>`，不抛出未捕获的异常。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (通过 mock 强制不同步骤失败，验证错误被捕获且 CLI 不会崩溃)。
        *   [ ] `pnpm build` 无编译错误。
        *   [ ] 手动确认: 模拟网络中断或文件权限问题，观察 CLI 是否继续运行并打印警告。

2.  **任务 5.2: 清理临时文件**
    *   概要: 确保在更新过程成功或失败后，所有创建的临时文件和目录（除了备份文件）都被清理。
    *   完成条件:
        *   [ ] 在 `finally` 块或成功/失败路径中，删除下载的 tarball 临时文件（如果之前未删除）。
        *   [ ] 删除解压用的临时目录及其内容。
        *   [ ] 如果 `opts.dryRun` 为 `true`，不应有实际的临时文件被创建或需要清理。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过 (验证成功和失败场景下临时文件是否被清理)。
        *   [ ] `pnpm build` 无编译错误。
        *   [ ] 手动确认: 执行更新后，检查 `os.tmpdir()` 是否有残留的非备份临时文件。

### 阶段 6: 集成与收尾

1.  **任务 6.1: 编写完整的单元测试与集成测试**
    *   概要: 补充和完善所有模块和功能的单元测试，并编写集成测试来验证整个更新流程。
    *   完成条件:
        *   [ ] 确保各函数和逻辑分支都有单元测试覆盖。
        *   [ ] 编写集成测试，模拟完整的更新流程 (从版本检查到文件替换/通知)，覆盖成功和失败的场景。
        *   [ ] 测试 `dryRun` 模式是否按预期工作，不执行实际文件操作但打印正确信息。
        *   [ ] 测试 `skipOnCI` 和 `updateCheckIntervalMs` 逻辑。
    *   动作确认:
        *   [ ] `pnpm test` 测试通过，达到项目要求的测试覆盖率。
        *   [ ] `pnpm build` 无编译错误。

2.  **任务 6.2: 文档与代码注释**
    *   概要: 为 `checkAndUpdate.ts` 模块及其主要函数、接口添加清晰的 JSDoc/TSDoc 注释。
    *   完成条件:
        *   [ ] `CheckAndUpdateOptions` 接口及其所有字段都有注释说明。
        *   [ ] `checkAndUpdate` 函数有注释说明其功能、参数和行为。
        *   [ ] 模块内部关键函数和复杂逻辑有必要的注释。
    *   动作确认:
        *   [ ] 代码审查通过。
        *   [ ] `pnpm build` 无编译错误。

## ❓ 未解决的课题・确认事项

*   **CLI 安装目录的确定**: 需要一种明确且可靠的方法来确定当前 CLI 的安装目录，以便正确备份和覆盖文件。这可能依赖于 CLI 的打包方式或 Node.js 的 `require.main.filename` 等。请与导师或团队成员确认最佳实践。
*   **文件操作的原子性/回滚**: 当前设计是在文件操作失败时不进行复杂回滚，而是保留旧版本。如果单个文件覆盖失败，是否应该尝试恢复已备份的文件？ `design-doc.md` 决定采用备份方案，但未详细说明失败时的回滚策略。当前任务遵循"保留旧版本"的简单策略。
*   **并发 CLI 执行**: `design-doc.md` 决定不实现锁机制。如果多个 CLI 实例同时尝试更新，可能会导致问题。当前任务不处理此问题，但应了解此限制。
*   **`updateCheckIntervalMs` 状态存储位置**: 任务 2.1 建议在用户配置目录存储时间戳。需确认具体路径和文件名，以及跨平台兼容性。
*   **测试命令**: 任务中的 `pnpm test`, `pnpm lint`, `pnpm build` 是占位符。请替换为项目实际使用的命令。
*   **TDD 文档**: 请参考项目内部的 `testing.md` (如果存在) 或通用的 TDD 实践指南。

## 🔗 相关文档

*   `llms-docs/design-doc.md` (本模块的设计方针)
*   `llms-docs/spec.md` (本模块的功能规格)
