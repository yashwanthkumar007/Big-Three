"""
Custom exception handling for the pipeline.
Wraps errors with clear context so failures are easy to diagnose —
this also becomes part of the audit trail for GxP purposes later.
"""
 
import sys
 
class PipelineException(Exception):
    """Base exception for all pipeline errors. Captures file/line context."""
 
    def __init__(self, message, error_detail: sys = None):
        super().__init__(message)
        self.message = message
        if error_detail is not None:
            _, _, exc_tb = error_detail.exc_info()
            self.file_name = exc_tb.tb_frame.f_code.co_filename if exc_tb else "unknown"
            self.line_number = exc_tb.tb_lineno if exc_tb else "unknown"
        else:
            self.file_name = "unknown"
            self.line_number = "unknown"
 
    def __str__(self):
        return (
            f"Error in [{self.file_name}] at line [{self.line_number}]: {self.message}"
        )
 
 
class PDFLoadError(PipelineException):
    """Raised when a PDF file cannot be opened or read."""
    pass
 
 
class ExtractionError(PipelineException):
    """Raised when text/block extraction fails."""
    pass
 
 
class ComparisonError(PipelineException):
    """Raised when the comparison/matching step fails."""
    pass