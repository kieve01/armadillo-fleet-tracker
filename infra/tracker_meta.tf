resource "aws_dynamodb_table" "tracker_meta" {
  name         = "${var.app_name}-${var.stage}-tracker-meta"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "trackerName"

  attribute {
    name = "trackerName"
    type = "S"
  }

  tags = { Name = "${var.app_name}-${var.stage}-tracker-meta" }
}
