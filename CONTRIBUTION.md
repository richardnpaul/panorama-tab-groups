# How to contribute

**Table of content**

- [In General](#in-general)
- [Development Setup](#development-setup)
- [Translations](#translations)

## In General

If you've never contributed to a project before, [this guide](https://github.com/firstcontributions/first-contributions/blob/master/README.md) is a good place to start. It's also available in multiple languages.

## Development Setup

This project uses [pre-commit](https://pre-commit.com/) hooks to ensure code quality and consistency. The hooks run automatically before each commit and include:

- Code formatting with [Prettier](https://prettier.io/)
- Linting with [ESLint](https://eslint.org/)
- File validation checks (JSON, YAML, merge conflicts, etc.)

### Prerequisites

- **Node.js** >= 16.0.0 and **npm** (for project dependencies)
- **Python** 3.x (for pre-commit framework)
- **pre-commit** tool

### Installing pre-commit

**Option 1: Using pip (Python package manager)**

```bash
pip install pre-commit
```

**Option 2: Using Homebrew (macOS/Linux)**

```bash
brew install pre-commit
```

**Option 3: Using system package manager**

- Ubuntu/Debian: `sudo apt install pre-commit`
- Fedora: `sudo dnf install pre-commit`

### Setting up the project

1. Clone the repository and install Node.js dependencies:

   ```bash
   git clone https://github.com/richardnpaul/panorama-tab-groups.git
   cd panorama-tab-groups
   npm install
   ```

2. Install the pre-commit hooks:

   ```bash
   pre-commit install
   ```

3. (Optional) Run pre-commit on all files to check everything is working:
   ```bash
   pre-commit run --all-files
   ```

### Using pre-commit

Once installed, pre-commit hooks run automatically when you commit. If a hook fails, the commit is aborted and you'll see what needs to be fixed.

**Manual formatting and linting:**

```bash
# Format all files with Prettier and ESLint
npm run format

# Check formatting without modifying files
npm run lint

# Run pre-commit checks manually
pre-commit run --all-files
```

**Updating hook versions:**

```bash
# Update hooks to their latest versions
pre-commit autoupdate
```

**Skipping hooks (use sparingly):**

```bash
# Skip pre-commit hooks for a single commit
git commit --no-verify -m "your message"

# Skip a specific hook
SKIP=eslint git commit -m "your message"
```

## Translations

The translations are located in `/src/_locales/`. Beneath this directory each language is split into its own directory. In the language directory the translations are structured in the `messages.json` file.

For deeper insight it's recommended to read the [Internationalization guide for web extensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization).

### Update translation

1. Open the messages.json file for the target language.
1. Alter the `message` text for the translation to update.

### Add language

1. Create a directory with the short language code. Allowed are identifiers like `de_DE` or `de`, where the latter is the fallback.
1. Copy the `messages.json` file from the directory `en` in the new directory.
1. Replace all `message`s.
1. For `pluralRule` please see [this definition](https://developer.mozilla.org/en-US/docs/Mozilla/Localization/Localization_and_Plurals#List_of_Plural_Rules). Current implemented rules are 0, 1, 2, 7 and 9 within [the utility function `getPluralForm()`](src/js/_share/utils.js);
