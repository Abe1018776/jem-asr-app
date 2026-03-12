"""Extract Chrome cookies for Google Drive on Windows using DPAPI."""

import os
import json
import base64
import sqlite3
import shutil
import tempfile

def get_encryption_key():
    """Get Chrome's AES encryption key from Local State."""
    local_state_path = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Local State"
    )
    with open(local_state_path, "r", encoding="utf-8") as f:
        local_state = json.load(f)

    encrypted_key = base64.b64decode(local_state["os_crypt"]["encrypted_key"])
    # Remove 'DPAPI' prefix
    encrypted_key = encrypted_key[5:]

    # Decrypt using Windows DPAPI
    import win32crypt
    return win32crypt.CryptUnprotectData(encrypted_key, None, None, None, 0)[1]


def decrypt_cookie_value(encrypted_value, key):
    """Decrypt a Chrome cookie value."""
    if encrypted_value[:3] == b"v10" or encrypted_value[:3] == b"v20":
        # AES-256-GCM
        nonce = encrypted_value[3:15]
        ciphertext = encrypted_value[15:-16]
        tag = encrypted_value[-16:]

        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        aesgcm = AESGCM(key)
        try:
            return aesgcm.decrypt(nonce, encrypted_value[15:], None).decode("utf-8")
        except Exception:
            # Try with the full ciphertext+tag
            try:
                return aesgcm.decrypt(nonce, ciphertext + tag, None).decode("utf-8")
            except Exception:
                return ""
    else:
        # Old DPAPI encryption
        try:
            import win32crypt
            return win32crypt.CryptUnprotectData(encrypted_value, None, None, None, 0)[1].decode("utf-8")
        except Exception:
            return ""


def get_google_cookies():
    """Extract Google cookies from Chrome."""
    cookie_db = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default", "Network", "Cookies"
    )

    key = get_encryption_key()

    # Copy DB to avoid lock issues
    tmp = tempfile.mktemp(suffix=".db")
    shutil.copy2(cookie_db, tmp)

    conn = sqlite3.connect(tmp)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT host_key, name, encrypted_value FROM cookies "
        "WHERE host_key LIKE '%.google.com' OR host_key LIKE '%.drive.google.com'"
    )

    cookies = {}
    for host, name, enc_value in cursor.fetchall():
        value = decrypt_cookie_value(enc_value, key)
        if value:
            cookies[name] = value

    conn.close()
    os.remove(tmp)
    return cookies


if __name__ == "__main__":
    cookies = get_google_cookies()
    print(f"Extracted {len(cookies)} Google cookies")
    for name in sorted(cookies.keys()):
        print(f"  {name}: {cookies[name][:20]}...")
