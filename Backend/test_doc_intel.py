"""
Simple PDF comparison using Azure Document Intelligence.
 
Sends two PDFs to Azure Document Intelligence (prebuilt-read model), extracts
the text from each, and prints a line-by-line diff plus a similarity score.
 
Setup:
    pip install azure-ai-documentintelligence azure-core
 
Usage:
    python compare_pdfs.py master.pdf sample.pdf
"""
 
import difflib
import sys
 
import requests
import time
 
# ---------------------------------------------------------------------
# 1. Fill in your Azure Document Intelligence endpoint and key here,
#    or set them as environment variables and read them with os.getenv().
# ---------------------------------------------------------------------
ANALYZE_URL = "https://emtech-apim-all-all-poc.azure-api.net/docintel/documentModels/prebuilt-layout:analyze?api-version=2024-11-30"
 
 
AZURE_KEY = "148708251a46488bb65dd7f9131dad8d"
 
 
def extract_text(pdf_path: str) -> str:

    headers = {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/pdf",
    }

    with open(pdf_path, "rb") as f:
        response = requests.post(
            ANALYZE_URL,
            headers=headers,
            data=f,
        )

    response.raise_for_status()

    operation_url = response.headers["Operation-Location"]

    while True:

        result = requests.get(
            operation_url,
            headers={
                "Ocp-Apim-Subscription-Key": AZURE_KEY
            },
        )

        result.raise_for_status()

        data = result.json()

        if data["status"] == "succeeded":
            return data["analyzeResult"]["content"]

        if data["status"] == "failed":
            raise Exception(data)

        time.sleep(1)
 
 
def compare_texts(text_a: str, text_b: str) -> None:
    """Print a unified diff and an overall similarity percentage."""
    lines_a = text_a.splitlines()
    lines_b = text_b.splitlines()
 
    ratio = difflib.SequenceMatcher(None, text_a, text_b).ratio() * 100
    print(f"\nOverall similarity: {ratio:.2f}%\n")
 
    diff = difflib.unified_diff(
        lines_a, lines_b, fromfile="master", tofile="sample", lineterm=""
    )
    diff_lines = list(diff)
 
    if not diff_lines:
        print("No differences found. The two PDFs contain identical text.")
        return
 
    print("Differences (- master / + sample):\n")
    for line in diff_lines:
        print(line)
 
 
def main():
    if len(sys.argv) != 3:
        print("Usage: python compare_pdfs.py <master.pdf> <sample.pdf>")
        sys.exit(1)
 
    master_path, sample_path = sys.argv[1], sys.argv[2]
 
    
    print(f"Analyzing master file: {master_path} ...")
    master_text = extract_text(master_path)
 
    print(f"Analyzing sample file: {sample_path} ...")
    sample_text = extract_text(sample_path)
 
    compare_texts(master_text, sample_text)
 
 
if __name__ == "__main__":
    main()
 