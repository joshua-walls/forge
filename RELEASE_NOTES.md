This release prepares Forge for submission to the Obsidian community plugin directory.

# What's new

## MIT License

Added a LICENSE file to the repository. Required for community plugin submission.

## Removed `builtin-modules` dependency

Replaced the `builtin-modules` npm package with Node.js's native `builtinModules` from the `module` package. Reduces dependency surface and resolves the community plugin validator warning.

## Updated plugin description

Revised the manifest description to comply with community plugin directory guidelines, which prohibit use of the word "Obsidian" in the description field.