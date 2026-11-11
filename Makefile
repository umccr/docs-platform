# Shortcuts for this repository: the CDK app through pnpm, and in a virtualenv (.venv) the repository's tools and the
# toolkit, at the release the sites build with, for the /platform/ site. Run `make install` once, then `make check` and
# `make test` before pushing; CI runs the same checks.

PNPM ?= pnpm
PYTHON ?= python3.12
VENV ?= .venv

# Recipes call the virtualenv's tools by path, so it need not be active.
BIN := $(VENV)/bin

# The toolkit the sites build with, DOCS_TOOLKIT_REF, from its line in the registry. `make toolkit TOOLKIT_REF=<ref>`
# installs another release tag or full commit of umccr/docs-toolkit.
TOOLKIT_REF ?= $(shell sed -n "s/^export const DOCS_TOOLKIT_REF = '\([^']*\)';$$/\1/p" infrastructure/sites.ts)

.PHONY: install toolkit check fix audit-fix test sites serve synth clean

# The CDK app's dependencies; a virtualenv with the dev tools and the toolkit; and the git hook that runs the pre-commit
# hooks on each commit, with their environments, so a first commit has nothing to download.
install:
	@$(PNPM) install --frozen-lockfile
	@test -x $(BIN)/python || $(PYTHON) -m venv $(VENV)
	@$(BIN)/pip install --quiet --require-hashes -r requirements/dev.txt
	@$(MAKE) --no-print-directory toolkit
	@pre-commit install --install-hooks

# The toolkit at TOOLKIT_REF, as the site pipeline installs it: the engine with hashes from that ref's
# requirements/build.txt, then the package itself. --force-reinstall replaces an install of the same version from
# another commit, which pip would otherwise keep; with --no-deps it reinstalls nothing else.
toolkit:
	@test -n "$(TOOLKIT_REF)" || { echo "No toolkit ref: see DOCS_TOOLKIT_REF in infrastructure/sites.ts" >&2; exit 1; }
	@$(BIN)/pip install --quiet --require-hashes --no-deps \
	  -r https://raw.githubusercontent.com/umccr/docs-toolkit/$(TOOLKIT_REF)/requirements/build.txt
	@$(BIN)/pip install --quiet --no-deps --force-reinstall "git+https://github.com/umccr/docs-toolkit.git@$(TOOLKIT_REF)"
	@echo "$$($(BIN)/umccr-docs --version), from umccr/docs-toolkit at $(TOOLKIT_REF)"

# Dependency audit, formatting, lint, the workflows, then the pre-commit hooks (secrets, the information boundary).
check:
	@$(PNPM) audit
	@$(PNPM) format:check
	@$(PNPM) lint
	@$(BIN)/actionlint
	@$(BIN)/zizmor --no-progress .github/workflows
	@pre-commit run --all-files

fix:
	@$(PNPM) format
	@$(PNPM) lint:fix

# Adds overrides that force patched versions; prefer `pnpm update <package>` when the patch is in range.
audit-fix:
	@$(PNPM) audit --fix

# jest with cdk-nag for the CDK app. The toolkit's tests run in umccr/docs-toolkit.
test:
	@$(PNPM) test

# The strict build and pre-publish checks of the /platform/ site, as CI runs them, into build/sites/platform.
sites:
	@$(BIN)/umccr-docs check --config mkdocs.yml
	@$(BIN)/umccr-docs build --config mkdocs.yml --site-dir build/sites/platform
	@$(BIN)/umccr-docs verify-site build/sites/platform

# Preview the /platform/ site on http://127.0.0.1:8000.
serve:
	@$(BIN)/umccr-docs serve --config mkdocs.yml

synth:
	@$(PNPM) cdk synth --quiet

# Build output only; the virtualenv and node_modules stay.
clean:
	@rm -rf cdk.out build .umccr-docs
