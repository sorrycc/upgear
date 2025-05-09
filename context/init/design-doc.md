# Takumi CLI 自动更新模块设计方针

## 📋 概要

本设计方针文档旨在指导 Takumi 项目中 CLI 自动更新模块的实现，确保即使是初级工程师也能无障碍开发。模块的目标是每次 CLI 启动时检查 npm registry 最新版本，根据 `selfUpdate` 配置下载、解压、替换文件，从而实现免手动 `npm i -g takumi` 的自动更新。

---

## 🔍 需求分析

- 每次 CLI 启动时检查 `https://registry.npmjs.org/takumi`。
- 使用 `semver` 比较当前版本和 `dist-tags.latest`。
- 解析 `selfUpdate` 字段：
  - `files`: 待更新文件或文件夹。
  - `needReinstall`: 是否需要手动更新。
  - `changelogUrl`: 更新日志链接。
- 下载 `dist.tarball`。
- 解压至临时目录。
- 覆盖 `selfUpdate.files` 到当前安装目录。
- 更新完成后输出提示。
- 错误时不中断 CLI 主流程。

---

## 🛠 实现方针

### 架构选择

- 单独模块 `src/checkAndUpdate.ts`。
- 模块化设计，避免与 CLI 主流程耦合。
- 使用异步 API 提高健壮性，但允许同步文件操作。

### 组件设计

- **Updater 模块**：主控制器，调度更新流程。
- **Registry 查询模块**：处理 npm 数据请求。
- **文件操作模块**：封装下载、解压、备份、覆盖。
- **用户提示模块**：统一终端输出。

各组件职责分离、互相调用，保持模块边界清晰。

### 数据流

CLI 启动
↓
checkAndUpdate 调用
↓
查询 npm registry
↓
判断是否更新
↓
下载 → 解压 → 备份 → 覆盖文件
↓
输出提示
↓
继续 CLI 主流程

---

## 🔄 实现方法的选项与决定

### 选项1: 直接覆盖

- 优点：实现简单。
- 缺点：更新失败可能破坏 CLI。
- 决定：弃用。

### 选项2: 备份后覆盖

- 优点：安全性高，可回滚。
- 缺点：稍增加复杂度。
- 决定：采用。

### 选项3: 引入锁机制

- 优点：避免并发冲突。
- 缺点：实现复杂，场景罕见。
- 决定：弃用。

最终决策：
- 采用备份方案。
- 不实现锁机制。
- 自动更新，无 `--no-update` 参数。
- 不做 checksum 校验。
- 使用 `os.tmpdir()` 作为临时目录。
- 暂不考虑插件独立更新。

---

## 📊 技术约束与注意事项

- TypeScript 编写，导出类型签名。
- 用 `fs`、`path` 保证跨平台。
- 临时目录使用 `os.tmpdir()`。
- catch 所有网络、文件异常，用 `console.warn()`。
- 更新提示需标准化输出。
- 避免全局变量，模块内部用局部状态。

---

## ❓ 待解决的技术课题

- 是否在更新前打印 diff 供调试。
- 备份文件如何自动清理（目前不清理）。
- 未来是否支持代理或镜像源下载。
- 未来插件更新如何拆分职责。

---

## 🛡 推荐 TypeScript 类型签名

### 主入口 API

```ts
export interface CheckAndUpdateOptions {
  debug: boolean;
  version: string;
  registryBase?: string;
  name: string;
  channel?: 'latest' | 'next' | 'canary';
  skipOnCI?: boolean;        // 默认 true
  updateCheckIntervalMs?: number; // 默认 6h
  dryRun?: boolean;               // 仅打印不执行
}

export async function checkAndUpdate(
  opts: CheckAndUpdateOptions
): Promise<void>;
```

