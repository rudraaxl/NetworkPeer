data "archive_file" "cognito_custom_auth" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/cognito_custom_auth"
  output_path = "${path.module}/.terraform/cognito_custom_auth.zip"
}

data "aws_iam_policy_document" "cognito_custom_auth_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "cognito_custom_auth" {
  name               = "${local.name_prefix}-cognito-custom-auth"
  assume_role_policy = data.aws_iam_policy_document.cognito_custom_auth_assume_role.json
}

resource "aws_cloudwatch_log_group" "cognito_custom_auth" {
  name              = "/aws/lambda/${local.name_prefix}-cognito-custom-auth"
  retention_in_days = var.ecs_log_retention_days
}

data "aws_iam_policy_document" "cognito_custom_auth" {
  statement {
    sid    = "WriteCognitoAuthLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.cognito_custom_auth.arn}:*"]
  }

  statement {
    sid       = "PublishTransactionalOtpSms"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "cognito_custom_auth" {
  name   = "${local.name_prefix}-cognito-custom-auth"
  role   = aws_iam_role.cognito_custom_auth.id
  policy = data.aws_iam_policy_document.cognito_custom_auth.json
}

resource "aws_lambda_function" "cognito_custom_auth" {
  function_name    = "${local.name_prefix}-cognito-custom-auth"
  description      = "Creates, delivers, and verifies NetworkPeer Cognito Custom Auth OTP challenges."
  filename         = data.archive_file.cognito_custom_auth.output_path
  source_code_hash = data.archive_file.cognito_custom_auth.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  role             = aws_iam_role.cognito_custom_auth.arn
  memory_size      = 128
  timeout          = 10

  environment {
    variables = {
      OTP_LENGTH                 = "6"
      OTP_MAX_ATTEMPTS           = tostring(var.cognito_max_attempts)
      OTP_MESSAGE_TEMPLATE       = var.cognito_sms_message_template
      OTP_TTL_MINUTES            = tostring(var.cognito_challenge_ttl_minutes)
      OTP_SNS_ORIGINATION_NUMBER = var.cognito_sms_origination_number == null ? "" : var.cognito_sms_origination_number
      OTP_SNS_SENDER_ID          = var.cognito_sms_sender_id == null ? "" : var.cognito_sms_sender_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.cognito_custom_auth]
}

resource "aws_lambda_permission" "cognito_custom_auth" {
  statement_id   = "AllowCognitoUserPoolInvocation"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.cognito_custom_auth.function_name
  principal      = "cognito-idp.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_cognito_user_pool" "main" {
  name                = "${local.name_prefix}-users"
  mfa_configuration   = "OFF"
  deletion_protection = "INACTIVE"
  username_configuration {
    case_sensitive = false
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 32
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 1
  }

  lambda_config {
    create_auth_challenge          = aws_lambda_function.cognito_custom_auth.arn
    define_auth_challenge          = aws_lambda_function.cognito_custom_auth.arn
    verify_auth_challenge_response = aws_lambda_function.cognito_custom_auth.arn
  }

  depends_on = [aws_lambda_permission.cognito_custom_auth]
}

resource "aws_cognito_user_pool_client" "api" {
  name                          = "${local.name_prefix}-api"
  user_pool_id                  = aws_cognito_user_pool.main.id
  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  auth_session_validity         = var.cognito_challenge_ttl_minutes
  access_token_validity         = 15
  id_token_validity             = 15
  refresh_token_validity        = var.cognito_refresh_token_validity_days
  explicit_auth_flows           = ["ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "roles" {
  for_each = toset(["CLIENT", "WORKER", "ADMIN"])

  name         = each.value
  user_pool_id = aws_cognito_user_pool.main.id
  precedence   = index(["CLIENT", "WORKER", "ADMIN"], each.value) + 1
}
