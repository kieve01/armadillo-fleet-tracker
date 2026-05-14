output "alb_dns_name" {
  description = "ALB DNS name — use as base URL for the API and WebSocket (ws://)"
  value       = aws_lb.main.dns_name
}

output "app_domain" {
  description = "Application domain (prod: tracker.etarmadillo.com, others: dev.tracker.etarmadillo.com)"
  value       = "https://${local.app_domain}"
}

output "ecr_repository_url" {
  description = "ECR repository URL for building and pushing images"
  value       = data.aws_ecr_repository.backend.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.backend.name
}

output "routes_table_name" {
  value = aws_dynamodb_table.routes.name
}

output "tracker_meta_table_name" {
  value = aws_dynamodb_table.tracker_meta.name
}
