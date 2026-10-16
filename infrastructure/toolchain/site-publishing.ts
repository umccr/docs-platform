import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { dispatchRegistry } from '../sites';
import { DocsDispatcher } from './dispatcher';
import { DocsFetchBuild, fetchBuildSpec } from './fetch-build';
import { DocsSitesPipeline } from './sites-pipeline';

/**
 * Dispatched publishing, in the toolchain account: one organisation webhook, one dispatcher and one shared site
 * pipeline publish every registered site, so adding a site adds no pipeline, project or role.
 *
 *   GitHub push ─▶ dispatcher (Lambda) ─▶ fetch build (CodeBuild) ─▶ source bucket ─▶ UMCCR-DocsSitesPipeline
 *                                                                                      build ─▶ beta ─▶ prod
 *
 * Deployed by the infrastructure pipeline's self-update, from the same registry as the hosting stacks, so a
 * registry change reaches routing, the catalogue and the dispatcher together.
 */
export class DocsSitePublishing extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // One zip per release. Versioned, because CodePipeline's S3 source requires it; 30 days is enough to re-run any
    // recent release from exactly the same files.
    const sourceBucket = new Bucket(this, 'SourceBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          prefix: 'sources/',
          expiration: Duration.days(30),
          noncurrentVersionExpiration: Duration.days(1),
        },
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      // Expiry empties it; deleting the stack must not take release history with it mid-run. A failed first create
      // still removes it, rather than leaving an orphan.
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    const sites = new DocsSitesPipeline(this, 'SitesPipeline', { sourceBucket });

    const connectionArn = StringParameter.valueForStringParameter(this, 'codestar_github_arn');
    const fetch = new DocsFetchBuild(this, 'FetchBuild', {
      sourceBucket,
      pipeline: sites.pipeline,
      connectionArn,
    });

    new DocsDispatcher(this, 'Dispatcher', {
      routes: dispatchRegistry(),
      fetchProject: fetch.project,
      fetchBuildSpec: fetchBuildSpec(),
      connectionArn,
    });
  }
}
