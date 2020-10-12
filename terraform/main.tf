terraform {
  required_providers {
    aws = {source = "hashicorp/aws", version = "3.10.0"}
    archive = {source = "hashicorp/archive", version = "1.3.0"}
    random = { source = "hashicorp/random", version = "3.0.0" }
  }
}

variable "aws_region" { default = "us-west-2" }

provider "aws" {
  region = var.aws_region
}
provider "archive" {
}

data aws_caller_identity self {}

output "website_url" {
  value = aws_apigatewayv2_stage.http.invoke_url
}
