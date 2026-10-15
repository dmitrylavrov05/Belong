"""Web Push: сповіщення на телефон, навіть коли застосунок закрито (RFC 8291 + VAPID).

Ключі VAPID створюються самі при першому запуску й лежать поруч із базою (vapid.pem).
Потрібен пакет cryptography (на Ubuntu: apt install python3-cryptography); без нього push вимкнено.
"""
import base64
import json
import os
import struct
import time
import urllib.parse
import urllib.request

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    HAVE_CRYPTO = True
except ImportError:  # pragma: no cover
    HAVE_CRYPTO = False


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def ub64u(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def _hkdf(salt, info, length, ikm):
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


class WebPush:
    def __init__(self, data_dir, subject='mailto:support@carcar.app'):
        self.ok = HAVE_CRYPTO
        self.subject = subject
        if not self.ok:
            return
        path = os.path.join(data_dir, 'vapid.pem')
        if os.path.exists(path):
            with open(path, 'rb') as f:
                self.key = serialization.load_pem_private_key(f.read(), password=None)
        else:
            self.key = ec.generate_private_key(ec.SECP256R1())
            with open(path, 'wb') as f:
                f.write(self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            os.chmod(path, 0o600)
        self.public = b64u(self.key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))

    def _vapid(self, endpoint):
        u = urllib.parse.urlparse(endpoint)
        header = b64u(json.dumps({'typ': 'JWT', 'alg': 'ES256'}).encode())
        claims = b64u(json.dumps({'aud': f'{u.scheme}://{u.netloc}', 'exp': int(time.time()) + 12 * 3600, 'sub': self.subject}).encode())
        signing = f'{header}.{claims}'.encode()
        r, s = decode_dss_signature(self.key.sign(signing, ec.ECDSA(hashes.SHA256())))
        sig = b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))
        return f'vapid t={header}.{claims}.{sig}, k={self.public}'

    @staticmethod
    def encrypt(sub, payload):
        ua_public = ub64u(sub['keys']['p256dh'])
        auth = ub64u(sub['keys']['auth'])
        as_key = ec.generate_private_key(ec.SECP256R1())
        as_public = as_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        secret = as_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public))
        ikm = _hkdf(auth, b'WebPush: info\x00' + ua_public + as_public, 32, secret)
        salt = os.urandom(16)
        cek = _hkdf(salt, b'Content-Encoding: aes128gcm\x00', 16, ikm)
        nonce = _hkdf(salt, b'Content-Encoding: nonce\x00', 12, ikm)
        body = AESGCM(cek).encrypt(nonce, payload + b'\x02', None)
        return salt + struct.pack('!I', 4096) + bytes([len(as_public)]) + as_public + body

    def send(self, sub, message):
        """True — доставлено; False — підписка більше не діє (її треба видалити); None — тимчасова помилка."""
        if not self.ok:
            return None
        data = self.encrypt(sub, json.dumps(message, ensure_ascii=False).encode())
        req = urllib.request.Request(sub['endpoint'], data=data, method='POST', headers={
            'TTL': '86400', 'Urgency': 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
            'Authorization': self._vapid(sub['endpoint'])})
        try:
            with urllib.request.urlopen(req, timeout=15):
                return True
        except urllib.error.HTTPError as e:
            return False if e.code in (404, 410) else None
        except Exception:
            return None
