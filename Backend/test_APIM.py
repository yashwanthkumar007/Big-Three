import time
import requests

API_KEY = "5ed52003018d4319be042559de4c155b"

ANALYZE_URL = "https://emtech-apim-all-all-poc.azure-api.net/docintel/documentModels/prebuilt-layout:analyze?api-version=2024-11-30"

PDF_FILE = "Data/Master/Test1 Master.pdf"

headers = {
    "Ocp-Apim-Subscription-Key": API_KEY,
    "Content-Type": "application/pdf",
}

# Submit document
with open(PDF_FILE, "rb") as f:
    response = requests.post(
        ANALYZE_URL,
        headers=headers,
        data=f,
    )

response.raise_for_status()

operation_location = response.headers["Operation-Location"]

# Build APIM polling URL
result_id = operation_location.split("?")[0].split("/")[-1]

base = ANALYZE_URL.split(":analyze")[0]
poll_url = f"{base}/analyzeResults/{result_id}?api-version=2024-11-30"

print("Polling:", poll_url)

# Poll until complete
while True:

    result = requests.get(
        poll_url,
        headers={
            "Ocp-Apim-Subscription-Key": API_KEY
        },
    )

    result.raise_for_status()

    data = result.json()

    print("Status:", data["status"])

    if data["status"] == "succeeded":
        break

    if data["status"] == "failed":
        raise Exception(data)

    time.sleep(1)

print("\n===== Extracted Text =====\n")
print(data["analyzeResult"]["content"])