#!/usr/bin/env python3
"""Test the production Cloud Run API functionality."""

import requests
import json
from datetime import datetime, timezone

def test_cloud_run_api():
    """Test the Cloud Run API with production credentials."""

    # API Configuration
    api_url = "https://trackattendance-api-969370105809.asia-southeast1.run.app"
    api_key = "6541f2c7892b4e5287d50c2414d179f8"

    print("Testing Track Attendance API - Cloud Run Production")
    print(f"URL: {api_url}")
    print("=" * 60)

    # Test 1: Health Check
    print("1. Testing Health Check...")
    try:
        response = requests.get(f"{api_url}/", timeout=10)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            print(f"   Response: {response.json()}")
            print("   [PASS] Health check passed")
        else:
            print(f"   [FAIL] Health check failed: {response.text}")
    except Exception as e:
        print(f"   [ERROR] Health check error: {e}")

    print()

    # Test 2: Batch API with valid data
    print("2. Testing Batch API...")
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }

        # Create test scan data
        test_data = {
            "events": [{
                "idempotency_key": f"test-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
                "badge_id": "101117",
                "station_name": "Main Gate",
                "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "meta": {
                    "location": "Main Gate",
                    "test": True
                }
            }]
        }

        response = requests.post(
            f"{api_url}/v1/scans/batch",
            headers=headers,
            json=test_data,
            timeout=30
        )

        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            result = response.json()
            print(f"   Response: {result}")
            print("   [PASS] Batch API test passed")
        else:
            print(f"   [FAIL] Batch API failed: {response.text}")

    except Exception as e:
        print(f"   [ERROR] Batch API error: {e}")

    print()

    # Test 3: Invalid API Key
    print("3. Testing Authentication...")
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer invalid-key"
        }

        response = requests.post(
            f"{api_url}/v1/scans/batch",
            headers=headers,
            json={"events": []},
            timeout=10
        )

        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   [PASS] Authentication working correctly")
        else:
            print(f"   [FAIL] Authentication issue: {response.text}")

    except Exception as e:
        print(f"   [ERROR] Authentication test error: {e}")

    print()
    print("API Testing Complete!")

if __name__ == "__main__":
    test_cloud_run_api()