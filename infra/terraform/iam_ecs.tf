data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

data "aws_iam_policy_document" "ecs_task_execution" {
  statement {
    sid    = "GetEcrAuthorizationToken"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "PullOnlyNetworkPeerImages"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [
      aws_ecr_repository.api.arn,
      aws_ecr_repository.worker.arn,
      aws_ecr_repository.migrator.arn,
    ]
  }

  statement {
    sid    = "WriteContainerLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "${aws_cloudwatch_log_group.api.arn}:*",
      "${aws_cloudwatch_log_group.worker.arn}:*",
      "${aws_cloudwatch_log_group.migration.arn}:*",
    ]
  }

  statement {
    sid    = "InjectOnlyRuntimeSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = [
      aws_secretsmanager_secret.runtime.arn,
      aws_secretsmanager_secret.migration.arn,
    ]
  }

  statement {
    sid       = "DecryptSecretsThroughSecretsManagerOnly"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ecs_task_execution" {
  name   = "${local.name_prefix}-ecs-execution"
  role   = aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.ecs_task_execution.json
}

resource "aws_iam_role" "api_task" {
  name               = "${local.name_prefix}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role" "worker_task" {
  name               = "${local.name_prefix}-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role" "migration_task" {
  name               = "${local.name_prefix}-migration-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

data "aws_iam_policy_document" "evidence_access" {
  statement {
    sid    = "ReadEvidenceBucketControls"
    effect = "Allow"
    actions = [
      "s3:GetEncryptionConfiguration",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketVersioning",
    ]
    resources = [aws_s3_bucket.evidence.arn]
  }

  statement {
    sid    = "ReadWriteEvidenceObjectVersionsAndTags"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:PutObjectTagging",
      "s3:PutObjectVersionTagging",
    ]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]
  }
}

data "aws_iam_policy_document" "api_task" {
  source_policy_documents = [data.aws_iam_policy_document.evidence_access.json]

  statement {
    sid    = "SendOtpEmailThroughSes"
    effect = "Allow"
    actions = [
      "ses:SendEmail",
    ]
    resources = ["*"]

    # Restricts the role to the one verified sender the API is configured with,
    # so a compromised task cannot send as an arbitrary identity.
    dynamic "condition" {
      for_each = var.email_from == null ? [] : [1]

      content {
        test     = "StringEquals"
        variable = "ses:FromAddress"
        values   = [local.ses_from_address]
      }
    }
  }

  statement {
    sid    = "BrokerOnlyNetworkPeerCognitoAuth"
    effect = "Allow"
    actions = [
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminInitiateAuth",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminRespondToAuthChallenge",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminUpdateUserAttributes",
      "cognito-idp:GetTokensFromRefreshToken",
      "cognito-idp:RevokeToken",
    ]
    resources = [aws_cognito_user_pool.main.arn]
  }

  dynamic "statement" {
    for_each = var.enable_ecs_exec ? [1] : []

    content {
      sid    = "EcsExecChannels"
      effect = "Allow"
      actions = [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ]
      resources = ["*"]
    }
  }
}

data "aws_iam_policy_document" "worker_task" {
  source_policy_documents = [data.aws_iam_policy_document.evidence_access.json]

  dynamic "statement" {
    for_each = var.enable_ecs_exec ? [1] : []

    content {
      sid    = "EcsExecChannels"
      effect = "Allow"
      actions = [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ]
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "api_task" {
  name   = "${local.name_prefix}-api-evidence"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task.json
}

resource "aws_iam_role_policy" "worker_task" {
  name   = "${local.name_prefix}-worker-evidence"
  role   = aws_iam_role.worker_task.id
  policy = data.aws_iam_policy_document.worker_task.json
}
