"""
Logging configuration. Every pipeline run writes a timestamped log file
to artifacts/logs/ — this is the starting point for the audit trail
required for GxP compliance later.
"""

import logging
import os
from datetime import datetime

LOG_DIR = os.path.join(os.getcwd(), "artifacts", "logs")
os.makedirs(LOG_DIR, exist_ok=True)
 
LOG_FILE = f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.log"
LOG_FILE_PATH = os.path.join(LOG_DIR, LOG_FILE)
 
logging.basicConfig(
    filename=LOG_FILE_PATH,
    format="[%(asctime)s] %(lineno)d %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)

logger = logging.getLogger("GlobalVisionReplace")