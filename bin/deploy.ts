#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TOOLCHAIN_ENVIRONMENT } from '../infrastructure/stages';
import { DocsInfrastructureDeploymentStack } from '../infrastructure/toolchain/infrastructure-pipeline';

const app = new cdk.App();

// ---------------------------------------------------------------------------
// docs.umccr.org: authenticated documentation at docs.<stage>.umccr.org
//
// One toolchain stack. Its self-mutating pipeline deploys DocsHostingStack to beta and prod; hosting is
// registry-driven by infrastructure/sites.ts.
// ---------------------------------------------------------------------------

new DocsInfrastructureDeploymentStack(app, 'DocsInfrastructurePipeline', {
  env: TOOLCHAIN_ENVIRONMENT,
  tags: {
    'umccr-org:Stack': 'DocsInfrastructurePipeline',
    'umccr-org:Product': 'Docs',
  },
});
