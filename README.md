# dsh-plugin-rtk-hooks

让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 使用 [RTK](https://www.rtk-ai.app/) 优化终端命令和输出。

## 特性

- **拒绝式命令提示**：在 `bash` / `pwsh` 执行前调用 `rtk hook check`。RTK 找到更省 token 的写法时，插件拒绝本次调用并把推荐命令返回给模型。
- **可选输出过滤**：在工具执行完成后调用 `rtk pipe`，压缩 `git`、`grep`、`find`、测试工具等命令的文本输出。
- **安全回退**：RTK 不支持的命令直接放行；RTK 不可用或过滤失败时保留原始结果。
- **防止循环**：同一条命令连续拒绝达到上限后自动放行。
- **审计一致**：插件不接管 DSH 原生工具，也不偷偷改写工具入参，因此历史、审计、UI 和实际执行命令保持一致。

## 工作原理

DSH 当前的 `tools/pre-execute` 扩展点不允许直接重写工具参数。插件采用拒绝式流程：

```text
模型请求 git status
        |
        v
rtk hook check "git status"
        |
        v
DSH 返回 deny: 请重试 rtk git status
        |
        v
模型重新发起 rtk git status
```

这种方式会增加一次模型重试，但不会造成“界面显示执行了 `git status`、实际执行了 `rtk git status`”的不一致。

## 前置条件

- 已安装最新版 DSH。
- 已安装 RTK，并且 `rtk` 在 DSH 进程的 `PATH` 中。
- Node.js 和 pnpm 用于从源码构建插件。

检查 RTK：

```powershell
rtk --version
rtk hook check "git status"
```

## 安装到 desktop profile

### 1. 添加本地插件依赖

编辑 `~/.dsh/profiles/desktop/package.json`，在 `dependencies` 中加入：

```json
{
  "dsh-plugin-rtk-hooks": "link:C:/path/to/dsh-plugin-rtk-hooks"
}
```

同时把包名加入 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-plugin-rtk-hooks"
      ]
    }
  }
}
```

将示例中的路径替换为插件实际路径。当前仓库的路径是：

```text
C:/Users/lingxin/Desktop/dsh-plugin/dsh-plugin-rtk-hooks
```

### 2. 添加 Cordis patch

编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`，加入：

```yaml
- insert:
    - id: rtk-hooks
      name: dsh-plugin-rtk-hooks
      config:
        denyOnMiss: true
        filterOutput: false
        maxDenialsPerCommand: 3
```

### 3. 安装依赖并重启 DSH

```powershell
pnpm install
```

完全退出并重新启动 DSH 后，插件加载生效。

## 配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `denyOnMiss` | boolean | `true` | RTK 有推荐命令时是否拒绝原命令并要求重试 |
| `filterOutput` | boolean | `false` | 是否使用 `rtk pipe` 压缩工具输出 |
| `executable` | string | `rtk` | RTK 可执行文件名称或绝对路径 |
| `maxDenialsPerCommand` | number | `3` | 同一命令最多拒绝次数 |
| `timeoutMs` | number | `5000` | 每次 RTK 子进程超时，单位为毫秒 |
| `filters` | object | `{}` | 按命令名覆盖 RTK filter 映射 |

### 推荐配置

先只启用命令提示：

```yaml
config:
  denyOnMiss: true
  filterOutput: false
  maxDenialsPerCommand: 3
```

确认工作稳定后，再开启输出过滤：

```yaml
config:
  denyOnMiss: true
  filterOutput: true
  maxDenialsPerCommand: 3
  filters:
    pnpm: tsc
    git: git-status
```

内置 filter 映射包括：

- `git status` -> `git-status`
- `git diff` -> `git-diff`
- `git log` -> `git-log`
- `grep` / `rg` -> `grep`
- `find` -> `find`
- `pytest` -> `pytest`
- `phpunit` -> `phpunit`
- `cargo` -> `cargo-test`

显式配置会覆盖内置映射。

## 限制

- 插件不会自动修改 `bash` / `pwsh` 的原始参数。需要零额外模型往返的强制改写时，应使用 DSH 原生支持的 input-rewrite 能力（如果后续版本提供）。
- 拒绝式流程依赖模型根据 deny 原因重新发起命令；`maxDenialsPerCommand` 只是防止无限重试，不是强制策略绕过。
- 输出过滤只处理纯文本结果。非文本内容、错误结果和 RTK 失败结果会保留原始输出。
- filter 是按命令类型推断的。遇到项目专用命令时，应通过 `filters` 显式配置。

## 开发

```powershell
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

源码入口是 `src/index.ts`，构建产物位于 `lib/`。测试使用 Node.js 原生 test runner。

## 许可证

MIT
