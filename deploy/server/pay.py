"""Оплата через LiqPay (ПриватБанк): платіж, підтвердження від банку (callback) і повернення.

Ключі мерчанта — у конфігурації (liqpay.public_key, liqpay.private_key). Без них застосунок працює
в демо-режимі оплати, як раніше. sandbox: true — тестові платежі без списання.
Документація: https://www.liqpay.ua/documentation/api/aquiring/checkout/doc
"""
import base64
import hashlib
import json
import urllib.parse
import urllib.request

CHECKOUT = 'https://www.liqpay.ua/api/3/checkout'
API = 'https://www.liqpay.ua/api/request'


class LiqPay:
    def __init__(self, cfg):
        cfg = cfg or {}
        self.public = cfg.get('public_key') or ''
        self.private = cfg.get('private_key') or ''
        self.sandbox = bool(cfg.get('sandbox', True))

    @property
    def on(self):
        return bool(self.public and self.private)

    def sign(self, data):
        return base64.b64encode(hashlib.sha1((self.private + data + self.private).encode()).digest()).decode()

    def pack(self, params):
        data = base64.b64encode(json.dumps({'public_key': self.public, 'version': 3, **params}, ensure_ascii=False).encode()).decode()
        return data, self.sign(data)

    def checkout(self, order_id, amount, description, result_url, server_url):
        params = {'action': 'pay', 'amount': round(float(amount), 2), 'currency': 'UAH', 'description': description,
                  'order_id': order_id, 'result_url': result_url, 'server_url': server_url, 'language': 'uk'}
        if self.sandbox:
            params['sandbox'] = 1
        data, signature = self.pack(params)
        return {'url': CHECKOUT, 'data': data, 'signature': signature}

    def parse_callback(self, data, signature):
        """Відповідь банку: перевіряємо підпис — інакше хтось міг би «оплатити» запис підробленим запитом."""
        if not self.on or not data or not signature or self.sign(data) != signature:
            return None
        try:
            return json.loads(base64.b64decode(data))
        except ValueError:
            return None

    def refund(self, order_id, amount):
        data, signature = self.pack({'action': 'refund', 'order_id': order_id, 'amount': round(float(amount), 2)})
        body = urllib.parse.urlencode({'data': data, 'signature': signature}).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(API, data=body), timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:  # повторимо пізніше
            return {'status': 'error', 'err_description': str(e)}
