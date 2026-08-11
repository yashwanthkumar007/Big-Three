"""
Shared constants and configuration values used across the pipeline.
"""

 
# The minimum similarity score required for two blocks to be considered a match.
MATCH_SCORE_THRESHOLD = 0.3   # below this, a block is considered "no match found" (Missing in master/Extra in sample)


POSITION_MAX_DISTANCE = 600   # used to normalize position similarity in combined scoring

# Combined scoring weights (text similarity vs position proximity) how much importance is given to text versus location
# Combined Score=0.7 × Text Similarity + 0.3 × Position Similarity
TEXT_WEIGHT = 0.7
POSITION_WEIGHT = 0.3

# Report any position change in matched text blocks.
# 0 = every movement is reported.
POSITION_SHIFT_THRESHOLD = 0.5
 
# Default rendering DPI for PDF-to-image conversion (Used when converting PDFs into images.) might not be needed now
DEFAULT_DPI = 150