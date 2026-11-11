#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成一本测试用 EPUB（含封面、目录、多章节中文正文），用于验证阅读器。"""
import os
import sys
import zipfile

CH = [
    ("第一章 灯下的城市", """夜里十一点，城市的灯还亮着。

林徽从地铁站出来，风从街角卷过来，带着一点雨的味道。她把围巾往上提了提，抬头看了看那栋楼——十七层，只有一扇窗还亮着，像一枚被遗忘在书页里的书签。

那扇窗后面是她的办公室。桌上摊着一份没有改完的稿子，旁边是冷却了的茶。她想，也许今天应该早点回去，洗个热水澡，读几页书。

但书是越来越难读了。手机在口袋里震动，消息一条接一条，像潮水，一浪一浪，退不下去。她想起小时候，父亲的书房里有一只旧台灯，灯罩是黄铜的，光落在书页上，暖得像下午。那时候她可以坐在那里一整个下午，读完一本薄薄的小说，然后抬头发现天黑了。

现在她很少有这样的下午。

她沿着街道往住处走，路过一家还开着门的小书店。店主是个上了年纪的男人，正在整理一摞旧书。他抬头看见她，笑了笑，说：这么晚才回家啊。

她点点头，说：加班。

店主说：进来看看？今天进了一批旧书，有几本你可能会喜欢。

她犹豫了一下，还是走了进去。书店里有股淡淡的旧纸味道，混杂着木头的香气。她随手抽出一本，封面已经磨损，扉页上有一行钢笔字：给未来的自己。

字迹很陌生，笔画却有一种奇特的温柔。她站在那里，忽然觉得世界安静了下来，像一本书翻到了某一页，风停在那里，不肯再吹。"""),
    ("第二章 书页之间", """她买下了那本书，五块钱。店主没有零钱，摆摆手说不用找了。

回到住处，她把书放在床头，洗了澡，泡了一杯茶，然后在台灯下翻开它。

那是一本散文集，作者不有名，印刷也只有两千册。第一篇写的是海，写一个人在海边住了一个冬天，每天清晨走到礁石上看日出，然后回到屋里煮一壶咖啡，写两页稿子，等着潮水涨起来。

她读得很慢。不是因为难，而是因为舍不得。每一段文字都像一个人在对她说话，声音不高，却很清晰。

读到第三十页，她发现书页之间夹着一张车票，是很多年前的，目的地是一座她没去过的南方小城。车票的边缘已经卷起，上面的日期被雨水洇得有些模糊。

她忽然好奇，这本书之前的主人是谁，为什么要把它卖掉，又为什么留下了这张车票。

她把车票夹回原处，合上书，看着封面上那行字：给未来的自己。

也许那个人并没有把书卖掉，也许他只是在某个搬家的下午，把它连同许多别的东西一起，放进了一个纸箱，然后纸箱被搬来搬去，最后到了二手书店的货架上。

书是这样旅行的。它们穿过别人的手，别人的房间，别人的夜晚，然后安静地停在你面前，等你翻开。

窗外的雨终于下了起来，落在玻璃上，一点一点，像有人在外面轻轻敲门。

她读到天亮。"""),
    ("第三章 南方的潮声", """一个月后，她请了年假，坐上了去往那座南方小城的火车。

票是新的，目的地是旧的。她坐在靠窗的位置，看着窗外的风景从灰色变成绿色，从楼房变成稻田，从冬天变成一种模糊的、潮湿的温暖。

小城很小，从车站走到海边只要二十分钟。她按着车票上模糊的地址找过去，是一条临海的老街，房子都有些旧了，阳台上晾着衣服，海风把衣服吹得鼓起来，像一排小小的帆。

她在一家面馆坐下，点了一碗海鲜面。老板娘问她从哪里来，她说从北方。老板娘说，这个季节北方很冷吧。她说是的，很冷。

吃完面，她沿着海边走。潮水一遍遍涌上来，又退回去，把沙滩上的脚印抹平。

她想起书里那句话：海是不需要被记住的，它只需要一遍一遍地来。

她站了很久，直到太阳落下去，海面变成一片深蓝。

回程的火车上，她给那位书店店主发了一条消息，说谢谢那本书。店主回了一张照片，是书店的门口，雨水打湿了台阶，玻璃上贴着一张纸条：今日照常营业。

她笑了笑，把手机收起来，从包里拿出那本书，继续读。

书还剩三分之一。窗外黑得看不见风景，车窗上映出她自己的脸，和翻动的书页。"""),
    ("第四章 给未来的自己", """回到城市以后，她做了一件很久没做的事：把手机调成静音，放在另一个房间里。

每天下班回家，她会先泡一杯茶，然后坐到书桌前读书。一开始很难，读两页就想去看手机，手指会自己去找那个熟悉的图标。她忍着，忍着，慢慢地，那个冲动变弱了。

一个月里她读了四本书。不算多，但每一本都读完了，每一本都留下了一点什么。

她开始在书页边上写字。有时候是一句感叹，有时候是一个疑问，有时候只是一条横线，划在某个句子上，表示：这里我停了一下。

她想起小时候在图书馆借书，看到书里别人留下的铅笔痕迹，会觉得被打扰。现在她明白了，那些痕迹不是打扰，是同行。

有一天她翻开那本散文集，看到扉页上那行字，忽然想，也许她也应该写点什么。

她拿起笔，在那行字下面写：谢谢你把它留在这里。

然后她合上书，把它放回书架，紧挨着别的书。

书架上的书越来越多了。有些读过，有些没有。它们安静地站着，等待某个夜晚，某个人，某盏灯。"""),
    ("第五章 灯还亮着", """那家小书店后来关门了。

她是在一个周末的下午路过的，看到卷帘门拉着，门上贴了一张打印的纸：店主因身体原因，暂停营业，感谢多年照顾。

她站在门口，站了很久。

后来她打听到店主的住址，去看了他一次。老人躺在床上，精神还不错，看见她来，笑着说：那本书读完了吗。

她说，读完了，还去了那座南方的小城。

老人愣了一下，然后笑得更开心了，说：那张车票是我放的。

她说，为什么。

老人说，很多年前我也收到过一本夹着车票的书，那时候我没去。后来一直后悔。所以我想，也许有人会去。

她把书从包里拿出来，翻到扉页，指给他看她写的那行字。

老人看了很久，说：这就对了。

从老人家出来，天快黑了。她走在街上，路灯一盏一盏亮起来，像有人在夜里，替她翻开一页又一页。

那天晚上她回家，在台灯下读到很晚。窗外的城市还在亮着。她想着，明天要早一点睡，但大概还是不会。

书就是这样，一页一页，把一个人从夜晚带到另一个夜晚，直到天亮。""")
]

