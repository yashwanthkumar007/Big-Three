"""
Email service for sharing inspection reports and sending verification emails.

Uses SMTP for all email delivery. Configuration is read from environment
variables (never hardcoded) - the same .env file that was already in use.

    EMAIL_HOST      - SMTP server hostname (e.g. smtp.gmail.com)
    EMAIL_PORT      - SMTP server port (default 587)
    EMAIL_USER      - SMTP username
    EMAIL_PASSWORD  - SMTP password / app password
    EMAIL_FROM      - From address (defaults to EMAIL_USER if not set)
    EMAIL_USE_TLS   - "true"/"1" to enable STARTTLS (default true)
    EMAIL_FROM_NAME - Display name for the From field
"""

import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path

from src.logger import logger


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


def _get_env_bool(name: str, default: bool = True) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _build_verification_text_body(display_name: str, verify_url: str, expires_hours: float) -> str:
    """Build plain text version of verification email."""
    expires_text = (
        f"{int(expires_hours)} hours" if expires_hours >= 1
        else f"{int(expires_hours * 60)} minutes"
    )
    from_name = os.getenv("EMAIL_FROM_NAME", "MedInspect")
    return f"""Hello {display_name},

Please verify your email address by clicking the button below.

Verify your email: {verify_url}

This verification link will expire after {expires_text}.

If you did not request this verification, you can ignore this email.

Regards,
{from_name}
"""


def _build_verification_html_body(display_name: str, verify_url: str, expires_hours: float) -> str:
    """Build HTML version of verification email."""
    expires_text = (
        f"{int(expires_hours)} hours" if expires_hours >= 1
        else f"{int(expires_hours * 60)} minutes"
    )
    from_name = os.getenv("EMAIL_FROM_NAME", "MedInspect")
    return f"""<html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1b1b1b;">
  <div style="max-width:560px;margin:0 auto;padding:24px;
              border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="color:#2A276E;margin-top:0;">Verify your email address</h2>
    <p>Hello <b>{display_name}</b>,</p>
    <p>Please verify your email address by clicking the button below.</p>
    <p style="margin:28px 0;">
      <a href="{verify_url}"
         style="background:#2A276E;color:#ffffff;padding:12px 28px;
                border-radius:8px;text-decoration:none;font-weight:600;
                display:inline-block;">
        Verify Email
      </a>
    </p>
    <p style="color:#535a62;font-size:13px;">
      This verification link will expire after <b>{expires_text}</b>.
    </p>
    <p style="color:#535a62;font-size:13px;">
      If you did not request this verification, you can ignore this email.
    </p>
    <p style="color:#535a62;font-size:13px;">
      Regards,<br/>{from_name}
    </p>
  </div>
</body></html>
"""


def _build_inspection_report_html_body(
    master_file_name: str,
    sample_file_name: str,
    session_id: str,
    from_name: str,
) -> str:
    """Build HTML version of the inspection report email."""
    return f"""<html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1b1b1b;">
  <div style="max-width:560px;margin:0 auto;padding:24px;
              border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="color:#2A276E;margin-top:0;">Inspection Report Shared</h2>
    <p>Hello,</p>
    <p>A GlobalVision Text Inspection Report has been shared with you.</p>
    <table cellpadding="8" cellspacing="0"
           style="border-collapse:collapse;margin:16px 0;font-size:14px;">
      <tr>
        <td style="color:#535a62;"><b>Master</b></td>
        <td>{master_file_name}</td>
      </tr>
      <tr>
        <td style="color:#535a62;"><b>Sample</b></td>
        <td>{sample_file_name}</td>
      </tr>
      <tr>
        <td style="color:#535a62;"><b>Inspection ID</b></td>
        <td>{session_id}</td>
      </tr>
    </table>
    <p>The complete inspection report is attached to this email as a PDF.</p>
    <p style="color:#535a62;font-size:13px;">
      Regards,<br/>{from_name}
    </p>
  </div>
</body></html>
"""


def _build_inspection_report_text_body(
    master_file_name: str,
    sample_file_name: str,
    session_id: str,
    from_name: str,
) -> str:
    """Build plain text version of the inspection report email."""
    return f"""Hello,

A GlobalVision Text Inspection Report has been shared with you.

Inspection Details:
Master: {master_file_name}
Sample: {sample_file_name}
Inspection ID: {session_id}

The complete inspection report is attached to this email as a PDF.

Regards,
{from_name}
"""


def _smtp_settings() -> dict:
    """
    Read SMTP configuration from the environment.

    The Backend/.env file is loaded by _load_local_dotenv() at import time,
    so values set there are available here without any extra dependency.

    Raises
    ------
    ValueError
        If any required SMTP variable is missing. The message lists the
        variable NAMES only - never the credential values.
    """
    host = (os.getenv("EMAIL_HOST") or "").strip()
    user = (os.getenv("EMAIL_USER") or "").strip()
    password = os.getenv("EMAIL_PASSWORD") or ""
    port_raw = (os.getenv("EMAIL_PORT") or "587").strip()

    missing = []
    if not host:
        missing.append("EMAIL_HOST")
    if not user:
        missing.append("EMAIL_USER")
    if not password:
        missing.append("EMAIL_PASSWORD")

    if missing:
        raise ValueError(
            "Email is not configured. Missing environment variable(s): "
            + ", ".join(missing)
            + ". Set these in the Backend/.env file before starting the server."
        )

    try:
        port = int(port_raw)
    except ValueError:
        port = 587

    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "from_addr": (os.getenv("EMAIL_FROM") or user).strip(),
        "use_tls": _get_env_bool("EMAIL_USE_TLS", True),
        "from_name": os.getenv("EMAIL_FROM_NAME", "MedInspect"),
    }


