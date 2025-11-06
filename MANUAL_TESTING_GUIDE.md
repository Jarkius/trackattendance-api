# 📋 Track Attendance System - Manual Testing Guide

## 🏗️ System Overview

The Track Attendance system consists of two main components:

1. **QR Desktop Application** (`C:\Workspace\Dev\Python\QR`)
   - Python/PyQt6 desktop app for QR/barcode scanning
   - Local SQLite database with sync tracking
   - Real-time web dashboard
   - Manual cloud sync functionality

2. **Cloud Run API** (`C:\Workspace\Dev\NodeJS\trackattendance-api`)
   - Node.js/TypeScript Fastify server
   - Neon PostgreSQL cloud database
   - RESTful API with authentication
   - Currently running on `http://localhost:5000`

## 🚀 Quick Start Setup

### Step 1: Start the Cloud API Server
```bash
# Navigate to API directory
cd C:\Workspace\Dev\NodeJS\trackattendance-api

# Start the development server
npm run dev
```

**Expected Output:**
```
> trackattendance-api@1.0.0 dev
> tsx watch server.ts

{"level":30,"time":...,"msg":"Server listening at http://127.0.0.1:5000"}
{"level":30,"time":...,"msg":"API listening on :5000"}
```

### Step 2: Launch the QR Desktop Application
```bash
# Navigate to QR app directory in a NEW terminal
cd C:\Workspace\Dev\Python\QR

# Launch the PyQt6 application
python main.py
```

**Expected Result:** Desktop window should open with QR scanner interface

---

## 🧪 Manual Testing Scenarios

### 📱 Test Category 1: Basic QR Scanning Workflow

#### Test 1.1: Manual Badge Entry
**Objective:** Verify basic scan creation and local storage

**Steps:**
1. Launch QR desktop application
2. Click "Scan Badge" button
3. Enter badge ID: `101117`
4. Click "Record Manual Entry"
5. Observe the results

**Expected Results:**
- ✅ Success message appears
- ✅ New record shows in dashboard table
- ✅ Badge ID displays correctly
- ✅ Sync status shows "pending"
- ✅ Timestamp is current and properly formatted
- ✅ Station name is detected correctly

#### Test 1.2: Real-time Dashboard Updates
**Objective:** Verify dashboard updates immediately

**Steps:**
1. Create 3-5 scan entries using different badge IDs
2. Watch the dashboard after each entry
3. Check statistics counts

**Expected Results:**
- ✅ Total count increases with each entry
- ✅ New entries appear at top of table immediately
- ✅ Pending count increases
- ✅ Employee name displays if matched
- ✅ All timestamps are in correct format

#### Test 1.3: Data Validation
**Objective:** Verify data validation works correctly

**Steps:**
1. Try to create entry with empty badge ID
2. Try to create entry with special characters
3. Verify station name detection

**Expected Results:**
- ✅ Empty badge ID shows validation error
- ✅ Special characters handled properly
- ✅ Station name displays correctly from config

---

### 🌐 Test Category 2: Cloud Synchronization Testing

#### Test 2.1: API Health Check
**Objective:** Verify Cloud API is accessible

**Steps:**
1. Open browser or use curl
2. Navigate to: `http://localhost:5000/healthz`

**Expected Results:**
- ✅ Response: `{"ok":true}`
- ✅ HTTP Status: 200
- ✅ Response time < 1 second

#### Test 2.2: Manual Cloud Sync
**Objective:** Verify end-to-end sync functionality

**Prerequisites:**
- At least 1 pending scan exists
- Cloud API server is running

**Steps:**
1. In QR app, click "Sync Now" button
2. Observe loading indicators
3. Wait for completion message
4. Check sync statistics

**Expected Results:**
- ✅ Loading spinner appears during sync
- ✅ Success message: "Successfully synced X scans"
- ✅ Pending count decreases to 0
- ✅ Synced count increases appropriately
- ✅ No error messages appear

#### Test 2.3: Authentication Testing
**Objective:** Verify API authentication works

**Steps:**
1. Test with valid API key:
```bash
curl -X POST http://localhost:5000/v1/scans/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 6541f2c7892b4e5287d50c2414d179f8" \
  -d '{"events":[{"idempotency_key":"test-'$(date +%s)'","badge_id":"101117","station_name":"Test","scanned_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}]}'
```

2. Test with invalid API key:
```bash
curl -X POST http://localhost:5000/v1/scans/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-key" \
  -d '{"events":[]}'
```

**Expected Results:**
- ✅ Valid key: HTTP 200, successful response
- ✅ Invalid key: HTTP 401, "Unauthorized" error
- ✅ API key security is working properly

#### Test 2.4: Batch Processing Test
**Objective:** Verify multiple records sync correctly

**Steps:**
1. Create 5-10 scan entries in QR app
2. Click "Sync Now"
3. Monitor the sync process
4. Verify all records are processed

**Expected Results:**
- ✅ All pending scans are synced
- ✅ Sync count matches number of pending scans
- ✅ No records left in pending status
- ✅ Cloud database receives all records

