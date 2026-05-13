resource "aws_ecs_cluster" "main" {
  name = "${var.app_name}-${var.stage}"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = { Name = "${var.app_name}-${var.stage}" }
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.app_name}-${var.stage}/backend"
  retention_in_days = 14
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.app_name}-${var.stage}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "backend"
    image     = var.container_image
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }

    environment = [
      { name = "PORT",                value = "3000" },
      { name = "AWS_REGION",          value = var.region },
      { name = "ROUTES_TABLE",        value = aws_dynamodb_table.routes.name },
      { name = "GEOFENCE_COLLECTION", value = var.geofence_collection },
      { name = "ROUTE_CALCULATOR",    value = var.route_calculator },
      { name = "PLACE_INDEX",         value = var.place_index },
      { name = "GOOGLE_MAPS_API_KEY", value = var.google_maps_api_key },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.backend.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "backend"
      }
    }
  }])
}

resource "aws_ecs_service" "backend" {
  name            = "${var.app_name}-${var.stage}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.public.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.https, aws_iam_role_policy_attachment.ecs_execution]

  # Allow external CI/CD to update the task definition without Terraform reverting it
  lifecycle {
    ignore_changes = [task_definition]
  }
}
