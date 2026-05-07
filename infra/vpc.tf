data "aws_vpc" "main" {
  tags = {
    Name = "armadillo-${var.stage}-vpc"
  }
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }

  filter {
    name   = "tag:Name"
    values = ["armadillo-${var.stage}-subnet-public*"]
  }
}
