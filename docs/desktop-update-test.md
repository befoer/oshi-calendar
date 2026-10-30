# 桌面版在线更新测试

安装版使用 electron-updater：检查新版 → 下载（显示进度）→ 确认重启并安装。后续更新保留数据，无需解压或复制文件。

## 首次使用安装版

1. 旧便携版 / 文件夹版在「设置 → 数据与备份」导出 JSON，关闭推日。
2. 运行 `oshi-calendar-1.0.0-setup.exe` 安装，打开后导入备份。备份不含密钥，需要重新填写一次。
3. 安装版数据固定保存在 `%APPDATA%\OshiCalendar`，以后升级自动沿用。旧版数据仍在原来的 `推日数据` 文件夹中。

旧程序不包含自动安装代码，需要完成这一次转换。便携版与文件夹版仍使用下载替换方式；浏览器 / PWA 不使用桌面更新器。

## 发布前提

- GitHub Release 必须能免登录访问，不能把 GitHub 令牌放入客户端。
- 仓库启用 Actions，`Release desktop` 工作流成功。
- 正式 Release 包含 `oshi-calendar-版本-setup.exe`、对应 `.blockmap` 和 `latest.yml`。不要手动修改安装包或清单的 SHA-512。
- 只推送 main 不发布新版；推送 `v*` 标签才会触发发布。标签版本必须等于 package.json，且新版本号更大。

## 完整测试：1.0.0 → 1.0.1

1. 用当前代码构建并安装 1.0.0：`npm ci`，然后 `npm run electron:build`。安装包在 `release/`。
2. 添加测试角色、任务和设置，在「设置 → 关于」确认 1.0.0，保留 JSON 备份。
3. 开发者准备发布时执行以下命令（若版本号已用过，改用下一个版本，不能覆盖已有标签）：

```powershell
Set-Location 'F:\project\创作日历'
git pull --ff-only origin main
npm version 1.0.1 --no-git-tag-version
npm test
npm run build
git add package.json package-lock.json
git commit -m 'chore: release 1.0.1'
git push origin main
git tag -a v1.0.1 -m '推日 1.0.1'
git push origin v1.0.1
```

执行前确认功能改动已经提交，工作区干净。打开 [Actions](https://github.com/befoer/oshi-calendar/actions)，等待发布成功，检查 [Releases](https://github.com/befoer/oshi-calendar/releases) 中的安装包和清单。选择正式发布，不使用草稿或预发布版本。

4. 打开已安装的 1.0.0，约 8 秒后应提示新版。测试“稍后”和“跳过这个版本”；即使跳过，设置里手动检查仍可发现新版。
5. 选择下载，应在软件内完成下载；设置中显示进度，完成后变为“重启并安装”。
6. 点击“重启并安装”，先取消确认，软件应继续运行；再次点击并确认，软件应退出、安装新版并重新打开。
7. 设置显示 1.0.1，原有角色、任务、头像、设置和密钥均保留。再次检查应显示最新版本。

测试前关闭通过 `start.cmd` 打开的旧本地服务，否则桌面版可能复用 36524 端口上的旧页面。不要同时运行不同版本。

## 异常验收

- 断网：自动检查安静失败，手动检查显示错误，恢复网络后可重试。
- 下载中断：不允许安装不完整文件，重新检查后可重试。
- 下载期间重复点击：仅执行一次下载；下载完成前不显示安装按钮。
- 缺少 latest.yml / 安装包、清单校验失败：提示错误，不执行安装。
- 重启前保存正在编辑的内容，更新器只保留已经保存的数据。

私有仓库、没有正式 Release 或网络无法访问 GitHub 时，无法完成真实在线更新验证。安装包本地构建成功不等于线上更新已通过；至少完成一次上述跨版本测试才能确认。
