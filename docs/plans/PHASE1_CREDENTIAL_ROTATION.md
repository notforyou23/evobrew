# Phase 1: Immediate Credential Containment - Execution Checklist

**Date:** 2026-02-16 11:42 EST  
**Status:** READY TO EXECUTE  
**Blocking:** DO NOT PUSH TO PUBLIC REPOSITORY UNTIL COMPLETE

---

## 🔴 Exposed Credentials Found in Git History

### Commit 6244229 - File: `cursor_revisiting_implementation_approa.md`

**OpenAI API Key:**
```
[REDACTED_OPENAI_API_KEY]
```

**Anthropic API Key:**
```
[REDACTED_ANTHROPIC_API_KEY]
```

**xAI API Key:**
```
[REDACTED_XAI_API_KEY]
```

### Commit e601a61 - Anthropic OAuth Token (in database)

**OAuth Token:** (found via security scan)
```
[REDACTED_ANTHROPIC_OAUTH_TOKEN]
```

---

## ✅ Rotation Checklist (Manual Steps Required)

### 1. Revoke OpenAI API Key
- [ ] Go to https://platform.openai.com/api-keys
- [ ] Find key ending in `...cdFLgA`
- [ ] Click "Revoke" or "Delete"
- [ ] Generate new key
- [ ] Update local `.env` file (do NOT commit)

### 2. Revoke Anthropic API Key
- [ ] Go to https://console.anthropic.com/settings/keys
- [ ] Find key ending in `...nQAA`
- [ ] Click "Delete" or "Revoke"
- [ ] Generate new key
- [ ] Update local `.env` file (do NOT commit)

### 3. Revoke Anthropic OAuth Token
- [ ] Go to https://console.anthropic.com/settings/oauth
- [ ] Find token ending in `...gQAA` or revoke all OAuth tokens for safety
- [ ] Click "Revoke"
- [ ] Generate new OAuth token (if needed)
- [ ] Update local `.env` file (do NOT commit)

### 4. Revoke xAI API Key (Grok)
- [ ] Go to https://console.x.ai/
- [ ] Find key ending in `...heZD`
- [ ] Click "Revoke" or "Delete"
- [ ] Generate new key
- [ ] Update local `.env` file (do NOT commit)

### 5. Regenerate SSL Certificates (After Git History Rewrite)

**DO NOT DO THIS YET** - Wait until after Phase 3 (Git history rewrite)

```bash
cd /Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl/
rm key.pem cert.pem

openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem \
  -days 365 -nodes \
  -subj "/C=US/ST=Local/L=Local/O=COSMO IDE/OU=Dev/CN=localhost"

# Verify
openssl x509 -in cert.pem -text -noout | grep "Not After"
```

### 6. Verify No Credentials in Current `.env`

```bash
cd /Users/jtr/_JTR23_/cosmo_ide_v2_dev

# Check if .env is gitignored (should be)
git check-ignore .env

# Should output: .env (means it's ignored - GOOD)
```

---

## 🚨 Pre-Push Gate

**DO NOT PUSH TO PUBLIC UNTIL:**
- [ ] All 4 API keys revoked
- [ ] OAuth token revoked
- [ ] Phase 3 (Git history rewrite) complete
- [ ] Phase 6 (verification) passes

---

## 🔍 Current Protection Status

**Good News:**
- `.env` is properly gitignored ✅
- All exposed keys are in Git **history only**, not current working tree ✅
- Working tree `.env` contains fresh credentials ✅

**Risk:**
- If we push to GitHub now, commit `6244229` and `e601a61` will expose these keys forever
- Anyone cloning will have access to Git history containing real credentials

---

## ⏭️ Next Phase

After completing credential rotation:
- **Phase 2:** Working-tree cleanup (remove untracked security reports)
- **Phase 3:** Git history rewrite (purge sensitive files)
- **Phase 4:** `.gitignore` repair
- **Phase 5:** Documentation package
- **Phase 6:** Final verification

---

**Ready to execute?** All steps require manual action at API provider consoles.

**Estimated time:** 15-20 minutes

**Priority:** CRITICAL - Must complete before any public push
