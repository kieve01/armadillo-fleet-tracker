variable "region" {
  type    = string
  default = "sa-east-1"
}

variable "stage" {
  type    = string
  default = "dev"
}

variable "app_name" {
  type    = string
  default = "armadillo-tracker"
}

variable "geofence_collection" {
  type    = string
  default = "armadillo-geofences"
}

variable "route_calculator" {
  type    = string
  default = "armadillo-route-calculator"
}

variable "place_index" {
  type    = string
  default = "armadillo-places"
}

variable "container_image" {
  type        = string
  description = "Full ECR image URI (e.g. 123456789012.dkr.ecr.sa-east-1.amazonaws.com/armadillo-tracker-backend:latest)"
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}
