import requests

B = "http://127.0.0.1:5000"
pdf = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF"
)

r = requests.post(B + "/api/auth/login", json={"email": "admin@viatris.com", "password": "Admin@293"}, timeout=60)
email = r.json()["email"]
H = {"X-User-Email": email}

files = {"master": ("master.pdf", pdf, "application/pdf"), "sample": ("sample.pdf", pdf, "application/pdf")}
r = requests.post(B + "/api/inspections", headers=H, files=files, data={"inspectionType": "text"}, timeout=90)
print("CREATE", r.status_code, r.json().get("inspectionId"), r.json().get("status"))
iid = r.json()["inspectionId"]

r = requests.get(B + "/api/inspections", headers=H, timeout=90)
data = r.json()
print("LIST", r.status_code, "count=", len(data), "newest=", data[0]["inspectionId"] if data else None)

r = requests.get(B + "/api/inspections/" + iid, headers=H, timeout=90)
print("SINGLE", r.status_code, "has_result=", "result" in r.json())

r = requests.post(B + "/api/inspect", headers=H, json={"session_id": iid, "inspection_type": "text", "inspection_id": iid}, timeout=180)
print("INSPECT", r.status_code)

r = requests.get(B + "/api/inspections/" + iid, headers=H, timeout=90)
print("AFTER", r.json().get("status"), "resultId=", r.json().get("resultId"))

r2 = requests.post(B + "/api/auth/login", json={"email": "user@viatris.com", "password": "User@123"}, timeout=60)
H2 = {"X-User-Email": r2.json()["email"]}
r = requests.get(B + "/api/inspections", headers=H2, timeout=90)
print("USER LIST count=", len(r.json()))
r = requests.get(B + "/api/inspections/" + iid, headers=H2, timeout=90)
print("FOREIGN GET", r.status_code)
