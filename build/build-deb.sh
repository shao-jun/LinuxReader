#!/bin/bash
# 打包 LinuxReader 为 deb（Electron 运行时随包分发）
set -e
cd "$(dirname "$0")/.."

APP=linuxreader
VER=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
ARCH=amd64
ROOT=build/pkgroot
OUT="dist/${APP}_${VER}_${ARCH}.deb"

rm -rf "$ROOT" dist
mkdir -p dist "$ROOT"/DEBIAN \
         "$ROOT"/opt/$APP/resources/app \
         "$ROOT"/usr/bin \
         "$ROOT"/usr/share/applications \
         "$ROOT"/usr/share/icons/hicolor \
         "$ROOT"/usr/share/doc/$APP \
         "$ROOT"/usr/share/$APP

echo "== 复制 Electron 运行时 =="
cp -a node_modules/electron/dist/. "$ROOT/opt/$APP/"
rm -rf "$ROOT/opt/$APP/resources/default_app.asar"
# 只留中英文语言包（locales 原本 40MB，绝大部分用不到）
if [ -d "$ROOT/opt/$APP/locales" ]; then
  find "$ROOT/opt/$APP/locales" -maxdepth 1 -type f -name '*.pak' \
    ! -name 'zh-CN.pak' ! -name 'zh-TW.pak' ! -name 'en-US.pak' ! -name 'en-GB.pak' -delete
fi

echo "== 复制应用代码 =="
cp -a src package.json "$ROOT/opt/$APP/resources/app/"
[ -f LICENSE ] && cp LICENSE "$ROOT/opt/$APP/resources/app/"
[ -f README.md ] && cp README.md "$ROOT/opt/$APP/resources/app/"

echo "== 图标 =="
for s in 64 128 256 512; do
  mkdir -p "$ROOT/usr/share/icons/hicolor/${s}x${s}/apps"
  rsvg-convert -w $s -h $s build/icon.svg -o "$ROOT/usr/share/icons/hicolor/${s}x${s}/apps/$APP.png"
done
cp "$ROOT/usr/share/icons/hicolor/256x256/apps/$APP.png" "$ROOT/opt/$APP/resources/app/icon.png"

echo "== 启动器 / 桌面项 =="
ln -sf "/opt/$APP/electron" "$ROOT/usr/bin/$APP"
cat > "$ROOT/usr/share/applications/$APP.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=LinuxReader
Name[zh_CN]=LinuxReader 阅读器
GenericName=Ebook Reader
GenericName[zh_CN]=电子书阅读器
Comment=Read EPUB and PDF with highlights, notes and a lyrics-style reading mode
Comment[zh_CN]=EPUB / PDF 阅读器：高亮、笔记、歌词模式、WebDAV 同步
Exec=/opt/$APP/electron %F
TryExec=/opt/$APP/electron
Icon=$APP
Terminal=false
Categories=Office;Viewer;
Keywords=ebook;epub;pdf;reader;book;
Keywords[zh_CN]=电子书;阅读器;书籍;图书;
MimeType=application/epub+zip;application/pdf;
StartupWMClass=LinuxReader
StartupNotify=true
DESKTOP

cp build/associate.py "$ROOT/usr/share/$APP/associate.py"

echo "== 版权 / 控制信息 =="
cat > "$ROOT/usr/share/doc/$APP/copyright" <<COPY
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: LinuxReader
Source: https://github.com/shao-jun/LinuxReader

Files: *
Copyright: 2026 ftosoft
License: MIT
COPY
gzip -9 -c CHANGELOG.md > "$ROOT/usr/share/doc/$APP/changelog.gz" 2>/dev/null || true

SIZE_KB=$(du -sk "$ROOT" | awk '{print $1}')
cat > "$ROOT/DEBIAN/control" <<CONTROL
Package: $APP
Version: $VER
Section: office
Priority: optional
Architecture: $ARCH
Installed-Size: $SIZE_KB
Depends: libgtk-3-0, libnss3, libxss1, libasound2, libgbm1, libxtst6, xdg-utils
Recommends: espeak-ng | espeak
Maintainer: shao-jun <shao-jun@users.noreply.github.com>
Homepage: https://github.com/shao-jun/LinuxReader
Description: LinuxReader —— Linux 桌面电子书阅读器
 EPUB / PDF 阅读器，支持六套阅读主题与自定义排版、高亮与笔记、
 目录/书签/高亮三栏侧边栏、歌词模式、平滑滚动与四种翻页动效，
 并可通过用户自己的 WebDAV 或本地目录同步书籍与笔记。
CONTROL

cat > "$ROOT/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
  command -v python3 >/dev/null 2>&1 && python3 /usr/share/linuxreader/associate.py || true
fi
exit 0
POSTINST

cat > "$ROOT/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
fi
exit 0
POSTRM

chmod 755 "$ROOT/DEBIAN/postinst" "$ROOT/DEBIAN/postrm"
chmod 644 "$ROOT/DEBIAN/control" "$ROOT/usr/share/applications/$APP.desktop" \
          "$ROOT/usr/share/$APP/associate.py" "$ROOT/usr/share/doc/$APP/copyright"
chmod 755 "$ROOT/opt/$APP/chrome-sandbox" 2>/dev/null || true
[ -f "$ROOT/opt/$APP/chrome-sandbox" ] && chmod 4755 "$ROOT/opt/$APP/chrome-sandbox" 2>/dev/null || true

echo "== 构建 $OUT =="
dpkg-deb --build --root-owner-group "$ROOT" "$OUT"
ls -lh "$OUT"
