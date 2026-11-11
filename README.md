# LinuxReader

Linux 桌面的电子书阅读器，EPUB 与 PDF，做得像 Apple 图书那样顺手：六套阅读主题、
可微调的排版、四色高亮与笔记、左侧目录/书签/高亮三栏、歌词式跟读、平滑滚动，
书籍与笔记可以用你自己的云盘（WebDAV）或本地目录同步。

- 打包好的 deb：[`dist/linuxreader_1.0.2_amd64.deb`](dist/linuxreader_1.0.2_amd64.deb)（74MB，自带 Electron 运行时，装完即用）
- 项目地址：<https://github.com/shao-jun/LinuxReader>
- 许可证：MIT © 2026 ftosoft

## 安装

从仓库里下载 deb（或自己跑 `./build/build-deb.sh` 生成），然后：

```bash
sudo dpkg -i linuxreader_1.0.2_amd64.deb     # 依赖报错时补 sudo apt -f install
```

装完后应用菜单里出现 **LinuxReader**，`.epub` 双击默认用它打开
（系统级默认写在 `/etc/xdg/mimeapps.list`，用户自己的 `~/.config/mimeapps.list` 仍可覆盖）。
也可以在文件管理器里「用其他应用打开 → LinuxReader」，或在命令行：

```bash
linuxreader 书.epub          # 直接打开这本书
linuxreader                  # 打开书库
```

卸载：`sudo dpkg -r linuxreader`（数据留在 `~/.local/share/linuxreader`，手动删掉即可）。

## 功能

**书库**：网格/列表两种视图，合集、标签、收藏、封面、按标题/作者/标签搜索，拖拽或「导入书籍」导入 EPUB/PDF。

**阅读**
- EPUB 与 PDF（PDF 按原样嵌入显示）
- 翻页 / 滚动两种阅读方式；翻页动效四种：滑动、翻页、淡入淡出、滚动
- 流畅滚动：滚轮与翻页都走 `requestAnimationFrame` 缓动，不是生硬跳转

**排版（Aa 面板）**
- 六套主题：原始、安静、纸张、粗体、平静、专注；每套自带一整套默认排版
- 切主题后仍可逐项微调：字体（宋体/黑体/楷体/仿宋）、粗体开关、字号、行距、字距、词距、页边距
- 界面外观：浅色 / 深色 / 跟随系统
- 「恢复该主题的默认排版」一键回到预设

**左侧栏（打开书后默认展开）**
三栏都在左侧，占位排版而不遮挡正文：
- 目录：按层级缩进的章节列表，当前章高亮，点击跳转
- 书签：按位置排序，可删除
- 高亮标记：四色高亮 + 下划线 + 笔记，可按「全部 / 有笔记 / 仅高亮」筛选
点任意条目跳到位置，阅读区左上出现「← 返回阅读位置」，一键回到原处。

**笔记**：选中正文即弹出操作条——黄/绿/蓝/粉高亮、下划线、写笔记、复制、搜索。
高亮与笔记随书保存，跟随同步。

**键盘**：`←/→` 或空格翻页，`Ctrl+B` 展开/收起左侧栏，`B` 加书签，
`Esc` 先关浮层、再按回书库（等同于左上角「‹ 书库」）。

**歌词模式**：把当前章切成句子，逐句高亮并居中自动滚动，像跟着歌词读；
配合系统朗读（`espeak-ng`，装了就能用）可以边听边看。

**同步**：设置里填自己的账号，两种方式
- WebDAV：坚果云、Nextcloud、群晖等，填地址 + 账号 + 应用密码
- 本地目录：适合已经挂载的网盘目录（UOS 云盘、OneDrive 同步盘等）
只同步书籍、封面、进度与笔记；凭据只写在本机 `~/.local/share/linuxreader/sync.json`。

## 从源码运行

```bash
npm install
npm start                 # 需要 Electron 33
npm run start:debug       # 带 --remote-debugging-port=9223，方便 CDP 调试
```

## 打包

```bash
./build/build-deb.sh      # 产物在 dist/
```

脚本做三件事：把 `node_modules/electron/dist` 装进 `/opt/linuxreader`、把
`src/` 与 `package.json` 放进 `resources/app`、写好 `.desktop`（含
`MimeType=application/epub+zip;application/pdf;` 与 `%F`）与 hicolor 图标，
postinst 里更新桌面数据库并把 EPUB 的系统级默认程序指过来。

## 目录结构

```
src/main/       主进程：窗口、linuxreader:// 协议、书籍导入、EPUB 解包、WebDAV 同步、TTS
src/main/epub.js    零依赖 ZIP/EPUB 解析 + 书籍 HTML 安全化（去脚本）
src/renderer/   界面：书库、阅读引擎、排版、高亮笔记、歌词模式
build/          deb 打包脚本与图标
tools/          测试工具：生成测试 EPUB、CDP 探测脚本
```

## 数据

`~/.local/share/linuxreader`
└── books/<id>/{book.epub|book.pdf, src/, meta.json, annotations.json, cover.*}
└── library.json、settings.json、sync.json
