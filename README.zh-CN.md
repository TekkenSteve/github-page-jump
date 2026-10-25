# ⏭️ GitHub Page Jump

[English](README.md) | **简体中文**

一个零构建的 Chrome Manifest V3 扩展,为 GitHub 分页器补充首页、末页与页码直跳能力——包括
那些只给 Previous / Next、连页码都不显示的游标列表。

[![CI](https://github.com/TekkenSteve/github-page-jump/actions/workflows/ci.yml/badge.svg)](https://github.com/TekkenSteve/github-page-jump/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

| 带页码的分页器(搜索结果)                                                             | 无页码列表(`?tab=repositories`)                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| ![GitHub 搜索页上的首页、页码输入与末页控件](docs/screenshots/numbered-controls.png) | ![GitHub 自己的 Previous 与 Next 之间注入的页码窗口](docs/screenshots/page-pager.png) |

| 游标列表索引中(暗色主题)                                                                 | 工具栏弹窗                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| ![页码窗口正在后台索引游标列表,显示进度与取消按钮](docs/screenshots/cursor-indexing.png) | ![工具栏弹窗中的"固定分页器"开关](docs/screenshots/popup.png) |

所有截图均来自在真实 GitHub 页面上运行的扩展源码。

## ✨ 功能

- ⏮️ 在显示页码的分页器上补充**首页**与⏭️**末页**按钮。
- 🔢 **输入页码后按回车**即可直达。
- 📄 在隐藏页码的列表上,于 GitHub 自己的 Previous 与 Next **之间**注入页码窗口
  (`1 2 3 … n`),并在你浏览列表的同时自动在后台建立索引。原生的上一页/下一页按钮
  原样保留——顺序翻页仍归 GitHub,窗口只负责直达。
- 🔗 兼容 GitHub 当前的两种无页码列表:`page` 参数列表(个人主页的 `?tab=repositories`、
  `?tab=followers`)与不透明的 `after` 游标列表(`?tab=stars`、`/tags`、`/commits`),
  包括没有任何 `after=` 链接的游标链末页。
- 📌 **固定分页器**偏好:把分页器钉在视口底部,通过工具栏弹窗开关(默认关闭)。
- 🌗 控件全部使用 GitHub 的 Primer 颜色变量,自动跟随亮色、暗色与高对比度主题。
- 🔁 兼容 GitHub 的局部页面导航(Turbo 与 PJAX)。
- ♿ 无障碍支持:真实按钮、GitHub 自己的 `Page N` 命名约定、`aria-current="page"`、
  内联校验提示与实时进度状态。

## 📋 环境要求

- Chrome 116 及以上(理论上任何支持 Manifest V3 的 Chromium 内核浏览器均可,仅在 Chrome 上测试过)。

## 📦 安装

从源码安装(开发者模式):

1. 打开 `chrome://extensions/`。
2. 开启右上角的**开发者模式**。
3. 点击**加载已解压的扩展程序**,选择本目录(包含 `manifest.json` 的那个)。

从 Release 安装:

1. 在 [releases](https://github.com/TekkenSteve/github-page-jump/releases) 页面下载
   `github-page-jump-v<版本号>.zip`。
2. 解压到任意位置,再按上面的步骤加载解压后的目录。

安装或升级后,已经打开的 GitHub 标签页需要刷新——内容脚本只在页面加载时注入。

## 🔍 工作原理

GitHub 有三种可用的分页形态,扩展会为每个列表选择对应策略:

| 形态         | 示例                                  | 跳到第 N 页                       | 找到末页                                                                 |
| ------------ | ------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| 带页码链接   | 搜索结果                              | 瞬时——直接复用 GitHub 自己的链接  | 瞬时——页码本来就在                                                       |
| `page` 参数  | `?tab=repositories`、`?tab=followers` | 瞬时——改写成 `?page=N`,**零请求** | 指数扫描 + 二分查找,约 `2·log₂(页数)` 次请求(4 页约 4 次,100 页约 13 次) |
| `after` 游标 | `?tab=stars`、`/tags`、`/commits`     | 沿游标链遍历,每页一次请求         | 遍历到链条尽头                                                           |

对两种无页码形态,扩展在 GitHub 自己的 Previous 与 Next **之间**注入同一个通用页码窗口,
并**在列表渲染出来的那一刻**自动开始建索引,而不是等你点击。页码随索引推进逐渐补齐,等你
想要跳页时,大多数页码早已是可点的链接。顺序翻页仍走 GitHub 自己的链接、用 GitHub 自己的
文案。

- 游标遍历按每 120 毫秒一次的节流执行,上限 300 跳;进度("Indexing page 7"/"Probing
  page 4")内联显示,随时可取消。
- 窗口只渲染当前已能直达的页码;尚未索引到的部分,GitHub 原生 Next 一步即达,遍历随后
  补齐。
- 发现的游标与总页数缓存在 `sessionStorage` 中,保留 30 分钟;此后同标签页内的跳转即时生效。
- 网络或解析失败绝不会弄坏页面——窗口显示错误信息,GitHub 原生控件照常可用。

本身显示页码的列表继续使用数字控件,只有一页的列表不注入任何控件。

## 🔒 权限与隐私

扩展只在 `https://github.com/*` 上运行,只申请 `storage` 一项权限,用于记住"固定分页器"偏好。
在无页码列表上,它会用浏览器里已有的会话 Cookie **同源**拉取 github.com 的列表页,从标记里读出
下一个游标或页码。不会向任何第三方发送数据,也不收集任何信息。详见
[PRIVACY.md](PRIVACY.md)。

## 🩺 故障排查

在 GitHub 标签页的控制台执行以下命令,可以看到扩展的判定结果:

```js
GitHubPageJumpController.report();
```

每条记录包含分页器根元素、接收控件的宿主元素、判定出的策略(`numeric`、`page`、`cursor` 或
`null`)以及注入的控件组数量。空数组表示没有匹配到分页器;`mode: null` 表示找到了分页器但
没有可跳转的链接。

其他常见情况:

- **安装后没有控件**——刷新标签页(见[安装](#-安装))。
- **页码随索引逐渐增多**——这就是后台遍历;点击任意页码即可排队等待,或按"取消索引"停止。
- **列表页数比预期少**——遍历上限为 300 跳;更长的列表中,已到达的页面照常可用。

## ❓ 常见问题

- **扩展为什么要发网络请求?** 只在无页码列表上、且只访问 github.com 本身——与你点击
  "Next" 时浏览器发出的请求完全一样。有节流、有上限、有缓存,绝不涉及第三方。
- **支持 Firefox 吗?** 不支持。目前仅面向 Manifest V3 的 Chromium 内核浏览器。
- **gist.github.com 或移动版可以用吗?** 不行——内容脚本只匹配 `https://github.com/*`。
- **怎么重置索引缓存?** 缓存位于标签页的 `sessionStorage`,30 分钟自动过期;刷新标签页即可重来。

## 🗂️ 项目结构

```
manifest.json        Manifest V3 声明(内容脚本、弹窗、图标)
icons/               工具栏图标(16/32/48/128 及 SVG 源文件)
src/
  core.js            纯分页与 URL 逻辑(无 DOM、无 Chrome API)
  cursor.js          游标链索引器(after 游标的无页码列表)
  pageindex.js       page 参数索引器(page= 列表,探测总页数)
  shared.js          本地化、设置定义与存储适配器
  pagination.js      GitHub DOM 适配、控件注入与生命周期
  content.js         内容脚本入口
  popup.html/js/css  工具栏弹窗(固定分页器开关)
  types.d.ts         供 tsc --noEmit 使用的共享结构类型
tests/               单元测试、jsdom 辅助工具与浏览器 fixture 页面
scripts/             发布打包与版本校验脚本
docs/screenshots/    README 使用的截图
```

## 🛠️ 开发

需要 Node.js 20.11 及以上。没有运行时依赖,开发也无需构建步骤。

```sh
npm install     # 仅安装开发工具链
npm run verify  # 代码检查 + 格式 + 类型 + 版本校验 + 测试 + 打包
```

| 脚本                    | 用途                                        |
| ----------------------- | ------------------------------------------- |
| `npm run lint`          | 对 `src`、`tests`、`scripts` 运行 ESLint    |
| `npm run lint:fix`      | ESLint 自动修复                             |
| `npm run format`        | Prettier 写入格式                           |
| `npm run format:check`  | Prettier 校验(CI 使用)                      |
| `npm run typecheck`     | 对 JSDoc 注释源码运行 `tsc --noEmit`        |
| `npm test`              | Node 测试运行器(`node:test`)                |
| `npm run test:watch`    | Node 测试运行器监视模式                     |
| `npm run check:version` | 断言 `package.json` 与 `manifest.json` 一致 |
| `npm run build`         | 生成 `dist/github-page-jump-v<版本>.zip`    |

### 架构

源码按职责分层,每层都可以独立测试:

- `core.js` 是纯逻辑:页码解析、page 参数推断、URL 构造。
- `cursor.js` 不依赖 DOM:通过注入的抓取器遍历 `after` 游标,负责节流、取消,并把页码解析成 URL。
- `pageindex.js` 不依赖 DOM:改写 `page` 参数实现瞬时跳页,用指数扫描加二分查找探测总页数。
- `shared.js` 负责文案包,以及围绕 `chrome.storage.sync` 的适配层(API 不可用时优雅降级)。
- `pagination.js` 通过依赖注入接收 `document`、`window`、文案、调度器与页面抓取器,
  这正是测试能在 jsdom 下驱动它的原因。

两个索引器暴露同一份 `ListIndex` 契约,因此 `pagination.js` 只渲染一套通用控件,由 `classify()`
决定列表用哪种策略:页码直接可见(`numeric`)、`page` 参数(`page`)或 `after` 游标(`cursor`)。

两个扩展点覆盖绝大多数后续改动:

- **新的 GitHub 标记**:在 `PAGINATION_ADAPTERS` 中加一条(选择器、可选宿主选择器、旧版样式
  标志)。
- **新的偏好设置**:先在 `SETTING_DEFINITIONS` 注册,再通过共享设置存储读取与订阅。

新增源码模块时,记得同步 `manifest.json` 与 `tests/fixture.html` 中的脚本顺序。

### 测试

- `tests/core.test.js` 覆盖纯逻辑。
- `tests/cursor.test.js` 通过可注入的页面抓取器覆盖游标提取、链遍历、节流、取消与缓存。
- `tests/pageindex.test.js` 覆盖参数改写、下一页链接判定、有界总页数探测、取消与缓存。
- `tests/shared.test.js` 用内存版 Chrome 替身覆盖本地化与存储适配器。
- `tests/pagination.test.js` 在 jsdom 下,以注入的帧调度器和可观察的 `location` 替身驱动控制器。
- `tests/fixture.html` 渲染所有受支持的分页结构,配合伪抓取器在真实浏览器中手动验证,无需网络。

### 发布

保持 `package.json#version` 与 `manifest.json#version` 一致(`npm run check:version` 强制
校验)。当改动 `package.json#version` 的提交进入 `main` 时,Release 工作流会运行全部校验、打包
扩展、创建 `v<版本号>` tag,并发布附带 ZIP 的 GitHub Release。仅改动 `package.json` 其他字段
不会触发发布。

## 🤝 参与贡献

欢迎在 [TekkenSteve/github-page-jump](https://github.com/TekkenSteve/github-page-jump)
提 Issue 与 Pull Request。提交前请先跑一遍 `npm run verify`。

## 📄 许可证

[MIT](LICENSE)——变更记录见[更新日志](CHANGELOG.md)。
