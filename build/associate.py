#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 EPUB 的系统级默认程序设为 linuxreader.desktop。

写 /etc/xdg/mimeapps.list（XDG_CONFIG_DIRS 级默认），用户自己的
~/.config/mimeapps.list 仍然可以覆盖它。重复执行是幂等的：
已有的 application/epub+zip 行会被改成 linuxreader.desktop，不会重复追加。
"""
import os
import sys

PATH = '/etc/xdg/mimeapps.list'
HEADER = '[Default Applications]'
TARGETS = {'application/epub+zip': 'linuxreader.desktop'}


def apply(text, targets=TARGETS):
    lines = text.splitlines()
    hdr = next((i for i, l in enumerate(lines) if l.strip() == HEADER), None)

    if hdr is None:
        while lines and not lines[-1].strip():
            lines.pop()
        head = lines + ([''] if lines else [])
        return '\n'.join(head + [HEADER] + ['%s=%s' % kv for kv in targets.items()]) + '\n'

    end = len(lines)
    for i in range(hdr + 1, len(lines)):
        if lines[i].strip().startswith('['):
            end = i
            break

    body, seen = [], set()
    for ln in lines[hdr + 1:end]:
        s = ln.strip()
        key = s.split('=')[0].strip() if '=' in s else None
        if key in targets:
            if key not in seen:
                body.append('%s=%s' % (key, targets[key]))
                seen.add(key)
        elif s:
            body.append(ln)
    body += ['%s=%s' % (k, v) for k, v in targets.items() if k not in seen]

    return '\n'.join(lines[:hdr + 1] + body + lines[end:]) + '\n'


def main():
    text = ''
    if os.path.exists(PATH):
        with open(PATH, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
    out = apply(text)
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(out)
    print('linuxreader: 已把 EPUB 默认关联写入 %s' % PATH)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # 关联失败不该让安装失败
        print('linuxreader: 关联 EPUB 失败（可忽略）：%s' % e, file=sys.stderr)
