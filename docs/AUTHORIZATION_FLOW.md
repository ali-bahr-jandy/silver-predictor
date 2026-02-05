# Authorization Flow - Phone Number Based Authentication

## Overview

The authorization system now uses **phone number as the primary identifier** instead of Telegram chat ID. This allows users to authenticate from multiple devices using the same phone number.

## Key Changes

### 1. Database Schema

- **Primary Identifier**: `phone_number` (unique, NOT NULL)
- **Secondary Identifier**: `telegram_chat_id` (nullable, can change)
- **Unique Constraint**: Moved from `telegram_chat_id` to `phone_number`

### 2. Authorization Flow

#### When User Authenticates:

1. User sends phone number from Telegram (Device A, ChatID: 123)
2. OTP is sent and verified
3. System checks if phone number exists in database:
   - **If exists**: Updates the record with new `telegram_chat_id` (device switch)
   - **If new**: Creates new record with phone number and chat ID
4. Token is saved with phone number as primary key

#### When User Switches Device:

1. User logs in from Device B (ChatID: 456) with same phone number
2. System finds existing record by phone number
3. Updates `telegram_chat_id` from 123 → 456
4. User is immediately authorized on new device
5. Token remains valid (not regenerated)

#### When Loading Authorization:

1. System first checks by current Telegram chat ID
2. If not found, checks for any valid auth record
3. Links the valid auth to current chat ID
4. Loads token and phone number into memory

### 3. Benefits

✅ **Multi-Device Support**: Use the same account from different Telegram accounts  
✅ **Phone-Based Identity**: Your phone number is your identity, not device  
✅ **Seamless Switching**: Switch devices without re-authenticating  
✅ **Single Source of Truth**: One record per phone number

### 4. API Methods

#### NoghreseaAuthService Methods:

```typescript
// Check if phone number is authorized (new method)
async isPhoneNumberAuthorized(phoneNumber: string): Promise<boolean>

// Get auth record by phone number (new method)
async getAuthByPhoneNumber(phoneNumber: string): Promise<AuthState | null>

// Load user auth (now supports device switching)
async loadUserAuth(chatId: string): Promise<void>

// Verify OTP (now uses phone as primary key)
async verifyOtp(chatId: string, otp: string): Promise<boolean>

// Invalidate token (now invalidates by phone number)
async invalidateToken(chatId: string): Promise<void>
```

## Database Structure

```sql
CREATE TABLE auth_state (
  id UUID PRIMARY KEY,
  phone_number VARCHAR UNIQUE NOT NULL,  -- Primary identifier
  telegram_chat_id VARCHAR,               -- Can change between devices
  access_token TEXT,
  token_expires_at TIMESTAMP,
  is_valid BOOLEAN DEFAULT false,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IDX_phone_number_unique ON auth_state(phone_number);
```

## Example Scenarios

### Scenario 1: First Time Login

```
Device: iPhone
ChatID: 1056809488
Phone: 09354328338

→ Creates new record
→ Status: Authorized ✅
```

### Scenario 2: Login from Another Device

```
Device: Android
ChatID: 9876543210
Phone: 09354328338 (same phone)

→ Finds existing record by phone
→ Updates telegram_chat_id: 1056809488 → 9876543210
→ Status: Authorized ✅ (same token)
```

### Scenario 3: Back to First Device

```
Device: iPhone
ChatID: 1056809488
Phone: 09354328338

→ Loads existing auth by phone
→ Links back to ChatID 1056809488
→ Status: Authorized ✅
```

## Security Considerations

1. **Token Sharing**: Same token is used across all devices for the same phone number
2. **Device Tracking**: Last used `telegram_chat_id` is tracked
3. **Invalidation**: Invalidating token affects all devices for that phone number
4. **Expiration**: Token expiration applies to all devices

## Migration Notes

The following changes were applied to the database:

```sql
-- Removed unique constraint on telegram_chat_id
DROP INDEX IDX_2b022f90ba550605e6dbde3d5d;

-- Added unique constraint on phone_number
ALTER TABLE auth_state ALTER COLUMN phone_number SET NOT NULL;
CREATE UNIQUE INDEX IDX_phone_number_unique ON auth_state(phone_number);

-- Cleaned up duplicate records
DELETE FROM auth_state WHERE is_valid = false AND phone_number IN (
  SELECT phone_number FROM auth_state GROUP BY phone_number HAVING COUNT(*) > 1
);
```

## Testing the Flow

To test the authorization flow:

1. **Check current auth**:

```bash
docker exec silver_predictor_db psql -U postgres -d silver_predictor \
  -c "SELECT telegram_chat_id, phone_number, is_valid FROM auth_state;"
```

2. **Simulate device switch**: Send `/auth` command from a different Telegram account with the same phone number

3. **Verify update**: Check that `telegram_chat_id` was updated but token remains valid

## Future Enhancements

- [ ] Track all devices (one-to-many relationship)
- [ ] Allow user to see all active devices
- [ ] Individual device revocation
- [ ] Device naming/labeling
- [ ] Login notifications to all devices
