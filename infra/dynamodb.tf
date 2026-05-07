resource "aws_dynamodb_table" "routes" {
  name         = "${var.app_name}-${var.stage}-routes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "routeId"

  attribute {
    name = "routeId"
    type = "S"
  }

  tags = { Name = "${var.app_name}-${var.stage}-routes" }
}
