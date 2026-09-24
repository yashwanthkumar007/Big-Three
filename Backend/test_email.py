"""
Simple SMTP connectivity test
"""
import smtplib
import os
import sys
from pathlib import Path

# Load .env file
def _load_local_dotenv() -> None:
    """Load .env file from Backend directory if it exists."""
    candidates = [
        Path(__file__).resolve().with_name(".env"),
        Path(__file__).resolve().parents[1] / ".env",
        Path.cwd() / ".env",
    ]
    seen = set()
    for candidate in candidates:
        if not candidate.exists() or candidate in seen:
            continue
        seen.add(candidate)
        try:
            with candidate.open("r", encoding="utf-8") as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = [part.strip() for part in line.split("=", 1)]
                    os.environ.setdefault(key, value)
        except OSError:
            continue

_load_local_dotenv()

print("Testing SMTP connection to Gmail...")
print()

host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
port = int(os.getenv("EMAIL_PORT", "587"))
user = os.getenv("EMAIL_USER")
password = os.getenv("EMAIL_PASSWORD")

print(f"Connecting to: {host}:{port}")
print(f"User: {user}")
print()

try:
    print("Attempting connection (timeout: 15 seconds)...")
    server = smtplib.SMTP(host, port, timeout=15)
    print("Connected to SMTP server!")
    
    server.ehlo()
    print("EHLO successful")
    
    if port == 587:
        print("Starting TLS...")
        server.starttls()
        print("TLS started")
        server.ehlo()
        print("EHLO after TLS successful")
    
    print()
    print("Attempting login...")
    server.login(user, password)
    print("Login successful!")
    
    server.quit()
    print()
    print("=" * 50)
    print("SMTP connection test PASSED!")
    print("=" * 50)
    
except smtplib.SMTPAuthenticationError as e:
    print()
    print("=" * 50)
    print("AUTHENTICATION FAILED")
    print("=" * 50)
    print(f"Error: {e}")
    print()
    print("Possible causes:")
    print("  - Wrong password (use App Password for Gmail)")
    print("  - 2-Factor authentication not enabled")
    print("  - Account locked")
    
except smtplib.SMTPConnectError as e:
    print()
    print("=" * 50)
    print("CONNECTION FAILED")
    print("=" * 50)
    print(f"Error: {e}")
    print()
    print("Possible causes:")
    print("  - Network/firewall blocking port 587")
    print("  - No internet connection")
    print("  - DNS resolution issues")
    
except Exception as e:
    print()
    print("=" * 50)
    print("ERROR")
    print("=" * 50)
    print(f"Error type: {type(e).__name__}")
    print(f"Error: {e}")