---

### 🗄️ Test Category 3: Data Integrity Testing

#### Test 3.1: Create Test Scan Script
**Objective:** Use automated test to verify data creation

**Steps:**
```bash
cd C:\Workspace\Dev\Python\QR
python create_test_scan.py
```

**Expected Results:**
- ✅ Shows created scan details
- ✅ Provides scan ID, badge ID, timestamp
- ✅ Sync status shows "pending"
- ✅ Data is stored in local SQLite

#### Test 3.2: Production Sync Test
**Objective:** Verify complete sync to production

**Steps:**
```bash
cd C:\Workspace\Dev\Python/QR
python test_production_sync.py
```

**Expected Results:**
```
=== Testing QR App Sync to Production Cloud Run API ===
[OK] Database and sync service initialized
Status: [OK] Connected
Scans synced: 1
[OK] Successfully synced scans to production!
```

#### Test 3.3: Database Consistency Check
**Objective:** Verify data consistency across systems

**Steps:**
1. Note synced scan count in QR app
2. Check local SQLite database
3. Verify cloud database via API or direct connection
4. Compare record counts and data

**Expected Results:**
- ✅ Same number of records in both databases
- ✅ Badge IDs match exactly
- ✅ Timestamps are properly formatted
- ✅ No PII data in cloud database
- ✅ Sync status updated correctly

---

### ⚠️ Test Category 4: Error Handling Testing

#### Test 4.1: Network Failure Simulation
**Objective:** Test system behavior during network issues

**Steps:**
1. Stop the API server (Ctrl+C in terminal)
2. Try to sync from QR app
3. Observe error handling
4. Restart API server
5. Retry sync operation

**Expected Results:**
- ✅ Clear error message about connection failure
- ✅ No data loss during failure
- ✅ Sync succeeds after server restart
- ✅ Proper error recovery behavior

#### Test 4.2: Invalid Data Handling
**Objective:** Test API validation

**Steps:**
```bash
# Test with missing required fields
curl -X POST http://localhost:5000/v1/scans/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 6541f2c7892b4e5287d50c2414d179f8" \
  -d '{"events":[{"badge_id":"test"}]}'

# Test with invalid timestamp
curl -X POST http://localhost:5000/v1/scans/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 6541f2c7892b4e5287d50c2414d179f8" \
  -d '{"events":[{"idempotency_key":"test","badge_id":"101117","station_name":"Test","scanned_at":"invalid-date"}]}'
```

**Expected Results:**
- ✅ Proper validation error messages
- ✅ HTTP 400 status for invalid data
- ✅ Detailed error descriptions
- ✅ No partial data insertion

#### Test 4.3: Idempotency Testing
**Objective:** Verify duplicate handling

**Steps:**
1. Create a scan with specific idempotency key
2. Sync it successfully
3. Try to sync the same scan again
4. Verify duplicate detection

**Expected Results:**
- ✅ First sync: record saved
- ✅ Second sync: record marked as duplicate
- ✅ No duplicate records in database
- ✅ Proper duplicate count in response

---

### 🚀 Test Category 5: Performance Testing

#### Test 5.1: Large Batch Processing
**Objective:** Test system performance with multiple records

**Steps:**
1. Create 50+ test scans using script
2. Initiate sync operation
3. Monitor processing time
4. Verify all records are processed

**Expected Results:**
- ✅ All records processed successfully
- ✅ Processing time < 30 seconds
- ✅ No memory issues or timeouts
- ✅ Consistent performance throughout batch

#### Test 5.2: Concurrent Operations
**Objective:** Test system stability under load

**Steps:**
1. Start sync operation
2. While syncing, create new scan entries
3. Try multiple sync operations rapidly
4. Monitor system stability

**Expected Results:**
- ✅ System remains stable during concurrent operations
- ✅ No data corruption or loss
- ✅ Proper queue handling of operations
- ✅ Consistent database state

---

## 🔧 Quick Test Commands

### API Health Check
```bash
curl http://localhost:5000/healthz
```

### Test API with Valid Data
```bash
curl -X POST http://localhost:5000/v1/scans/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 6541f2c7892b4e5287d50c2414d179f8" \
  -d '{
    "events": [{
      "idempotency_key": "test-'$(date +%s)'",
      "badge_id": "101117",
      "station_name": "Manual Test",
      "scanned_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "meta": {"test": true}
    }]
  }'
```

### QR App Test Scripts
```bash
cd C:\Workspace\Dev\Python\QR

# Create single test scan
python create_test_scan.py

# Test full sync to production
python test_production_sync.py

# Debug sync process
python test_sync_debug.py

# Test batch sync
python test_batch_sync.py
```

### API Comprehensive Test
```bash
cd C:\Workspace\Dev\NodeJS\trackattendance-api

# Run comprehensive API test suite
node testscript/test-api-insert.js

# Test database connection
node testscript/test-neon.js

# Test timestamp compatibility
node testscript/test-timestamp-conversion.js
```

---

