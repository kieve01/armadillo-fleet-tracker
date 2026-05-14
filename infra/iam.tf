resource "aws_iam_role" "ecs_execution" {
  name = "${var.app_name}-${var.stage}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.app_name}-${var.stage}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "${var.app_name}-${var.stage}-ecs-task-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "geo:ListGeofences",
          "geo:GetGeofence",
          "geo:PutGeofence",
          "geo:BatchDeleteGeofence",
        ]
        Resource = "arn:aws:geo:${var.region}:${data.aws_caller_identity.current.account_id}:geofence-collection/${var.geofence_collection}"
      },
      {
        Effect = "Allow"
        Action = [
          "geo:ListTrackers",
          "geo:CreateTracker",
          "geo:DeleteTracker",
          "geo:BatchUpdateDevicePosition",
          "geo:BatchDeleteDevicePositionHistory",
          "geo:GetDevicePosition",
          "geo:ListDevicePositions",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = [
          "geo-routes:CalculateRoutes",
          "geo-routes:SnapToRoads",
          "geo-routes:OptimizeWaypoints",
          "geo-routes:CalculateIsolines",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = [
          "geo-places:Autocomplete",
          "geo-places:Geocode",
          "geo-places:ReverseGeocode",
          "geo-places:GetPlace",
          "geo-places:SearchNearby",
          "geo-places:SearchText",
          "geo-places:Suggest",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["geo:CalculateRoute"]
        Resource = "arn:aws:geo:${var.region}:${data.aws_caller_identity.current.account_id}:route-calculator/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
        ]
        Resource = aws_dynamodb_table.routes.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
        ]
        Resource = aws_dynamodb_table.tracker_meta.arn
      },
    ]
  })
}
