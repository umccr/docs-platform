# Shortcuts for this repository: the CDK app through pnpm, and the checks through pre-commit. Run `make install` once,
# then `make check` and `make test` before pushing; CI runs the same checks.

PNPM ?= pnpm

.PHONY: install check fix audit-fix test synth clean

# The CDK app's dependencies, and the git hook that runs the pre-commit hooks on each commit, with their environments,
# so a first commit has nothing to download.
install:
	@$(PNPM) install --frozen-lockfile
	@pre-commit install --install-hooks

# Dependency audit, then every pre-commit hook on every tracked file: secrets, the workflows (actionlint, zizmor), and
# the CDK app's lint and formatting.
check:
	@$(PNPM) audit
	@pre-commit run --all-files

fix:
	@$(PNPM) format
	@$(PNPM) lint:fix

# Adds overrides that force patched versions; prefer `pnpm update <package>` when the patch is in range.
audit-fix:
	@$(PNPM) audit --fix

# jest with cdk-nag for the CDK app.
test:
	@$(PNPM) test

synth:
	@$(PNPM) cdk synth --quiet

# Build output, and what previewing the /platform/ site leaves behind; node_modules stays.
clean:
	@rm -rf cdk.out site .umccr-docs
