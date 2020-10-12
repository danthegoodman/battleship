data "archive_file" lambda {
  type = "zip"
  output_path = "${path.module}/.terraform/files/lambda.zip"

  source {
    filename = "lambda.js"
    content = file("${path.module}/../lambda/lambda.js")
  }
  source {
    filename = "client/index.html"
    content = file("${path.module}/../client/index.html")
  }
  source {
    filename = "client/client.js"
    content = file("${path.module}/../client/client.js")
  }
}

resource "aws_lambda_function" lambda {
  function_name = "battleship"
  handler = "lambda.handler"
  role = aws_iam_role.lambda.arn

  runtime = "nodejs12.x"
  memory_size = 128
  timeout = 45

  filename = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  environment {
    variables = {
      APIG_ID_WS: aws_apigatewayv2_api.ws.id,
      APIG_ID_HTTP: aws_apigatewayv2_api.http.id,
      DB_ARN: aws_rds_cluster.pg.arn,
      DB_SECRET: aws_secretsmanager_secret.pg.arn,
    }
  }
}

resource "aws_lambda_permission" lambda {
  function_name = aws_lambda_function.lambda.arn
  principal = "apigateway.amazonaws.com"
  action = "lambda:InvokeFunction"
  source_arn = "arn:aws:execute-api:${var.aws_region}:${data.aws_caller_identity.self.account_id}:*"
}
