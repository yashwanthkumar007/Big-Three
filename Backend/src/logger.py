"""
Logging configuration. Every pipeline run writes a timestamped log file
to artifacts/logs/ - this is the starting point for the audit trail
required for GxP compliance later.
"""

import logging
import os
import sys
from datetime import datetime

LOG_DIR = os.path.join(os.getcwd(), "artifacts", "logs")
os.makedirs(LOG_DIR, exist_ok=True)

LOG_FILE = f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.log"
LOG_FILE_PATH = os.path.join(LOG_DIR, LOG_FILE)

# Create logger
logger = logging.getLogger("GlobalVisionReplace")
logger.setLevel(logging.INFO)

# Create formatter
formatter = logging.Formatter(
    "[%(asctime)s] %(lineno)d %(name)s - %(levelname)s - %(message)s"
)

# File handler - writes to log file
file_handler = logging.FileHandler(LOG_FILE_PATH)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

# Console handler - writes to console for visibility during development
console_handler = logging.StreamHandler(sys.stderr)
console_handler.setFormatter(formatter)
console_handler.setLevel(logging.INFO)
logger.addHandler(console_handler)
