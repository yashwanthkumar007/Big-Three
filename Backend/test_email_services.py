"""
Test email API services for backend integration.
"""
import sys
sys.path.insert(0, r"C:\Users\m685913\Documents\MedInspect AI Docs\Text Inspection full stack\Backend")

import requests
import base6

print("=== Testing Email API Services for Backend Integration ===\n")

services = [
    ("SendGrid", "https://api.sendgrid.com/v3/mail/send", "Bearer", "SG.xxxxxxxxxxx"),
    ("Brevo (Sendinblue)", "https://api.brevo.com/v3/smtp/email", "Bearer", "xkeysib-xxxxxxxxxxx"),
    ("Postmark", "https://api.postmarkapp.com/email", "Bearer", "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"),
    ("Mailjet", "https://api.mailjet.com/v3/send", "Basic", "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"),
    ("Resend", "https://api.resend.com/emails", "Bearer", "re_xxxxxxxxxxxxxxxxxxxxxxxx"),
    ("Amazon SES", "https://email.us-east-1.amazonaws.com", "AWS", "AKIAIOSFODNN7EXAMPLE"),
]

for name, url, auth_type, key_format in services:
    try:
        host = url.split("/")[2]
        headers = {"Content-Type": "application/json"}

        if auth_type == "Bearer":
            headers["Authorization"] = f"Bearer {key_format}"
        elif auth_type == "Basic":
            headers["Authorization"] = "Basic " + base64.b64encode(f"api:{key_format}".encode()).decode()
        elif auth_type == "AWS":
            headers["Authorization"] = f"AWS4-HMAC-SHA256 Credential={key_format}"
        else:
            headers["Authorization"] = f"{auth_type} {key_format}"

        r = requests.post(url, headers=headers, json={"test": True}, timeout=5, verify=False)
        print(f"{name} ({host})")
        print(f"  Status: {r.status_code}")
        print(f"  Response: {r.text[:100]}")
        print()

    except requests.exceptions.SSLError:
        print(f"{name} ({url.split('/')[2]})")
        print(f"  SSL_ERROR (same corporate proxy issue as Mailgun)")
        print()
    except requests.exceptions.ConnectionError:
        print(f"{name} ({url.split('/')[2]})")
        print(f"  CONNECTION_REFUSED")
        print()
    except Exception as e:
        print(f"{name} ({url.split('/')[2]})")
        print(f"  {type(e).__name__}: {str(e)[:80]}")
        print()