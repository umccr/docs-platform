# Shortcuts for this repository: the CDK app through pnpm, and the Python toolkit in a virtualenv (.venv).
# Run `make install` once, then `make check` and `make test` before pushing; CI runs the same checks.

PNPM ?= pnpm
PYTHON ?= python3.12
VENV ?= .venv

BIN := $(VENV)/bin

# Recipes call the virtualenv's tools by path: make 3.81, as macOS ships it, runs a simple command without a shell and
# looks it up on its own PATH, ignoring this one. The export still reaches child processes, so pre-commit's hooks find
# ruff and the toolkit.
export PATH := $(abspath $(BIN)):$(PATH)

SITE_CONFIGS := examples/basic-site/mkdocs.yml examples/obsidian-vault/mkdocs.yml app/site/mkdocs.yml

.PHONY: install check fix audit-fix test sites serve synth clean

# The CDK app's dependencies, and a virtualenv with the hash-pinned engine, the dev tools and the toolkit.
install:
	@$(PNPM) install --frozen-lockfile
	@test -x $(BIN)/python || $(PYTHON) -m venv $(VENV)
	@$(BIN)/pip install --quiet --require-hashes --no-deps -r requirements/build.txt
	@$(BIN)/pip install --quiet --require-hashes -r requirements/dev.txt
	@$(BIN)/pip install --quiet --no-deps -e ./toolkit

# Dependency audit, formatting, lint, the workflows, then the pre-commit hooks (secrets, the information boundary).
check:
	@$(PNPM) audit
	@$(PNPM) format:check
	@$(PNPM) lint
	@$(BIN)/ruff check toolkit
	@$(BIN)/ruff format --check toolkit
	@$(BIN)/actionlint
	@$(BIN)/zizmor --no-progress .github/workflows
	@pre-commit run --all-files

fix:
	@$(PNPM) format
	@$(PNPM) lint:fix
	@$(BIN)/ruff check --fix toolkit
	@$(BIN)/ruff format toolkit

# Adds overrides that force patched versions; prefer `pnpm update <package>` when the patch is in range.
audit-fix:
	@$(PNPM) audit --fix

# jest with cdk-nag for the CDK app; pytest for the toolkit, including strict builds of the examples.
test:
	@$(PNPM) test
	@$(BIN)/pytest toolkit

# Strict builds and pre-publish checks of the examples and the /platform/ site, as CI runs them.
sites:
	@for config in $(SITE_CONFIGS); do \
	  site="build/sites/$$(dirname "$$config" | tr '/' '-')"; \
	  $(BIN)/umccr-docs check --config "$$config" && \
	  $(BIN)/umccr-docs build --config "$$config" --site-dir "$$site" && \
	  $(BIN)/umccr-docs verify-site "$$site" || exit 1; \
	done

# Preview the /platform/ site on http://127.0.0.1:8000.
serve:
	@$(BIN)/umccr-docs serve --config app/site/mkdocs.yml

synth:
	@$(PNPM) cdk synth --quiet

# Build output only; the virtualenv and node_modules stay.
clean:
	@rm -rf cdk.out build .umccr-docs app/site/.umccr-docs examples/*/.umccr-docs
