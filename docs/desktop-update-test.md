# 桌面版在线更新测试

当前程序版本是 `1.0.0`，建议保留它作为旧版，再发布 `1.0.1` 验证更新。
本功能只用于 Electron 桌面版：启动约 8 秒后检查 GitHub 正式 Release，有新版则提示并打开下载链接，下载后手动替换；浏览器 / PWA 不走这套流程。

## 1. 先确认发布前提

- 在未登录 GitHub 的浏览器中打开 <https://github.com/befoer/oshi-calendar>，应能访问。
- 仓库必须允许用户免登录访问 Release；若仓库为私有，请由仓库所有者决定是否公开。不要在客户端放 GitHub 令牌。
- 仓库的 Actions 功能和 `Release desktop` 工作流可用。
- 当前检查接口：<https://api.github.com/repos/befoer/oshi-calendar/releases/latest>。没有正式 Release 时返回 404 属正常现象；发布完成后应返回 200。

检查接口的 PowerShell 命令（无需令牌）：

```powershell
Invoke-RestMethod 'https://api.github.com/repos/befoer/oshi-calendar/releases/latest' |
  Select-Object tag_name, draft, prerelease, html_url
```

只推送 `main` 不会发布版本。工作流只在推送 `v*` 标签时打包；更新器只看正式 Release，草稿和预发布版不用于此次测试。

## 2. 保留旧版并准备数据

1. 把现有 `release/推日-1.0.0-文件夹版.zip` 解压到单独目录，例如 `F:\推日更新测试\旧版`，不要在后续构建时覆盖它。
2. 用其中的 `推日.exe` 启动。在“设置 → 关于”确认显示桌面版 `1.0.0`。
3. 添加一位测试角色或一条测试任务，记录名字，并通过设置导出 JSON 备份。
4. 关闭程序。保留旧版旁边完整的 `推日数据` 文件夹。

测试时关闭其他推日实例，包括通过 `start.cmd` 启动的浏览器本地服务。桌面版固定使用 `127.0.0.1:36524`，已有本地服务可能让新程序复用旧服务，影响验证。

## 3. 发布 1.0.1

先确认上面的前提都满足。以下命令会创建正式发布标签并触发 GitHub Actions，应在准备正式发布时执行：

```powershell
Set-Location 'F:\project\创作日历'
git status --short
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

执行前应已提交其他所需改动；若有未提交文件，先检查，避免漏发。`npm version` 同步更新两个版本文件。标签中的 `1.0.1` 必须与 `package.json` 相同。若 `v1.0.1` 已存在，选择尚未使用的新版本号，并同步替换上述命令；不要覆盖已发布标签。

打开 <https://github.com/befoer/oshi-calendar/actions>，等待 `Release desktop` 成功。然后检查 <https://github.com/befoer/oshi-calendar/releases>：

- 标题和标签为 `推日 v1.0.1` / `v1.0.1`。
- 是已发布的正式版本，而非 Draft 或 Pre-release。
- 附件有 `推日-1.0.1-文件夹版.zip` 与 `推日-1.0.1-便携版.exe`。
- 免登录访问 `releases/latest` 返回 200，`tag_name` 为 `v1.0.1`。

## 4. 在旧版验证提示

1. 打开保留的 `1.0.0` 旧版，等待约 8 秒。
2. 应出现“推日有新版本”，显示当前 `1.0.0`、新版 `1.0.1`。
3. 第一次选“稍后”，关闭再打开，仍应提示。
4. 选“跳过这个版本”，关闭再打开，不应再次自动提示同一版本。
5. 即使跳过，进入“设置 → 关于 → 检查更新”，仍应发现 `1.0.1`。
6. 点击“下载 1.0.1”，应由系统浏览器打开 GitHub 下载地址。当前实现优先选择文件夹版 ZIP，即使旧版是便携版也是如此。

“跳过”偏好保存在 `推日数据/desktop-settings.json`，不会禁止手动检查更新。

## 5. 替换程序并检查数据

1. 关闭所有推日窗口及本地推日服务。
2. 将下载的 ZIP 解压到新目录，例如 `F:\推日更新测试\新版`。
3. 把旧版旁边的整个 `推日数据` 文件夹复制到新版 `推日.exe` 旁边。应在两个版本都关闭时复制。
4. 打开新版，在“设置 → 关于”确认版本 `1.0.1`，手动检查应显示“已是最新版本”。
5. 检查测试角色、任务和原有设置是否仍在。保留旧版和备份，确认无误后再自行清理。

便携版也可验证：关闭程序，把新版便携 EXE 放在旧 EXE 所在目录，继续使用旁边同一个 `推日数据` 文件夹。若换目录，需复制该文件夹。测试副本与正式使用目录应分开。

## 6. 故障排查与验收

| 现象 | 检查 |
| --- | --- |
| GitHub API 返回 404 | 仓库是否公开、是否已有正式 Release；能登录查看仓库不代表免登录更新器能访问 |
| 推送代码后没提示新版 | 是否推送了新版本标签、Actions 是否成功、版本号是否大于旧版 |
| Actions 报版本不一致 | 标签去掉 `v` 后必须等于 `package.json` 的版本 |
| 预发布版本没有提示 | 当前设计只接受正式版本；测试请选择正式发布 |
| 启动无提示但手动能发现 | 是否跳过了此版本；是否等够约 8 秒 |
| 手动检查网络失败 | 系统浏览器能否访问 GitHub API；检查系统网络与代理 |
| 新版页面像旧版 | 关闭占用 36524 的旧推日服务，退出所有推日实例后重开 |
| 数据不见了 | 是否在 EXE 旁复制了原来的 `推日数据`；浏览器 / PWA 与桌面版数据独立 |

完整验收应包括：旧版发现新版、稍后仍提示、跳过抑制自动提示、手动检查绕过跳过、下载链接正确、新版版本号正确、数据保留、新版显示已是最新版本。断网时自动检查应安静失败，手动检查应显示网络错误。
