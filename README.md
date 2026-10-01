# dsh-plugin-rtk-hooks

让最新版 DSH 使用 [RTK](https://www.rtk-ai.app/) 的两项能力：

- **拒绝式命令提示**：在 `bash` / `pwsh` 执行前调用 `rtk hook check`。如果 RTK 能改写命令，插件返回 `deny`，模型会看到确定的重试命令；RTK 不支持的命令直接放行。
- **可选输出过滤**：在工具完成后按命令类型调用 `rtk pipe`。默认关闭，避免对未知命令使用错误过滤器。

插件不接管 DSH 的 `bash` 或 `pwsh` 工具，也不改写原始入参，因此历史、审计、UI 和实际执行保持一致。

## 安装到 desktop profile

在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 和 `dsh.profile.bundles` 中加入：

```json
"dsh-plugin-rtk-hooks": "link:C:/Users/lingxin/Desktop/dsh-plugin/dsh-plugin-rtk-hooks"
```

```json
"dsh-plugin-rtk-hooks"
```

然后在 `~/.dsh/profiles/desktop/cordis.patch.yml` 增加：

```yaml
- insert:
    - id: rtk-hooks
      name: dsh-plugin-rtk-hooks
      config:
        denyOnMiss: true
        filterOutput: false
        maxDenialsPerCommand: 3
```

重启 DSH 后生效。当前机器已有 `rtk` 时无需额外配置；如果可执行文件不在 PATH，可设置 `executable: C:/path/to/rtk.exe`。

## 输出过滤

开启后，插件会对 `git status`、`git diff`、`git log`、`grep`、`find`、`cargo`、`pytest`、`phpunit` 使用对应的 RTK filter。也可以显式指定：

```yaml
filterOutput: true
filters:
  pnpm: pnpm
  tsc: tsc
```

`maxDenialsPerCommand` 默认是 3。达到上限后插件放行，防止模型在同一条命令上循环重试。

## 开发

```powershell
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```
