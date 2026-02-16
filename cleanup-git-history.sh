#!/bin/bash
# COSMO IDE - Git History Cleanup Script
# Removes sensitive files from git history before public launch
# 
# ⚠️ WARNING: This rewrites git history. Run BEFORE pushing to GitHub.

set -e

echo "🔍 COSMO IDE Git History Cleanup"
echo "================================="
echo ""

# Check if BFG is installed
if command -v bfg &> /dev/null; then
    echo "✅ BFG Repo-Cleaner found"
    CLEANUP_METHOD="bfg"
elif command -v git-filter-repo &> /dev/null; then
    echo "✅ git-filter-repo found"
    CLEANUP_METHOD="filter-repo"
else
    echo "❌ ERROR: Neither BFG nor git-filter-repo found"
    echo ""
    echo "Install one of:"
    echo "  brew install bfg           (recommended - faster)"
    echo "  brew install git-filter-repo"
    exit 1
fi

echo ""
echo "📋 Files to remove from history:"
echo "  - ssl/key.pem (PRIVATE KEY - critical)"
echo "  - ssl/cert.pem (public cert - unnecessary)"
echo "  - prisma/studio.db (database file)"
echo ""

# Verify we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -d ".git" ]]; then
    echo "❌ ERROR: Not in COSMO IDE root directory"
    exit 1
fi

# Create backup
echo "📦 Creating backup..."
BACKUP_DIR="../cosmo_ide_backup_$(date +%Y%m%d_%H%M%S)"
cp -r . "$BACKUP_DIR"
echo "✅ Backup created at: $BACKUP_DIR"
echo ""

# Confirm before proceeding
read -p "⚠️  This will REWRITE git history. Continue? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
    echo "❌ Cancelled"
    exit 0
fi

echo ""
echo "🧹 Cleaning git history..."

if [[ "$CLEANUP_METHOD" == "bfg" ]]; then
    # BFG method (faster)
    bfg --delete-files key.pem
    bfg --delete-files cert.pem
    bfg --delete-files studio.db
    git reflog expire --expire=now --all
    git gc --prune=now --aggressive
else
    # git-filter-repo method (more thorough)
    git filter-repo --path ssl/key.pem --invert-paths --force
    git filter-repo --path ssl/cert.pem --invert-paths --force
    git filter-repo --path prisma/studio.db --invert-paths --force
fi

echo ""
echo "✅ Git history cleaned!"
echo ""

# Verification
echo "🔍 Verification:"
echo ""

KEY_CHECK=$(git log --all --oneline -- ssl/key.pem | wc -l)
CERT_CHECK=$(git log --all --oneline -- ssl/cert.pem | wc -l)
DB_CHECK=$(git log --all --oneline -- prisma/studio.db | wc -l)

if [[ $KEY_CHECK -eq 0 ]] && [[ $CERT_CHECK -eq 0 ]] && [[ $DB_CHECK -eq 0 ]]; then
    echo "✅ ssl/key.pem: REMOVED (0 commits found)"
    echo "✅ ssl/cert.pem: REMOVED (0 commits found)"
    echo "✅ prisma/studio.db: REMOVED (0 commits found)"
    echo ""
    echo "🎉 SUCCESS! Repository is now clean."
    echo ""
    echo "📋 Next steps:"
    echo "  1. Regenerate SSL certificates: ./regenerate-ssl-certs.sh"
    echo "  2. Verify .gitignore is working: git status ssl/"
    echo "  3. Run security scan again to confirm"
    echo "  4. Safe to push to GitHub: git push origin main"
else
    echo "⚠️  WARNING: Some files still found in history:"
    [[ $KEY_CHECK -gt 0 ]] && echo "  - ssl/key.pem: $KEY_CHECK commits"
    [[ $CERT_CHECK -gt 0 ]] && echo "  - ssl/cert.pem: $CERT_CHECK commits"
    [[ $DB_CHECK -gt 0 ]] && echo "  - prisma/studio.db: $DB_CHECK commits"
    echo ""
    echo "Consider using the nuclear option (fresh git init)"
fi
