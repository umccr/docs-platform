"""
AWS access for the site pipeline's publish steps.

The publish steps run in the toolchain account and assume one role per stage, `docs/docs-publisher`, which can write
every site. Each run narrows it with a session policy to its own site: `sites/<slug>/` in the docs bucket and
`docs/<slug>/` in OrcaSonar's ingest bucket. A bug or a malicious build can therefore reach no other site, even
though the role could.

Bucket names are never configured: the publish step reads them from SSM in the stage account after assuming the role.
"""

import json
from typing import Any

from umccr_docs.errors import DocsError
from umccr_docs.slug import validate_slug

DOCS_CONTENT_BUCKET_PARAMETER = "/docs/content-bucket-name"
ORCASONAR_INGEST_BUCKET_PARAMETER = "/orcasonar/ingest-bucket-name"

# Session names show up in CloudTrail; the slug says which site a write was for.
_SESSION_NAME_LIMIT = 64


def session_policy(slug: str, partition: str = "aws") -> dict[str, Any]:
    """The most a publish of `slug` may do with the role, whatever the role itself allows."""
    validate_slug(slug)
    prefixes = [f"sites/{slug}/", f"docs/{slug}/"]
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "s3:ListBucket",
                "Resource": "*",
                "Condition": {"StringLike": {"s3:prefix": [f"{prefix}*" for prefix in prefixes]}},
            },
            {
                "Effect": "Allow",
                "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
                "Resource": [f"arn:{partition}:s3:::*/{prefix}*" for prefix in prefixes],
            },
            {
                "Effect": "Allow",
                "Action": "ssm:GetParameter",
                "Resource": "*",
            },
            {
                # OrcaSonar's bucket encrypts with its own key, and its key policy names docs-publisher.
                "Effect": "Allow",
                "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
                "Resource": "*",
                "Condition": {"StringLike": {"kms:ViaService": "s3.*.amazonaws.com"}},
            },
        ],
    }


def publisher_session(role_arn: str, slug: str, *, sts: Any = None) -> Any:
    """A boto3 session as `role_arn`, narrowed to `slug`."""
    import boto3

    partition = role_arn.split(":")[1] if role_arn.count(":") >= 5 else ""
    if not role_arn.startswith("arn:") or not partition:
        raise DocsError(f"'{role_arn}' is not a role ARN")
    sts = sts or boto3.client("sts")
    response = sts.assume_role(
        RoleArn=role_arn,
        RoleSessionName=f"docs-publish-{slug}"[:_SESSION_NAME_LIMIT],
        Policy=json.dumps(session_policy(slug, partition)),
        DurationSeconds=3600,
    )
    credentials = response["Credentials"]
    return boto3.Session(
        aws_access_key_id=credentials["AccessKeyId"],
        aws_secret_access_key=credentials["SecretAccessKey"],
        aws_session_token=credentials["SessionToken"],
    )


def parameter(ssm: Any, name: str) -> str | None:
    """An SSM parameter's value, or None when it does not exist."""
    try:
        return ssm.get_parameter(Name=name)["Parameter"]["Value"]
    except Exception as error:  # botocore's ClientError, without importing botocore at module level
        code = getattr(error, "response", {}).get("Error", {}).get("Code")
        if code == "ParameterNotFound":
            return None
        raise
