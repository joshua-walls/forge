#!/usr/bin/env zsh

set -e

# =========================================
# Config
# =========================================
VERSION="0.9.2"

PLUGIN_ID="forge"

# =========================================
# Verify dependencies
# =========================================
for cmd in git jq zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd"
  fi
done

# =========================================
# Update package.json
# =========================================
TMP=$(mktemp)

jq --arg v "$VERSION" \
  '.version = $v' \
  package.json > "$TMP"

mv "$TMP" package.json

echo "Updated package.json -> $VERSION"

# =========================================
# Update manifest.json
# =========================================
TMP=$(mktemp)

jq --arg v "$VERSION" \
  '.version = $v' \
  manifest.json > "$TMP"

mv "$TMP" manifest.json

echo "Updated manifest.json -> $VERSION"

# =========================================
# Update versions.json
# =========================================
MIN_APP_VERSION=$(jq -r '.minAppVersion' manifest.json)

if jq -e --arg v "$VERSION" 'has($v)' versions.json > /dev/null 2>&1; then
  echo "versions.json already has $VERSION — skipping."
else
  TMP=$(mktemp)
  jq --arg v "$VERSION" \
     --arg min "$MIN_APP_VERSION" \
     '. + {($v): $min}' \
     versions.json > "$TMP"
  mv "$TMP" versions.json
  echo "Updated versions.json -> $VERSION"
fi

# =========================================
# Install + Build
# =========================================
echo "Running npm install..."
if ! npm install; then
  echo "npm install failed — aborting."
  exit 1
fi
echo "npm install complete."

echo ""
echo "Running build..."
if ! npm run build; then
  echo "Build failed — aborting."
  exit 1
fi
echo "Build complete."
echo ""

# =========================================
# Clean + Build package
# =========================================
rm -rf dist
mkdir -p dist

cp manifest.json dist/
cp main.js dist/

[[ -f styles.css ]] && cp styles.css dist/

ZIP_NAME="${PLUGIN_ID}-${VERSION}.zip"

rm -f "$ZIP_NAME"

cd dist
zip -r "${ZIP_NAME}" .
cd ..

echo ""
echo "Done."
echo "Created: ${ZIP_NAME}"

# =========================================
# Git Branch
# =========================================
BRANCH_NAME="v${VERSION}"

CURRENT_BRANCH=$(git branch --show-current)

echo ""
echo "Current branch: $CURRENT_BRANCH"

git checkout -B "$BRANCH_NAME"

echo "Created git branch: $BRANCH_NAME"

# =========================================
# Commit + Push
# =========================================
git add .

if git diff --cached --quiet; then
  echo "Nothing new to commit — skipping."
else
  git commit -m "release: v${VERSION}"
fi

git push -u origin "$BRANCH_NAME"
echo ""
echo "Pushed branch: $BRANCH_NAME"
echo "Release complete 🚀"

# =========================================
# GitHub Draft Release
# =========================================
echo "Creating draft release..."
if ! gh release create "v${VERSION}" \
  dist/* \
  --title "Forge v${VERSION}" \
  --draft \
  --notes-file RELEASE_NOTES.md; then
  echo "Draft release failed — aborting."
  exit 1
fi

echo "Draft release created: Forge v${VERSION}"
echo ""
echo "Pushed branch: $BRANCH_NAME"
echo "Release complete 🚀"