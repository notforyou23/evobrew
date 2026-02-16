#!/bin/bash
# Phase 3: Git History Rewrite - Preserve Useful History, Purge Sensitive Files
# Date: 2026-02-16
# WARNING: This rewrites Git history. Create backup first!

set -e  # Exit on error

REPO_ROOT="/Users/jtr/_JTR23_/cosmo_ide_v2_dev"
BACKUP_DIR="$HOME/cosmo_ide_backup_$(date +%Y%m%d_%H%M%S)"

cd "$REPO_ROOT"

echo "======================================"
echo "Phase 3: Git History Rewrite"
echo "======================================"
echo ""
echo "⚠️  WARNING: This will rewrite Git history!"
echo ""
echo "Backup will be created at:"
echo "  $BACKUP_DIR"
echo ""
read -p "Continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted by user."
    exit 1
fi

# Step 1: Create offline mirror backup
echo ""
echo "Step 1: Creating offline mirror backup..."
cd "$HOME"
git clone --mirror "$REPO_ROOT/.git" "$BACKUP_DIR"
echo "✅ Backup created at: $BACKUP_DIR"
echo ""

cd "$REPO_ROOT"

# Step 2: Check if git-filter-repo is installed
echo "Step 2: Checking for git-filter-repo..."
if ! command -v git-filter-repo &> /dev/null; then
    echo "❌ git-filter-repo not found!"
    echo ""
    echo "Install with:"
    echo "  brew install git-filter-repo"
    echo ""
    echo "Or with pip:"
    echo "  pip3 install git-filter-repo"
    echo ""
    exit 1
fi
echo "✅ git-filter-repo found"
echo ""

# Step 3: Create paths file for purging
echo "Step 3: Creating paths file for purging..."
cat > /tmp/cosmo_ide_purge_paths.txt <<'EOF'
# Credentials (CRITICAL)
cursor_revisiting_implementation_approa.md
ssl/key.pem
ssl/cert.pem
prisma/studio.db

# Generated/noise (cleanup)
node_modules/
conversations/

# Backup artifacts (obsolete)
server/ai-handler.js.backup
server/server.js.oauth-fixed
public/index-modular.html.INCOMPLETE
REFERENCE-v1.html
EOF

echo "✅ Purge paths file created at /tmp/cosmo_ide_purge_paths.txt"
echo ""
echo "Files to be purged from ALL history:"
cat /tmp/cosmo_ide_purge_paths.txt | grep -v "^#"
echo ""

read -p "Ready to purge these paths from history? (yes/no): " CONFIRM2

if [ "$CONFIRM2" != "yes" ]; then
    echo "Aborted by user."
    exit 1
fi

# Step 4: Run git-filter-repo
echo ""
echo "Step 4: Running git-filter-repo..."
echo ""

git-filter-repo --invert-paths --paths-from-file /tmp/cosmo_ide_purge_paths.txt --force

echo ""
echo "✅ Git history rewritten!"
echo ""

# Step 5: Expire reflog and aggressive GC
echo "Step 5: Cleaning up reflog and running GC..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive
echo "✅ Repository cleaned and optimized"
echo ""

# Step 6: Verify sensitive files are gone
echo "Step 6: Verifying sensitive files removed from history..."

ERRORS=0

if git log --all --oneline -- ssl/key.pem | grep -q .; then
    echo "❌ ssl/key.pem still in history!"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ ssl/key.pem removed from history"
fi

if git log --all --oneline -- prisma/studio.db | grep -q .; then
    echo "❌ prisma/studio.db still in history!"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ prisma/studio.db removed from history"
fi

if git log --all --oneline -- cursor_revisiting_implementation_approa.md | grep -q .; then
    echo "❌ cursor_revisiting_implementation_approa.md still in history!"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ cursor_revisiting_implementation_approa.md removed from history"
fi

echo ""

if [ $ERRORS -eq 0 ]; then
    echo "======================================"
    echo "✅ Phase 3 Complete!"
    echo "======================================"
    echo ""
    echo "Next steps:"
    echo "  1. Regenerate SSL certificates (see Phase 1 checklist)"
    echo "  2. Test: npm install && npm start"
    echo "  3. Proceed to Phase 4 (.gitignore repair)"
    echo ""
    echo "⚠️  IMPORTANT: If you have remote repositories, you'll need to force-push:"
    echo "  git remote add origin <your-repo-url>"
    echo "  git push --force origin main"
    echo ""
    echo "Backup location: $BACKUP_DIR"
else
    echo "======================================"
    echo "❌ Verification failed!"
    echo "======================================"
    echo ""
    echo "Some files are still in history. Manual intervention required."
    echo "Backup is available at: $BACKUP_DIR"
    exit 1
fi
