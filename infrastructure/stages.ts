import type { Environment } from 'aws-cdk-lib';
// The package's environments only: its pipeline construct is replaced by ./toolchain/deployment-pipeline.ts.
import {
  BETA_ENVIRONMENT,
  GAMMA_ENVIRONMENT,
  PROD_ENVIRONMENT,
  TOOLCHAIN_ENVIRONMENT,
} from '@orcabus/platform-cdk-constructs/deployment-stack-pipeline/config';

/**
 * Deployment stages of docs.umccr.org: beta in the dev account, gamma in stg, prod in prod.
 *
 * The values are lower case because they appear in deployed resource properties, such as the distribution's comment;
 * changing them would update every stage's distribution.
 */
export enum AppStage {
  BETA = 'beta',
  GAMMA = 'gamma',
  PROD = 'prod',
}

/**
 * Account and region of each stage, and of the toolchain account that runs the pipelines.
 *
 * This repository is public, so account IDs are never written here: they come from `@orcabus/platform-cdk-constructs`,
 * the package that holds UMCCR's account list for every OrcaBus pipeline too.
 */
export const STAGE_ENVIRONMENT: Record<AppStage, Environment> = {
  [AppStage.BETA]: BETA_ENVIRONMENT,
  [AppStage.GAMMA]: GAMMA_ENVIRONMENT,
  [AppStage.PROD]: PROD_ENVIRONMENT,
};

export { TOOLCHAIN_ENVIRONMENT };