## 📊 Verification Checkpoints

### During Testing, Verify These Points:

#### ✅ QR Application
- [ ] Scans create immediate local records
- [ ] Dashboard updates in real-time
- [ ] Badge IDs display correctly
- [ ] Timestamps are properly formatted (ISO8601)
- [ ] Sync status updates correctly (pending → synced)
- [ ] Error messages are user-friendly
- [ ] Export functionality works (XLSX format)

#### ✅ Cloud API
- [ ] Health endpoint responds correctly
- [ ] Authentication/authorization works
- [ ] Batch processing handles multiple records
- [ ] Validation catches invalid data
- [ ] Idempotency prevents duplicates
- [ ] Error responses are descriptive
- [ ] Response times are acceptable (<5 seconds)

#### ✅ Data Integrity
- [ ] Local SQLite stores all required fields
- [ ] Cloud database receives correct data
- [ ] No PII (personal info) sent to cloud
- [ ] Timestamps are compatible between systems
- [ ] Schema alignment is maintained (1:1 mapping)
- [ ] Sync status tracking is accurate

#### ✅ System Performance
- [ ] Handles large batches (50+ records)
- [ ] Recovers from network failures
- [ ] Memory usage stays stable
- [ ] No data corruption during failures
- [ ] Concurrent operations handled properly

---

## 🚨 Troubleshooting Guide

### Common Issues and Solutions

#### Issue: API Server Not Responding
**Symptoms:** Connection refused, timeout errors
**Solutions:**
1. Ensure server is running: `npm run dev`
2. Check port 5000 is not blocked by firewall
3. Verify no other processes using port 5000
4. Check Node.js and npm are properly installed

#### Issue: QR App Won't Launch
**Symptoms:** Import errors, window doesn't appear
**Solutions:**
1. Check Python dependencies: `pip install -r requirements.txt`
2. Verify PyQt6 is installed: `pip install PyQt6`
3. Check Python version (3.8+ required)
4. Verify database directory exists: `data/`

#### Issue: Sync Fails with Connection Error
**Symptoms:** "Cannot connect to API" messages
**Solutions:**
1. Verify API server is running and accessible
2. Check API URL configuration in QR app
3. Verify API key is correct
4. Test network connectivity: `curl http://localhost:5000/healthz`

#### Issue: Database Connection Errors
**Symptoms:** SQL errors, connection timeouts
**Solutions:**
1. Check Neon database URL configuration
2. Verify internet connectivity
3. Test database connection with provided scripts
4. Check for IP whitelist issues

#### Issue: Timestamp Format Errors
**Symptoms:** "Invalid date-time format" errors
**Solutions:**
1. Ensure timestamps are in ISO8601 format
2. Include 'Z' suffix for UTC timestamps
3. Check timezone handling in both systems
4. Use provided timestamp test scripts

---

## 📈 Success Criteria

### Test Completion Checklist

#### ✅ Core Functionality (Must Pass)
- [ ] QR scans create local records
- [ ] Manual sync to cloud works
- [ ] Dashboard updates in real-time
- [ ] Data persists in both databases
- [ ] API authentication works correctly

#### ✅ Data Integrity (Must Pass)
- [ ] No data loss during sync
- [ ] Timestamps are compatible
- [ ] Schema alignment maintained
- [ ] Privacy compliance verified
- [ ] Idempotency prevents duplicates

#### ✅ Error Handling (Should Pass)
- [ ] Network failures handled gracefully
- [ ] Invalid data rejected properly
- [ ] User-friendly error messages
- [ ] System recovers from failures
- [ ] No data corruption

#### ✅ Performance (Nice to Have)
- [ ] Handles 50+ record batches
- [ ] Response times < 5 seconds
- [ ] Memory usage stable
- [ ] No timeout issues
- [ ] Scalable for production use

---

## 🎯 Production Readiness

The Track Attendance system is **production-ready** when:

1. ✅ All core functionality tests pass
2. ✅ Data integrity is verified across systems
3. ✅ Error handling is robust and user-friendly
4. ✅ Performance meets requirements
5. ✅ Security (authentication/authorization) works
6. ✅ Privacy compliance is maintained
7. ✅ Monitoring and logging are functional

## 📞 Support Information

### Configuration Details
- **API URL:** `http://localhost:5000` (development)
- **API Key:** `6541f2c7892b4e5287d50c2414d179f8`
- **Local Database:** `C:\Workspace\Dev\Python\QR\data\database.db`
- **Cloud Database:** Neon PostgreSQL (configured)

### Test Data Creation
```bash
# Create test data for testing
cd C:\Workspace\Dev\Python\QR
python create_test_scan.py

# Sync test data to production
python test_production_sync.py
```

### Log Locations
- **API Logs:** Console output from `npm run dev`
- **QR App Logs:** Console output from `python main.py`
- **Database Logs:** Neon dashboard (cloud), SQLite logs (local)

---

**This testing guide provides comprehensive coverage of all system functionality. Execute tests systematically and document results for production deployment verification.**