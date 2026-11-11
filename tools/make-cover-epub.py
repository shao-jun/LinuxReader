#!/usr/bin/env python3
"""生成一本"首屏是整页图片"的测试 EPUB：
没有 <meta name="cover">，第一页是一张 <img> 或 <svg><image>，图片名也不叫 cover。
用来验证阅读器会不会把首屏图片识别成书籍封面。"""
import os, sys, zipfile, io

OUT = os.path.join(os.path.dirname(__file__), '封面图测试.epub')

def make_jpeg(path, w=600, h=900):
    from PIL import Image, ImageDraw
    img = Image.new('RGB', (w, h), (38, 48, 78))
    d = ImageDraw.Draw(img)
    for i in range(0, h, 6):
        d.line([(0, i), (w, i)], fill=(38 + i % 40, 48 + i % 30, 78 + i % 50), width=3)
    d.rectangle([40, 60, w - 40, h - 60], outline=(240, 225, 180), width=6)
    d.ellipse([w // 2 - 90, h // 2 - 90, w // 2 + 90, h // 2 + 90], outline=(240, 225, 180), width=5)
    img.save(path, 'JPEG', quality=80)

CONTAINER = '''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''

OPF = '''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bid">urn:uuid:cover-page-test</dc:identifier>
    <dc:title>雾港来信</dc:title>
    <dc:creator>佚名</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="page1" href="page1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="pic" href="images/pic1.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    <itemref idref="page1"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>'''

# 第一页：整页只有一张图（iBooks / Calibre 常见的 svg 包裹写法）
PAGE1 = '''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">
<head><title>封面</title>
<style>html,body{margin:0;padding:0;height:100%}svg{display:block;height:100%;width:100%}</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid meet">
  <image width="600" height="900" xlink:href="images/pic1.jpg"/>
</svg>
</body>
</html>'''

BODY = ('雾从海面漫上来的时候，港口的灯一盏一盏熄了。她在栈桥尽头站了很久，'
        '看着货轮慢慢靠岸，甲板上堆着湿漉漉的木箱，箱子上印着陌生的文字。')

CH = '''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{t}</title>
<style>body{{font-family:serif;line-height:1.8;margin:2em}}</style></head>
<body><h1>{t}</h1>{ps}</body></html>'''

def chapter(title, n):
    return CH.format(t=title, ps=''.join('<p>%s</p>' % (BODY * 2) for _ in range(n)))

def main():
    tmp = os.path.join('/tmp', 'cover-epub-src')
    os.system('rm -rf ' + tmp)
    os.makedirs(os.path.join(tmp, 'OEBPS', 'images'), exist_ok=True)
    os.makedirs(os.path.join(tmp, 'META-INF'), exist_ok=True)
    open(os.path.join(tmp, 'mimetype'), 'w').write('application/epub+zip')
    open(os.path.join(tmp, 'META-INF', 'container.xml'), 'w').write(CONTAINER)
    open(os.path.join(tmp, 'OEBPS', 'content.opf'), 'w').write(OPF)
    open(os.path.join(tmp, 'OEBPS', 'page1.xhtml'), 'w').write(PAGE1)
    open(os.path.join(tmp, 'OEBPS', 'ch1.xhtml'), 'w').write(chapter('第一章 雾港', 4))
    open(os.path.join(tmp, 'OEBPS', 'ch2.xhtml'), 'w').write(chapter('第二章 来信', 4))
    make_jpeg(os.path.join(tmp, 'OEBPS', 'images', 'pic1.jpg'))
    if os.path.exists(OUT):
        os.remove(OUT)
    z = zipfile.ZipFile(OUT, 'w')
    z.writestr('mimetype', 'application/epub+zip', zipfile.ZIP_STORED)
    for root, _, files in os.walk(tmp):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, tmp)
            if rel == 'mimetype':
                continue
            z.write(full, rel, zipfile.ZIP_DEFLATED)
    z.close()
    print('已生成', OUT, os.path.getsize(OUT), '字节')

if __name__ == '__main__':
    main()