CSS = """body { font-family: "Source Han Serif SC", serif; line-height: 1.8; margin: 0 6%; }
h1 { font-size: 1.5em; margin: 2em 0 1.2em; font-weight: 600; }
p { margin: 0 0 .6em; text-indent: 2em; }
blockquote { margin: 1.5em 2em; color: #666; font-style: italic; }
figure { margin: 1.5em 0; text-align: center; }
figcaption { font-size: .8em; color: #888; margin-top: .5em; }
"""

COVER_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#2b3a55"/><stop offset="0.55" stop-color="#7a4b3a"/><stop offset="1" stop-color="#c98a4b"/>
</linearGradient></defs>
<rect width="600" height="900" fill="url(#g)"/>
<circle cx="460" cy="180" r="70" fill="#f6d9a0" opacity="0.85"/>
<text x="60" y="560" font-family="Source Han Serif SC, serif" font-size="64" fill="#fdf6e3" font-weight="bold">灯下的城市</text>
<text x="62" y="618" font-family="Source Han Serif SC, serif" font-size="26" fill="#f0e2c8" opacity="0.85">一部关于书与夜晚的短篇集</text>
<text x="62" y="820" font-family="Source Han Serif SC, serif" font-size="22" fill="#e8d7bb" opacity="0.7">Lumen 测试书</text>
<rect x="0" y="880" width="600" height="20" fill="#1b2430" opacity="0.45"/>
</svg>"""


def chapter_xhtml(title, body):
    paras = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        if block.startswith(">"):
            paras.append("<blockquote>%s</blockquote>" % block[1:].strip())
        elif block == "[[图]]":
            paras.append('<figure><img src="images/scene.svg" alt="插画" style="width:80%"/>'
                         '<figcaption>书中的插图（测试）</figcaption></figure>')
        else:
            paras.append("<p>%s</p>" % block)
    return """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>%s</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h1>%s</h1>
