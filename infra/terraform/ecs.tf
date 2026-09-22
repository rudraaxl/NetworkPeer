resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-ecs"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  cpu                      = tostring(var.api_task_cpu)
  memory                   = tostring(var.api_task_memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn
  # The release workflow may need the captured prior revision after a failed
  # migration or verification, so Terraform must not deregister it on replace.
  skip_destroy = true

  runtime_platform {
    cpu_architecture        = var.ecs_cpu_architecture
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    merge({
      name      = "api"
      image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential = true
      portMappings = [{
        containerPort = var.api_container_port
        hostPort      = var.api_container_port
        protocol      = "tcp"
      }]
      environment = [
        for key, value in local.api_container_environment : {
          name  = key
          value = value
        }
      ]
      secrets = local.runtime_secret_references
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
      }, length(var.api_container_command) > 0 ? {
      command = var.api_container_command
    } : {})
  ])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name_prefix}-worker"
  cpu                      = tostring(var.worker_task_cpu)
  memory                   = tostring(var.worker_task_memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn
  # Keep prior worker revisions available for the rollback path as well.
  skip_destroy = true

  runtime_platform {
    cpu_architecture        = var.ecs_cpu_architecture
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    merge({
      name      = "worker"
      image     = "${aws_ecr_repository.worker.repository_url}:${var.worker_image_tag}"
      essential = true
      environment = [
        for key, value in local.worker_container_environment : {
          name  = key
          value = value
        }
      ]
      secrets = local.runtime_secret_references
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.worker.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
      }, length(var.worker_container_command) > 0 ? {
      command = var.worker_container_command
    } : {})
  ])
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "${local.name_prefix}-migration"
  cpu                      = tostring(var.migrator_task_cpu)
  memory                   = tostring(var.migrator_task_memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.migration_task.arn

  runtime_platform {
    cpu_architecture        = var.ecs_cpu_architecture
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    merge({
      name      = "migration"
      image     = "${aws_ecr_repository.migrator.repository_url}:${var.migrator_image_tag}"
      essential = true
      environment = [
        for key, value in local.migration_container_environment : {
          name  = key
          value = value
        }
      ]
      secrets = local.migration_secret_references
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.migration.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
      }, length(var.migration_container_command) > 0 ? {
      command = var.migration_container_command
    } : {})
  ])
}

resource "aws_ecs_service" "api" {
  name                               = "${local.name_prefix}-api"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.allow_service_activation ? var.api_desired_count : 0
  platform_version                   = "LATEST"
  enable_execute_command             = var.enable_ecs_exec
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  wait_for_steady_state              = false

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }

  network_configuration {
    assign_public_ip = false
    security_groups  = [aws_security_group.ecs_tasks.id]
    subnets          = local.private_app_subnet_ids
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.api_container_port
  }

  depends_on = [
    aws_ecs_cluster_capacity_providers.main,
    # Whichever listener fronts the target group must exist before tasks
    # register behind it. Exactly one of these two is ever created.
    aws_lb_listener.https,
    aws_lb_listener.http_forward,
  ]

  lifecycle {
    precondition {
      condition     = var.api_max_capacity >= var.api_min_capacity
      error_message = "api_max_capacity must be greater than or equal to api_min_capacity."
    }

    precondition {
      condition     = !var.allow_service_activation || can(regex("^[0-9a-f]{40}$", var.api_image_tag))
      error_message = "API activation requires a 40-character lowercase Git commit SHA image tag; generic Terraform must leave allow_service_activation false."
    }

    precondition {
      condition     = !var.allow_service_activation || local.service_activation_endpoint_ready
      error_message = "API activation requires a trusted HTTPS entrypoint: either enable_https_listener=true with an explicit canonical domain_name, or enable_cloudfront=true to use CloudFront's own certificate."
    }

    precondition {
      condition     = !var.allow_service_activation || var.email_provider != "log"
      error_message = "API activation requires a real email_provider. The \"log\" provider delivers nothing, so passwordless login cannot complete."
    }

    precondition {
      condition     = !var.allow_service_activation || var.email_provider != "ses" || var.email_from != null
      error_message = "email_provider=ses requires email_from, and that identity must already be verified in ses_region."
    }
  }
}

resource "aws_ecs_service" "worker" {
  name                               = "${local.name_prefix}-worker"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.worker.arn
  desired_count                      = var.allow_service_activation ? var.worker_desired_count : 0
  platform_version                   = "LATEST"
  enable_execute_command             = var.enable_ecs_exec
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  wait_for_steady_state              = false

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  capacity_provider_strategy {
    capacity_provider = var.ecs_enable_fargate_spot_for_worker ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    assign_public_ip = false
    security_groups  = [aws_security_group.ecs_tasks.id]
    subnets          = local.private_app_subnet_ids
  }

  depends_on = [
    aws_ecs_cluster_capacity_providers.main,
    # Whichever listener fronts the target group must exist before tasks
    # register behind it. Exactly one of these two is ever created.
    aws_lb_listener.https,
    aws_lb_listener.http_forward,
  ]

  lifecycle {
    precondition {
      condition     = var.worker_max_capacity >= var.worker_min_capacity
      error_message = "worker_max_capacity must be greater than or equal to worker_min_capacity."
    }

    precondition {
      condition     = !var.allow_service_activation || can(regex("^[0-9a-f]{40}$", var.worker_image_tag))
      error_message = "Worker activation requires a 40-character lowercase Git commit SHA image tag; generic Terraform must leave allow_service_activation false."
    }

    precondition {
      condition     = !var.allow_service_activation || local.service_activation_endpoint_ready
      error_message = "Worker activation requires a trusted HTTPS entrypoint: either enable_https_listener=true with an explicit canonical domain_name, or enable_cloudfront=true to use CloudFront's own certificate."
    }
  }
}

resource "aws_appautoscaling_target" "api" {
  max_capacity       = var.api_max_capacity
  min_capacity       = var.allow_service_activation ? var.api_min_capacity : 0
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${local.name_prefix}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.api_cpu_target_percent
    scale_in_cooldown  = 60
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "api_memory" {
  name               = "${local.name_prefix}-api-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.api_memory_target_percent
    scale_in_cooldown  = 60
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

resource "aws_appautoscaling_target" "worker" {
  max_capacity       = var.worker_max_capacity
  min_capacity       = var.allow_service_activation ? var.worker_min_capacity : 0
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "worker_cpu" {
  name               = "${local.name_prefix}-worker-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.worker_cpu_target_percent
    scale_in_cooldown  = 60
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