def _deliver_via_smtp(
    settings: dict,
    recipient_email: str,
    message: MIMEMultipart,
) -> None:
    """
    Open a single SMTP connection and send the prepared message.

    Port 465 uses implicit SSL (SMTP_SSL); every other port uses plain SMTP
    with optional STARTTLS upgrade (controlled by EMAIL_USE_TLS).
    """
    host = settings["host"]
    port = settings["port"]
    use_tls = settings["use_tls"]

    logger.info("[EMAIL] Connecting to SMTP server %s:%s...", host, port)

    try:
        if port == 465:
            logger.info("[EMAIL] Using implicit SSL connection (port 465)")
            with smtplib.SMTP_SSL(host, port, timeout=30) as server:
                server.login(settings["user"], settings["password"])
                server.sendmail(
                    settings["from_addr"],
                    [recipient_email],
                    message.as_string(),
                )
        else:
            with smtplib.SMTP(host, port, timeout=30) as server:
                if use_tls:
                    logger.info("[EMAIL] Using STARTTLS (port %s)", port)
                    server.starttls()
                server.login(settings["user"], settings["password"])
                server.sendmail(
                    settings["from_addr"],
                    [recipient_email],
                    message.as_string(),
                )
    except smtplib.SMTPAuthenticationError as exc:
        logger.error("[EMAIL] SMTP authentication failed: %s", exc)
        raise
    except (TimeoutError, OSError) as exc:
        logger.error("[EMAIL] SMTP connection failed: %s", exc)
        raise
    except smtplib.SMTPException as exc:
        logger.error("[EMAIL] SMTP error: %s", exc)
        raise

    logger.info("[EMAIL] Email sent successfully to %s", recipient_email)



def send_email_verification_email(
    recipient_email: str,
    display_name: str,
    verify_url: str,
    expires_hours: float = 24.0,
) -> None:
    """
    Send the account email-verification message over SMTP.

    Raises
    ------
    ValueError
        If required SMTP configuration is missing (see _smtp_settings).
    smtplib.SMTPException / OSError
        If the message could not be delivered.
    """
    settings = _smtp_settings()

    if not (recipient_email or "").strip():
        raise ValueError("Recipient email address is empty.")

    message = MIMEMultipart("alternative")
    message["From"] = formataddr((settings["from_name"], settings["from_addr"]))
    message["To"] = recipient_email
    message["Subject"] = "Verify your email address"

    text_body = _build_verification_text_body(
        display_name, verify_url, expires_hours
    )
    html_body = _build_verification_html_body(
        display_name, verify_url, expires_hours
    )

    # Plain text first, HTML second - mail clients pick the richest
    # alternative they can render.
    message.attach(MIMEText(text_body, "plain", "utf-8"))
    message.attach(MIMEText(html_body, "html", "utf-8"))

    logger.info("[EMAIL-VERIFY] Sending verification email to %s", recipient_email)
    _deliver_via_smtp(settings, recipient_email, message)


def send_inspection_report_email(
    recipient_email: str,
    session_id: str,
    master_file_name: str,
    sample_file_name: str,
    pdf_bytes: bytes,
) -> None:
    """
    Send the inspection report PDF as an email attachment over SMTP.

    Raises
    ------
    ValueError
        If required SMTP configuration is missing, or the PDF is empty.
    smtplib.SMTPException / OSError
        If the message could not be delivered.
    """
    settings = _smtp_settings()

    if not (recipient_email or "").strip():
        raise ValueError("Recipient email address is empty.")
    if not pdf_bytes:
        raise ValueError("Report PDF is empty.")

    from_name = settings["from_name"]

    message = MIMEMultipart("mixed")
    message["From"] = formataddr((from_name, settings["from_addr"]))
    message["To"] = recipient_email
    message["Subject"] = "GlobalVision Text Inspection Report"

    # multipart/alternative body inside the multipart/mixed wrapper so the
    # PDF attachment stays separate from the rendered text/HTML.
    body_part = MIMEMultipart("alternative")
    body_part.attach(
        MIMEText(
            _build_inspection_report_text_body(
                master_file_name, sample_file_name, session_id, from_name
            ),
            "plain",
            "utf-8",
        )
    )
    body_part.attach(
        MIMEText(
            _build_inspection_report_html_body(
                master_file_name, sample_file_name, session_id, from_name
            ),
            "html",
            "utf-8",
        )
    )
    message.attach(body_part)

    attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
    attachment.add_header(
        "Content-Disposition",
        "attachment",
        filename=f"inspection-report-{session_id}.pdf",
    )
    message.attach(attachment)

    logger.info("[SHARE REPORT] Sending report email to %s", recipient_email)
    _deliver_via_smtp(settings, recipient_email, message)

