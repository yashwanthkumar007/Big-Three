#!/usr/bin/env python3
"""
Standalone script to seed default users into Cosmos DB.

Usage:
    python seed_users.py

This will create two default users in Cosmos DB:
1. Admin: admin@viatris.com / Admin@123 (Administrator)
2. User: user@viatris.com / User@123 (User)
"""

import os
import sys
from datetime import datetime, timezone

# Add the backend directory to the path
sys.path.insert(0, os.path.dirname(__file__))

from src.azure_service import cosmos_query_documents, cosmos_upsert_document
from src.logger import logger

DEFAULT_USERS = [
    {
        "id": "user_admin_001",
        "username": "Admin",
        "email": "admin@viatris.com",
        "firstName": "Admin",
        "lastName": "User",
        "accountType": "Administrator",
        "accountStatus": "Active",
        "company": "Viatris",
        "domain": "users",
        "password": "Admin@123",
        "emailNotificationEnabled": True,
    },
    {
        "id": "user_regular_001",
        "username": "User",
        "email": "user@viatris.com",
        "firstName": "Regular",
        "lastName": "User",
        "accountType": "User",
        "accountStatus": "Active",
        "company": "Viatris",
        "domain": "users",
        "password": "User@123",
        "emailNotificationEnabled": True,
    },
]


def seed_users():
    """Seed default users into Cosmos DB. Updates existing users or creates new ones."""
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    results = []

    for user in DEFAULT_USERS:
        email = user["email"]
        try:
            # Check if user already exists by email
            existing = cosmos_query_documents(
                "users",
                {
                    "query": "SELECT * FROM c WHERE c.email = @email",
                    "parameters": [{"name": "@email", "value": email}],
                },
            )
            if existing:
                # Update existing user with latest data
                existing_user = existing[0]
                payload = {**user, "createdAt": existing_user.get("createdAt", timestamp), "lastLogin": existing_user.get("lastLogin")}
                # Preserve the existing document's id
                payload["id"] = existing_user.get("id", user["id"])
                cosmos_upsert_document("users", payload)
                print(f"✓ User {email} already exists, updated.")
                results.append({"email": email, "status": "updated"})
                continue

            # Create the user
            payload = {**user, "createdAt": timestamp, "lastLogin": None}
            cosmos_upsert_document("users", payload)
            print(f"✓ Successfully seeded user: {email}")
            results.append({"email": email, "status": "created"})
        except Exception as exc:
            print(f"✗ Failed to seed user {email}: {exc}")
            results.append({"email": email, "status": "failed", "error": str(exc)})

    # Verify all users
    print("\n--- Verification ---")
    try:
        # Query by email to verify users exist
        for email in ["admin@viatris.com", "user@viatris.com"]:
            users = cosmos_query_documents(
                "users",
                {
                    "query": "SELECT * FROM c WHERE c.email = @email",
                    "parameters": [{"name": "@email", "value": email}],
                },
            )
            if users:
                u = users[0]
                print(f"  ✓ Found: {u.get('email')} ({u.get('accountType')}) - ID: {u.get('id')}")
            else:
                print(f"  ✗ Not found: {email}")
    except Exception as exc:
        print(f"Failed to query users: {exc}")

    return results


if __name__ == "__main__":
    print("Seeding default users into Cosmos DB...\n")
    results = seed_users()
    print("\nDone!")
