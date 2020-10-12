resource "aws_apigatewayv2_api" "ws" {
  name = "battleship-ws"
  protocol_type = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_route" "ws-conn" {
  api_id = aws_apigatewayv2_api.ws.id
  route_key = "$connect"
  target = "integrations/${aws_apigatewayv2_integration.ws.id}"
}
resource "aws_apigatewayv2_route" "ws-def" {
  api_id = aws_apigatewayv2_api.ws.id
  route_key = "$default"
  target = "integrations/${aws_apigatewayv2_integration.ws.id}"
}
resource "aws_apigatewayv2_route" "ws-disconn" {
  api_id = aws_apigatewayv2_api.ws.id
  route_key = "$disconnect"
  target = "integrations/${aws_apigatewayv2_integration.ws.id}"
}

resource "aws_apigatewayv2_integration" "ws" {
  api_id = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  content_handling_strategy = "CONVERT_TO_TEXT"
  integration_method = "POST"
  integration_uri = "arn:aws:apigateway:${var.aws_region}:lambda:path/2015-03-31/functions/${aws_lambda_function.lambda.arn}/invocations"
}

resource "aws_apigatewayv2_deployment" ws {
  api_id = aws_apigatewayv2_api.ws.id

  triggers = {
    redeployment = sha1(join(",", list(
    jsonencode(aws_apigatewayv2_integration.ws),
    jsonencode(aws_apigatewayv2_route.ws-conn),
    jsonencode(aws_apigatewayv2_route.ws-disconn),
    jsonencode(aws_apigatewayv2_route.ws-def),
    )))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_stage" ws {
  api_id = aws_apigatewayv2_api.ws.id
  name = "production"
  deployment_id = aws_apigatewayv2_deployment.ws.id
  default_route_settings {
    data_trace_enabled = false
    throttling_burst_limit = 5000
    throttling_rate_limit = 10000
  }
}
