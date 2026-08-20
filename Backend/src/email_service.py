"""
Email service for sharing inspection reports.

Uses Python's built-in smtplib + email modules — no extra dependencies.
SMTP credentials are read from environment variables (never hardcoded):

    EMAIL_HOST      — SMTP server hostname
    EMAIL_PORT      — SMTP server port (default 587)
    EMAIL_USER      — SMTP username
    EMAIL_PASSWORD  — SMTP password / app password
    EMAIL_FROM      — From address (defaults to EMAIL_USER if not set)
    EMAIL_USE_TLS   — "true"/"1" to enable STARTTLS (default true)
"""

import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

from src.logger import logger


def _get_env_bool(name: str, default: bool = True) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def send_inspection_report_email(
    recipient_email: str,
    session_id: str,
    master_file_name: str,
    sample_file_name: str,
    pdf_bytes: bytes,
) -> None:
    """
    Sends an email with the inspection report PDF attached.

    Raises:
        ValueError — if required SMTP configuration is missing.
        smtplib.SMTPException — if the email could not be sent.
    """
    host = os.getenv("EMAIL_HOST")
    port = int(os.getenv("EMAIL_PORT", "587"))
    user = os.getenv("EMAIL_USER")
    password = os.getenv("EMAIL_PASSWORD")
    from_addr = os.getenv("EMAIL_FROM", user)
    use_tls = _get_env_bool("EMAIL_USE_TLS", True)

    if not host or not user or not password:
        missing = []
        if not host:
            missing.append("EMAIL_HOST")
        if not user:
            missing.append("EMAIL_USER")
        if not password:
            missing.append("EMAIL_PASSWORD")
        raise ValueError(
            "Email is not configured. Missing environment variable(s): "
            + ", ".join(missing)
            + ". Set these in your environment before starting the server."
        )

    logger.info("[SHARE REPORT] Sending email")
    logger.info("[SHARE REPORT] Recipient: %s", recipient_email)

    # Build the email
    msg = MIMEMultipart()
    msg["From"] = formataddr(("GlobalVision", from_addr))
    msg["To"] = recipient_email
    msg["Subject"] = "GlobalVision Text Inspection Report"

    body = f"""Hello,

A GlobalVision Text Inspection Report has been shared with you.

Inspection Details:
Master: {master_file_name}
Sample: {sample_file_name}
Inspection ID: {session_id}

The complete inspection report is attached to this email as a PDF.

Regards,
GlobalVision
"""
    msg.attach(MIMEText(body, "plain", "utf-8"))

    # Attach the PDF
    attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
    attachment.add_header(
        "Content-Disposition",
        "attachment",
        filename=f"inspection-report-{session_id}.pdf",
    )
    msg.attach(attachment)

    # Send via SMTP
    with smtplib.SMTP(host, port, timeout=30) as server:
        if use_tls:
            server.starttls()
        server.login(user, password)
        server.sendmail(from_addr, [recipient_email], msg.as_string())

    logger.info("[SHARE REPORT] Email sent successfully")