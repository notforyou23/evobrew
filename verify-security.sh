#!/bin/bash
# COSMO IDE - Security Verification Script
# Run this to verify repository is safe for public launch

echo "🔍 COSMO IDE Security Verification"
echo "==================================="
echo ""

FAILED=0

# Check 1: Git history for sensitive files
echo "1️⃣  Checking git history for sensitive files..."
KEY_IN_HISTORY=$(git log --all --oneline -- ssl/key.pem 2>/dev/null | wc -l)
CERT_IN_HISTORY=$(git log --all --oneline -- ssl/cert.pem 2>/dev/null | wc -l)
DB_IN_HISTORY=$(git log --all --oneline -- prisma/studio.db 2>/dev/null | wc -l)

if [[ $KEY_IN_HISTORY -eq 0 ]]; then
    echo "   ✅ ssl/key.pem: Not in history"
else
    echo "   🔴 ssl/key.pem: Found in $KEY_IN_HISTORY commits"
    FAILED=1
fi

if [[ $CERT_IN_HISTORY -eq 0 ]]; then
    echo "   ✅ ssl/cert.pem: Not in history"
else
    echo "   🟡 ssl/cert.pem: Found in $CERT_IN_HISTORY commits (low risk)"
fi

if [[ $DB_IN_HISTORY -eq 0 ]]; then
    echo "   ✅ prisma/studio.db: Not in history"
else
    echo "   🟡 prisma/studio.db: Found in $DB_IN_HISTORY commits (verify empty)"
fi

echo ""

# Check 2: .env file protection
echo "2️⃣  Checking .env file protection..."
ENV_IN_GIT=$(git ls-files | grep -E "^\.env$" | wc -l)

if [[ $ENV_IN_GIT -eq 0 ]]; then
    echo "   ✅ .env: Not tracked by git"
else
    echo "   🔴 .env: Is tracked by git (CRITICAL)"
    FAILED=1
fi

echo ""

# Check 3: API keys in committed files
echo "3️⃣  Scanning committed files for API keys..."
REAL_KEYS=$(git grep -E "sk-ant-api[0-9]|sk-proj-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{30,}" 2>/dev/null | grep -v ".env.example" | wc -l)

if [[ $REAL_KEYS -eq 0 ]]; then
    echo "   ✅ No real API keys found in committed files"
else
    echo "   🔴 Found $REAL_KEYS potential API keys in committed files"
    git grep -E "sk-ant-api[0-9]|sk-proj-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{30,}" | head -5
    FAILED=1
fi

echo ""

# Check 4: .gitignore coverage
echo "4️⃣  Verifying .gitignore coverage..."
REQUIRED_PATTERNS=(
    ".env"
    "ssl/"
    "*.pem"
    "*.key"
    "conversations/"
    "*.log"
)

for pattern in "${REQUIRED_PATTERNS[@]}"; do
    if grep -q "^$pattern$" .gitignore; then
        echo "   ✅ $pattern"
    else
        echo "   ⚠️  $pattern: Missing from .gitignore"
        FAILED=1
    fi
done

echo ""

# Check 5: Current working tree
echo "5️⃣  Checking working tree for sensitive files..."
UNTRACKED_SENSITIVE=$(git status --porcelain | grep -E "ssl/.*\.pem$|\.env$" | wc -l)

if [[ $UNTRACKED_SENSITIVE -eq 0 ]]; then
    echo "   ✅ No sensitive files staged or tracked"
else
    echo "   ✅ Sensitive files present but untracked (as expected)"
fi

echo ""

# Check 6: Remote repository status
echo "6️⃣  Checking remote repository..."
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")

if [[ -z "$REMOTE_URL" ]]; then
    echo "   ℹ️  No remote configured"
elif [[ "$REMOTE_URL" == *"github.com"* ]]; then
    echo "   📍 Remote: $REMOTE_URL"
    
    # Check if pushed
    LOCAL_COMMIT=$(git rev-parse HEAD 2>/dev/null)
    REMOTE_COMMIT=$(git rev-parse origin/main 2>/dev/null || echo "none")
    
    if [[ "$LOCAL_COMMIT" == "$REMOTE_COMMIT" ]]; then
        echo "   ⚠️  Local and remote are in sync"
        if [[ $FAILED -eq 1 ]]; then
            echo "   🔴 WARNING: Issues found but already pushed!"
            echo "   🔴 You may need to force-push after cleanup"
        fi
    else
        echo "   ✅ Local ahead of remote (not pushed yet)"
    fi
else
    echo "   📍 Remote: $REMOTE_URL"
fi

echo ""
echo "================================="

if [[ $FAILED -eq 0 ]]; then
    echo "✅ ALL CHECKS PASSED"
    echo ""
    echo "Repository is safe to push publicly! 🎉"
    echo ""
    echo "Next steps:"
    echo "  git push origin main"
else
    echo "🔴 SECURITY ISSUES FOUND"
    echo ""
    echo "DO NOT push to public repository!"
    echo ""
    echo "Required fixes:"
    echo "  1. Run: ./cleanup-git-history.sh"
    echo "  2. Run: ./regenerate-ssl-certs.sh"
    echo "  3. Run this script again to verify"
fi

exit $FAILED
