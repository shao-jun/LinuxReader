#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""极简 CDP 驱动：连接 Electron / Chrome 的远程调试端口，执行 JS、截图、收集报错。"""
import base64
import json
import os
import threading
import time
import urllib.request

import websocket

PORT = int(os.environ.get('CDP_PORT', '9223'))


def targets():
    with urllib.request.urlopen('http://127.0.0.1:%d/json' % PORT, timeout=5) as r:
        return json.load(r)


class Session:
    def __init__(self, match='linuxreader://', port=None):
        self.port = port or PORT
        tg = [t for t in targets() if match in t.get('url', '')] or targets()
        self.target = tg[0]
        ws_url = self.target['webSocketDebuggerUrl']
        self.ws = websocket.create_connection(ws_url, timeout=40, suppress_origin=True,
                                             http_proxy_host=None, http_proxy_port=None)
        self.msg_id = 0
        self.events = []
        self.errors = []
        self._lock = threading.Lock()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        self.send('Runtime.enable')
        self.send('Log.enable')
        self.send('Page.enable')

    def _read_loop(self):
        while True:
            try:
                raw = self.ws.recv()
            except Exception:
                return
            if not raw:
                return
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if 'id' in msg:
                with self._lock:
                    self.events.append(msg)
            elif msg.get('method') in ('Runtime.exceptionThrown', 'Log.entryAdded',
                                       'Runtime.consoleAPICalled'):
                params = msg.get('params', {})
                if msg['method'] == 'Runtime.exceptionThrown':
                    d = params.get('exceptionDetails', {})
                    self.errors.append('EXCEPTION: ' + (d.get('text') or '') + ' ' +
                                       str((d.get('exception') or {}).get('description', ''))[:400])
                elif msg['method'] == 'Log.entryAdded':
                    e = params.get('entry', {})
                    if e.get('level') in ('error', 'warning'):
                        self.errors.append('LOG[%s]: %s %s' % (e.get('level'), e.get('text'), e.get('url', '')[:80]))
                elif msg['method'] == 'Runtime.consoleAPICalled':
                    if params.get('type') in ('error', 'warning'):
                        args = ' '.join(str(a.get('value', a.get('description', ''))) for a in params.get('args', []))
                        self.errors.append('CONSOLE[%s]: %s' % (params.get('type'), args[:400]))

    def send(self, method, **params):
        self.msg_id += 1
        mid = self.msg_id
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        deadline = time.time() + 40
        while time.time() < deadline:
            with self._lock:
                for i, m in enumerate(self.events):
                    if m.get('id') == mid:
                        self.events.pop(i)
                        if 'error' in m:
                            raise RuntimeError(method + ': ' + json.dumps(m['error']))
                        return m.get('result', {})
            time.sleep(0.01)
        raise TimeoutError(method + ' timeout')

    def eval(self, expr, await_promise=True):
        r = self.send('Runtime.evaluate', expression=expr, returnByValue=True,
                      awaitPromise=await_promise, userGesture=True)
        if r.get('exceptionDetails'):
            d = r['exceptionDetails']
            raise RuntimeError('JS: ' + (d.get('text') or '') + ' ' + str((d.get('exception') or {}).get('description', ''))[:500])
        return r.get('result', {}).get('value')

    def shot(self, path, full=False):
        params = {'format': 'png'}
        if full:
            params['captureBeyondViewport'] = True
        r = self.send('Page.captureScreenshot', **params)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(r['data']))
        return path

    def set_size(self, w, h, scale=1.0):
        self.send('Emulation.setDeviceMetricsOverride', width=w, height=h,
                  deviceScaleFactor=scale, mobile=False)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
