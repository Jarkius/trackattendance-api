#!/usr/bin/env python3
"""Test root endpoint of production Cloud Run API."""

import requests

def test_root_endpoint():
    """Test the root endpoint to see if it works."""

    api_url = "https://trackattendance-api-969370105809.asia-southeast1.run.app"

    print("Testing Root Endpoint...")
    print(f"URL: {api_url}")

    try:
        response = requests.get(api_url, timeout=10)
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {response.json()}")
            print("[OK] Root endpoint is working!")
        else:
            print(f"[FAIL] Root endpoint failed: {response.text}")
    except Exception as e:
        print(f"[ERROR] Request failed: {e}")

if __name__ == "__main__":
    test_root_endpoint()