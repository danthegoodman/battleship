resource "aws_apigatewayv2_api" "http" {
  name = "battleship-http"
  protocol_type = "HTTP"
  cors_configuration {
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = ["*"]
    max_age = 3600
    # one hour
  }
}

resource "aws_apigatewayv2_route" "http-def" {
  api_id = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target = "integrations/${aws_apigatewayv2_integration.http.id}"
}

resource "aws_apigatewayv2_integration" "http" {
  api_id = aws_apigatewayv2_api.http.id
  integration_type = "AWS_PROXY"
  integration_method = "POST"
  integration_uri = "arn:aws:apigateway:${var.aws_region}:lambda:path/2015-03-31/functions/${aws_lambda_function.lambda.arn}/invocations"
}

resource "aws_apigatewayv2_deployment" http {
  api_id = aws_apigatewayv2_api.http.id

  triggers = {
    # Update to trigger deployment
    redeployment = sha1(join(",", list(
    jsonencode(aws_apigatewayv2_integration.http),
    jsonencode(aws_apigatewayv2_route.http-def),
    )))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_stage" http {
  api_id = aws_apigatewayv2_api.http.id
  name = "production"
  deployment_id = aws_apigatewayv2_deployment.http.id
  default_route_settings {
    data_trace_enabled = false
    throttling_burst_limit = 5000
    throttling_rate_limit = 10000
  }
}
