#!/bin/bash
# Phase 2: Working-Tree Cleanup - Automated Execution Script
# Date: 2026-02-16
# Safe to run: Only removes/moves untracked or obsolete files

set -e  # Exit on error

REPO_ROOT="/Users/jtr/_JTR23_/cosmo_ide_v2_dev"
cd "$REPO_ROOT"

echo "======================================"
echo "Phase 2: Working-Tree Cleanup"
echo "======================================"
echo ""

# Step 1: Archive security scan deliverables (keep for reference, don't commit)
echo "Step 1: Archiving security scan deliverables..."

mkdir -p docs/archive/security-scan-2026-02-16

# Move sub-agent deliverables to archive
mv -v CLEANUP_CHECKLIST.md docs/archive/security-scan-2026-02-16/ 2>/dev/null || echo "  (already moved or missing)"
mv -v SECURITY_SCAN_EXECUTIVE_SUMMARY.md docs/archive/security-scan-2026-02-16/ 2>/dev/null || echo "  (already moved or missing)"
mv -v SECURITY_SCAN_REPORT.md docs/archive/security-scan-2026-02-16/ 2>/dev/null || echo "  (already moved or missing)"
mv -v REPOSITORY_INDEX.md docs/archive/security-scan-2026-02-16/ 2>/dev/null || echo "  (already moved or missing)"
mv -v LAUNCH_PREP_SUMMARY.md docs/archive/security-scan-2026-02-16/ 2>/dev/null || echo "  (already moved or missing)"

# Keep DUAL_BRAIN_ARCHITECTURE.md - it's production documentation
echo "  Keeping DUAL_BRAIN_ARCHITECTURE.md (production doc)"

# Sanitize OPENCLAW-INTEGRATION.md token (or just leave it - it's local setup only)
echo "  Keeping OPENCLAW-INTEGRATION.md (local setup guide, token is local-only)"

echo ""

# Step 2: Remove tracked backup/archive files from HEAD
echo "Step 2: Removing obsolete backup files from Git..."

# Check if files exist in Git
if git ls-files --error-unmatch server/ai-handler.js.backup >/dev/null 2>&1; then
    git rm -v server/ai-handler.js.backup
else
    echo "  server/ai-handler.js.backup not tracked (already removed)"
fi

if git ls-files --error-unmatch server/server.js.oauth-fixed >/dev/null 2>&1; then
    git rm -v server/server.js.oauth-fixed
else
    echo "  server/server.js.oauth-fixed not tracked (already removed)"
fi

if git ls-files --error-unmatch public/index-modular.html.INCOMPLETE >/dev/null 2>&1; then
    git rm -v public/index-modular.html.INCOMPLETE
else
    echo "  public/index-modular.html.INCOMPLETE not tracked (already removed)"
fi

if git ls-files --error-unmatch REFERENCE-v1.html >/dev/null 2>&1; then
    git rm -v REFERENCE-v1.html
else
    echo "  REFERENCE-v1.html not tracked (already removed)"
fi

echo ""

# Step 3: De-track generated/sensitive directories
echo "Step 3: De-tracking generated/sensitive directories..."

# node_modules (should already be gitignored, but force remove if tracked)
if git ls-tree HEAD node_modules >/dev/null 2>&1; then
    echo "  Removing node_modules from Git (keeping on disk)..."
    git rm -r --cached node_modules/
else
    echo "  node_modules not tracked (good)"
fi

# conversations (should be gitignored)
if git ls-tree HEAD conversations >/dev/null 2>&1; then
    echo "  Removing conversations from Git (keeping on disk)..."
    git rm -r --cached conversations/
else
    echo "  conversations not tracked (good)"
fi

# ssl directory (will be regenerated after history rewrite)
if git ls-tree HEAD ssl >/dev/null 2>&1; then
    echo "  Removing ssl from Git (keeping on disk)..."
    git rm -r --cached ssl/
else
    echo "  ssl not tracked (good)"
fi

# prisma/studio.db
if git ls-files --error-unmatch prisma/studio.db >/dev/null 2>&1; then
    echo "  Removing prisma/studio.db from Git (keeping on disk)..."
    git rm --cached prisma/studio.db
else
    echo "  prisma/studio.db not tracked (good)"
fi

echo ""

# Step 4: Remove .DS_Store files
echo "Step 4: Removing .DS_Store files..."
find . -name ".DS_Store" -type f -delete
echo "  All .DS_Store files removed"

echo ""

# Step 5: Remove .claude/ directory if exists
echo "Step 5: Removing .claude/ directory..."
if [ -d ".claude" ]; then
    rm -rf .claude/
    echo "  .claude/ directory removed"
else
    echo "  .claude/ directory not found (already removed)"
fi

echo ""
echo "======================================"
echo "Phase 2 Complete!"
echo "======================================"
echo ""
echo "Changes made (pending commit):"
git status --short
echo ""
echo "Next steps:"
echo "  1. Review changes: git status"
echo "  2. Commit cleanup: git commit -m 'chore: remove obsolete backup files and de-track sensitive directories'"
echo "  3. Proceed to Phase 3 (Git history rewrite)"
echo ""
echo "Note: This commit will be rewritten in Phase 3, so the removed files will be purged from ALL history."
