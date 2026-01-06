# Pre-Launch Checklist

**Date**: 2026-01-04  
**Status**: ⚠️ **PRE-LAUNCH REVIEW**

---

## 🚨 Critical Issues to Fix Before Launch

### 1. **README.md - OUTDATED COMMAND REFERENCES** ❌
**Status**: Needs immediate update

**Issue**: Still references old command structure:
- Lists `/claim`, `/register`, `/manage list`, `/manage update`, `/manage unclaim`, `/manage delete`
- Should list: `/node claim`, `/node register`, `/mynodes`, `/node update`, `/node unclaim`, `/node delete`
- Missing: `/stats-cities`, `/stats-frequencies`, `/stats-source`

**Action Required**: Update README.md lines 23-30 with new command structure

---

### 2. **Environment Variables Check** ⚠️
**Status**: Verify before deployment

**Checklist**:
- [ ] `.env` file exists with all required variables
- [ ] `DISCORD_BOT_TOKEN` is set and valid
- [ ] `DISCORD_GUILD_ID` is set (optional but recommended)
- [ ] `STARTUP_CHANNEL_ID` is set for sync notifications
- [ ] `STARTUP_MESSAGE_ID` is set for bot instructions post
- [ ] `DATABASE_PATH` is correct for Docker (`/app/data/belgian_nodes.db`)
- [ ] `SYNC_INTERVAL_HOURS` is set (default: 6)

---

### 3. **Database Migration** ⚠️
**Status**: Verify schema is up-to-date

**Checklist**:
- [ ] Database schema matches current code
- [ ] All indexes are created
- [ ] Run `initialize_db()` if starting fresh
- [ ] Verify `belgian_nodes`, `sync_history`, `node_changes` tables exist

---

### 4. **Docker Configuration** ⚠️
**Status**: Verify before deployment

**Checklist**:
- [ ] `docker-compose.yml` is configured correctly
- [ ] All three services defined: `bot`, `api`, `sync`
- [ ] Volume mounts are correct (`data/`, `logs/`)
- [ ] Health checks are configured
- [ ] Network configuration is correct

---

### 5. **Discord Bot Permissions** ⚠️
**Status**: Verify before launch

**Checklist**:
- [ ] Bot has `applications.commands` scope
- [ ] Bot has permission to send messages in target channels
- [ ] Bot has permission to edit messages (for instructions post)
- [ ] Bot invite URL includes: `&scope=bot%20applications.commands`

---

### 6. **First Sync** ⚠️
**Status**: Plan initial data load

**Checklist**:
- [ ] Run initial sync manually or wait for scheduled sync
- [ ] Verify nodes are being imported correctly
- [ ] Check sync notifications are working
- [ ] Verify no errors in logs

---

### 7. **Testing** ⚠️
**Status**: Run final tests

**Checklist**:
- [ ] Test all Discord commands (`/node claim`, `/node register`, `/mynodes`, etc.)
- [ ] Test web map loads correctly
- [ ] Test search functionality
- [ ] Test node display and popups
- [ ] Test statistics display
- [ ] Verify no console errors

---

## 📋 Documentation Status

### ✅ Up-to-Date Files
- `DISCORDBOT_INSTRUCTIONS.md` - ✅ Updated with new commands
- `DEPLOYMENT.md` - ✅ Complete
- `TESTING_GUIDE.md` - ✅ Updated for new command structure
- `COMMAND_NAMING.md` - ✅ Documents new structure
- `SYNC_LOGIC_REVIEW.md` - ✅ Technical reference
- `PROJECT_DATA_INTEGRATION_SCHEME.md` - ✅ Technical reference
- `DATA_ARCHITECTURE_ANALYSIS.md` - ✅ Technical reference

### ❌ Needs Update
- `README.md` - ❌ **OUTDATED** - Command references need updating

### 📦 Can Be Archived/Consolidated
- `IMPLEMENTATION_PLAN.md` - Implementation complete, can archive
- `DOCUMENTATION_UPDATE_SUMMARY.md` - Historical, can archive
- `DOCUMENTATION_CODE_VERIFICATION.md` - Historical, can archive
- `TODO.md` - All items complete, can archive
- `PROJECT_REVIEW.md` - Historical review, can consolidate
- `CODE_REVIEW.md` - Historical review, can consolidate
- `IMPLEMENTATION_REVIEW.md` - Historical review, can consolidate

---

## 🎯 Next Steps

1. **IMMEDIATE**: Update `README.md` with new command structure
2. **BEFORE LAUNCH**: Complete all checklist items above
3. **POST-LAUNCH**: Archive/consolidate historical documentation files

---

*This checklist should be completed before going live.*