%s
</body></html>""" % (title, title, "\n".join(paras))


def main(out):
    long_mode = '--long' in sys.argv
    items = []
    for i, (t, body) in enumerate(CH, 1):
        if long_mode:
            body = "\n\n".join([body] * 6)
        items.append(("ch%02d.xhtml" % i, chapter_xhtml(t, body)))

    manifest = []
    spine = []
    for i, (name, _) in enumerate(items, 1):
        manifest.append('<item id="ch%02d" href="%s" media-type="application/xhtml+xml"/>' % (i, name))
        spine.append('<itemref idref="ch%02d"/>' % i)

    nav_lis = "\n".join('<li><a href="%s">%s</a></li>' % (name, ch[0]) for (name, _), ch in zip(items, CH))
    nav = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>%s</ol></nav></body></html>""" % nav_lis

    ncx_points = []
    for i, ((name, _), ch) in enumerate(zip(items, CH), 1):
        ncx_points.append('<navPoint id="np%d" playOrder="%d"><navLabel><text>%s</text></navLabel>'
                          '<content src="%s"/></navPoint>' % (i, i, ch[0], name))
    ncx = """<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:lumen-test-0001"/></head>
<docTitle><text>灯下的城市</text></docTitle>
<navMap>%s</navMap></ncx>""" % "".join(ncx_points)

    opf = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">urn:uuid:lumen-test-0001</dc:identifier>
<dc:title>灯下的城市</dc:title>
<dc:creator>沈之遥</dc:creator>
<dc:language>zh-CN</dc:language>
<dc:publisher>Lumen 测试出版社</dc:publisher>
<dc:description>一本关于书、夜晚与城市灯光的短篇集，用于验证阅读器的排版、高亮与歌词模式。</dc:description>
<meta property="dcterms:modified">2026-11-11T09:00:00Z</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="cover-image" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/>
<item id="scene" href="images/scene.svg" media-type="image/svg+xml"/>
<item id="coverpage" href="cover.xhtml" media-type="application/xhtml+xml"/>
%s
</manifest>
<spine toc="ncx">
<itemref idref="coverpage" linear="no"/>
%s
</spine>
</package>""" % ("\n".join(manifest), "\n".join(spine))

    cover_page = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>封面</title>
<style>body{margin:0;padding:0}img{display:block;width:100%;height:auto}</style></head>
<body><img src="images/cover.svg" alt="灯下的城市"/></body></html>"""

    scene = """<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360">
<rect width="600" height="360" fill="#1f2a38"/>
<circle cx="480" cy="80" r="34" fill="#f4e2b8"/>
<g fill="#28384d"><rect x="40" y="180" width="60" height="180"/><rect x="110" y="140" width="52" height="220"/>
<rect x="172" y="200" width="70" height="160"/><rect x="252" y="120" width="46" height="240"/>
<rect x="308" y="190" width="64" height="170"/><rect x="382" y="150" width="54" height="210"/></g>
<g fill="#f6d98a"><rect x="126" y="160" width="10" height="12"/><rect x="264" y="140" width="10" height="12"/>
<rect x="400" y="170" width="10" height="12"/><rect x="196" y="220" width="10" height="12"/></g>
<text x="40" y="340" font-family="Source Han Serif SC,serif" font-size="16" fill="#9fb3c8">夜里十一点，城市还亮着</text>
</svg>"""

    container = """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container)
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/nav.xhtml", nav)
        z.writestr("OEBPS/toc.ncx", ncx)
        z.writestr("OEBPS/style.css", CSS)
        z.writestr("OEBPS/cover.xhtml", cover_page)
        z.writestr("OEBPS/images/cover.svg", COVER_SVG)
        z.writestr("OEBPS/images/scene.svg", scene)
        for name, html in items:
            z.writestr("OEBPS/" + name, html)
    print("已生成", out, os.path.getsize(out), "字节")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "示例书籍.epub")
