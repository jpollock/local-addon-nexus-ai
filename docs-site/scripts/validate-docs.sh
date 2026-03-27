#!/bin/bash
#
# Documentation Validation Script
# Checks for common issues in the documentation
#

set -e

cd "$(dirname "$0")/.."

echo "=== Nexus AI Documentation Validation ==="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Check 1: MkDocs build
echo "1. Checking MkDocs build..."
if mkdocs build --strict > /dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} MkDocs build successful"
else
  echo -e "${RED}✗${NC} MkDocs build failed"
  echo "   Run: mkdocs build --strict"
  ((ERRORS++))
fi

# Check 2: Required dependencies
echo ""
echo "2. Checking dependencies..."
if pip show mkdocs mkdocs-material pymdown-extensions > /dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} All dependencies installed"
else
  echo -e "${RED}✗${NC} Missing dependencies"
  echo "   Run: pip install -r requirements.txt"
  ((ERRORS++))
fi

# Check 3: Placeholder pages
echo ""
echo "3. Checking for placeholder pages..."
PLACEHOLDERS=$(find docs -name "*.md" -type f | xargs grep -l "Work in Progress" | wc -l | tr -d ' ')
TOTAL_PAGES=$(find docs -name "*.md" -type f | wc -l | tr -d ' ')
COMPLETE=$((TOTAL_PAGES - PLACEHOLDERS))

echo "   Complete: $COMPLETE pages"
echo "   Placeholders: $PLACEHOLDERS pages"
echo "   Total: $TOTAL_PAGES pages"

if [ "$PLACEHOLDERS" -gt 50 ]; then
  echo -e "${YELLOW}⚠${NC}  Many placeholder pages remaining"
  ((WARNINGS++))
fi

# Check 4: Broken internal links (basic check)
echo ""
echo "4. Checking for potentially broken internal links..."
BROKEN=0
while IFS= read -r file; do
  # Find markdown links
  grep -o '\[.*\](.*\.md)' "$file" 2>/dev/null | grep -o '(.*\.md)' | tr -d '()' | while read -r link; do
    # Convert relative link to absolute path
    dir=$(dirname "$file")
    target="$dir/$link"

    if [ ! -f "$target" ]; then
      echo -e "${RED}✗${NC} Broken link in $file: $link"
      ((BROKEN++))
    fi
  done
done < <(find docs -name "*.md" -type f)

if [ "$BROKEN" -eq 0 ]; then
  echo -e "${GREEN}✓${NC} No broken links found (basic check)"
else
  echo -e "${RED}✗${NC} Found $BROKEN potential broken links"
  ((ERRORS++))
fi

# Check 5: Invalid frontmatter
echo ""
echo "5. Checking frontmatter..."
INVALID=0
while IFS= read -r file; do
  # Check for frontmatter
  if head -1 "$file" | grep -q "^---$"; then
    # Has frontmatter, check for required fields
    if ! grep -q "^title:" "$file"; then
      echo -e "${YELLOW}⚠${NC}  Missing title in $file"
      ((INVALID++))
    fi
  fi
done < <(find docs -name "*.md" -type f)

if [ "$INVALID" -eq 0 ]; then
  echo -e "${GREEN}✓${NC} All pages have proper frontmatter"
else
  echo -e "${YELLOW}⚠${NC}  $INVALID pages missing frontmatter fields"
  ((WARNINGS++))
fi

# Check 6: Code block syntax
echo ""
echo "6. Checking code blocks..."
UNCLOSED=0
while IFS= read -r file; do
  # Count opening and closing backticks
  OPEN=$(grep -c '^```' "$file" 2>/dev/null || echo 0)

  if [ $((OPEN % 2)) -ne 0 ]; then
    echo -e "${RED}✗${NC} Unclosed code block in $file"
    ((UNCLOSED++))
  fi
done < <(find docs -name "*.md" -type f)

if [ "$UNCLOSED" -eq 0 ]; then
  echo -e "${GREEN}✓${NC} All code blocks properly closed"
else
  echo -e "${RED}✗${NC} Found $UNCLOSED unclosed code blocks"
  ((ERRORS++))
fi

# Check 7: Mermaid diagrams
echo ""
echo "7. Checking Mermaid diagrams..."
MERMAID_COUNT=$(find docs -name "*.md" -type f | xargs grep -c '```mermaid' | awk -F: '{sum+=$2} END {print sum}')
echo "   Found $MERMAID_COUNT Mermaid diagrams"

if [ "$MERMAID_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓${NC} Using Mermaid for visualizations"
fi

# Check 8: External links (sample check)
echo ""
echo "8. Checking external links (sample)..."
SAMPLE_LINKS=$(find docs -name "*.md" -type f | head -5 | xargs grep -oh 'https\?://[^)]*' | head -10)

if [ -n "$SAMPLE_LINKS" ]; then
  echo "   Found external links (sample):"
  echo "$SAMPLE_LINKS" | while read -r url; do
    echo "   - $url"
  done
  echo -e "${YELLOW}ℹ${NC}  Manual verification recommended for external links"
fi

# Check 9: Navigation consistency
echo ""
echo "9. Checking navigation structure..."
if [ -f "mkdocs.yml" ]; then
  NAV_PAGES=$(grep -c "\.md" mkdocs.yml || echo 0)
  echo "   Pages in navigation: $NAV_PAGES"

  if [ "$NAV_PAGES" -lt "$COMPLETE" ]; then
    echo -e "${YELLOW}⚠${NC}  Some completed pages may not be in navigation"
    ((WARNINGS++))
  else
    echo -e "${GREEN}✓${NC} Navigation structure looks good"
  fi
fi

# Check 10: File naming
echo ""
echo "10. Checking file naming conventions..."
INVALID_NAMES=0
while IFS= read -r file; do
  basename=$(basename "$file")
  if [[ ! "$basename" =~ ^[a-z0-9-]+\.md$ ]]; then
    echo -e "${YELLOW}⚠${NC}  Non-standard filename: $file"
    ((INVALID_NAMES++))
  fi
done < <(find docs -name "*.md" -type f)

if [ "$INVALID_NAMES" -eq 0 ]; then
  echo -e "${GREEN}✓${NC} All filenames follow conventions"
else
  echo -e "${YELLOW}⚠${NC}  $INVALID_NAMES files have non-standard names"
  ((WARNINGS++))
fi

# Summary
echo ""
echo "=== Validation Summary ==="
echo ""
echo -e "Errors:   ${RED}$ERRORS${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "${GREEN}✓ Documentation validation passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Review locally: mkdocs serve"
  echo "  2. Deploy to GitHub Pages: mkdocs gh-deploy"
  exit 0
elif [ "$ERRORS" -eq 0 ]; then
  echo -e "${YELLOW}⚠ Validation passed with warnings${NC}"
  echo ""
  echo "Fix warnings before deploying"
  exit 0
else
  echo -e "${RED}✗ Validation failed${NC}"
  echo ""
  echo "Fix errors before deploying"
  exit 1
fi
