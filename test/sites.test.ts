import { describe, expect, test } from '@jest/globals';
import { touchesDocs } from '../app/dispatcher/dispatch';
import { AppStage } from '../infrastructure/stages';
import { catalogueFor } from '../infrastructure/stage/hosting-stack';
import {
  dispatchRegistry,
  DOCS_SITES,
  DocsSite,
  getDocsSites,
  MAX_SLUG_LENGTH,
  validateDocsSites,
} from '../infrastructure/sites';

const site = (overrides: Partial<DocsSite>): DocsSite => ({
  slug: 'example',
  repo: 'umccr/example',
  branch: 'main',
  configPath: 'mkdocs.yml',
  docsPaths: ['docs/**', 'mkdocs.yml'],
  toolkitRef: 'v1.0.0',
  stages: [AppStage.BETA, AppStage.PROD],
  title: 'Example',
  description: 'Example site',
  ...overrides,
});

describe('registry', () => {
  test('is valid', () => {
    expect(() => validateDocsSites(DOCS_SITES)).not.toThrow();
  });

  test.each([
    [AppStage.BETA, ['platform', 'management-knowledgebase']],
    [AppStage.GAMMA, []],
    [AppStage.PROD, ['platform', 'management-knowledgebase']],
  ])('publishes the expected sites to %s', (appStage, slugs) => {
    expect(getDocsSites(appStage).map((entry) => entry.slug)).toEqual(slugs);
  });

  test('publishes the knowledge base from its own repository, on pushes that change the vault', () => {
    const knowledgebase = DOCS_SITES.find((entry) => entry.slug === 'management-knowledgebase');
    expect(knowledgebase).toMatchObject({
      repo: 'umccr/management-knowledgebase',
      branch: 'main',
      docsPaths: ['PlatformServices/**', 'mkdocs.yml'],
    });
  });

  test('builds the platform site from app/site with the toolkit at the pushed commit', () => {
    const platform = DOCS_SITES.find((entry) => entry.slug === 'platform')!;
    expect(platform).toMatchObject({
      repo: 'umccr/docs-platform',
      configPath: 'app/site/mkdocs.yml',
      toolkitRef: 'self',
    });

    // The site's pages, the toolkit and the theme publish it; the team's docs/ folder and the CDK app never do.
    const publishes = (file: string) => touchesDocs([file], platform.docsPaths);
    expect(publishes('app/site/docs/onboarding.md')).toBe(true);
    expect(publishes('app/site/mkdocs.yml')).toBe(true);
    expect(publishes('toolkit/src/umccr_docs/theme/assets/umccr/umccr.css')).toBe(true);
    expect(publishes('docs/design/adr/0008-infrastructure-in-docs-platform.md')).toBe(false);
    expect(publishes('docs/plans/implementation-plan.md')).toBe(false);
    expect(publishes('app/session/index.ts')).toBe(false);
  });
});

describe('validation', () => {
  test.each([
    ['uppercase', 'Example'],
    ['a leading hyphen', '-example'],
    ['a trailing hyphen', 'example-'],
    ['an underscore prefix', '_platform'],
    ['a dot', 'example.site'],
    ['a slash', 'example/site'],
    ['an empty slug', ''],
    ['too many characters', 'a'.repeat(MAX_SLUG_LENGTH + 1)],
  ])('rejects a slug with %s', (_label, slug) => {
    expect(() => validateDocsSites([site({ slug })])).toThrow(/slug/);
  });

  test('accepts the longest allowed slug', () => {
    expect(() => validateDocsSites([site({ slug: 'a'.repeat(MAX_SLUG_LENGTH) })])).not.toThrow();
  });

  test('rejects the reserved slug "sites"', () => {
    expect(() => validateDocsSites([site({ slug: 'sites' })])).toThrow(/reserved/);
  });

  test('rejects a duplicate slug', () => {
    expect(() => validateDocsSites([site({}), site({ repo: 'umccr/other' })])).toThrow(
      /more than once/
    );
  });

  test('rejects two sites on the same repository and branch', () => {
    expect(() =>
      validateDocsSites([site({}), site({ slug: 'other', repo: 'UMCCR/Example' })])
    ).toThrow(/shares/);
    expect(() =>
      validateDocsSites([site({}), site({ slug: 'other', branch: 'docs' })])
    ).not.toThrow();
  });

  test.each(['umccr', 'umccr/', 'https://github.com/umccr/example', 'umccr/example/extra'])(
    'rejects the repo %p',
    (repo) => {
      expect(() => validateDocsSites([site({ repo })])).toThrow(/repo/);
    }
  );

  test.each(['', 'feature branch', '../main', 'main/'])('rejects the branch %p', (branch) => {
    expect(() => validateDocsSites([site({ branch })])).toThrow(/branch/);
  });

  test.each([[[]], [['/docs/**']], [['docs/../secrets/**']], [['docs/**', 'has space']]])(
    'rejects the docs paths %p',
    (docsPaths) => {
      expect(() => validateDocsSites([site({ docsPaths })])).toThrow(/docs paths/);
    }
  );

  test('rejects an absolute config path', () => {
    expect(() => validateDocsSites([site({ configPath: '/mkdocs.yml' })])).toThrow(/config path/);
  });

  test("lets only docs-platform build with its own commit's toolkit", () => {
    expect(() => validateDocsSites([site({ toolkitRef: 'self' })])).toThrow(/self/);
    expect(() =>
      validateDocsSites([site({ repo: 'umccr/docs-platform', toolkitRef: 'self' })])
    ).not.toThrow();
  });

  test.each(['', 'v1 .0', '../v1', 'main', 'feat/docs', 'v1.2', 'a1b2c3d'])(
    'rejects the toolkit ref %p: only a release tag or a full commit pins a build',
    (toolkitRef) => {
      expect(() => validateDocsSites([site({ toolkitRef })])).toThrow(/toolkit ref/);
    }
  );

  test.each(['v1.0.0', 'v2.10.3', 'v2.0.0-rc.1', 'a'.repeat(40)])(
    'accepts the toolkit ref %p',
    (toolkitRef) => {
      expect(() => validateDocsSites([site({ toolkitRef })])).not.toThrow();
    }
  );

  test('rejects a site that publishes nowhere', () => {
    expect(() => validateDocsSites([site({ stages: [] })])).toThrow(/any stage/);
  });

  test('rejects publishing a site to stg', () => {
    expect(() => validateDocsSites([site({ stages: [AppStage.GAMMA] })])).toThrow(/gamma/);
  });
});

describe('dispatch registry', () => {
  test('carries routing fields only, for every site', () => {
    const routes = dispatchRegistry();
    expect(routes.map((route) => route.slug)).toEqual(DOCS_SITES.map((entry) => entry.slug));
    for (const route of routes) {
      expect(Object.keys(route).sort()).toEqual(
        ['branch', 'configPath', 'docsPaths', 'repo', 'slug', 'stages', 'toolkitRef'].sort()
      );
    }
  });

  test('validates the registry first', () => {
    expect(() => dispatchRegistry([site({ slug: 'sites' })])).toThrow(/reserved/);
  });
});

describe('catalogue', () => {
  test('lists titles and paths but not repositories', () => {
    const catalogue = catalogueFor(getDocsSites(AppStage.PROD));
    expect(catalogue.sites.map((entry) => entry.url)).toEqual([
      '/platform/',
      '/management-knowledgebase/',
    ]);
    expect(JSON.stringify(catalogue)).not.toContain('umccr/');
  });
});
