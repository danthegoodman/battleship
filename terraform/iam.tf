resource "aws_iam_role" "lambda" {
  name_prefix = "lambda-battleship"
  assume_role_policy = data.aws_iam_policy_document.lambda-assume.json
}

data "aws_iam_policy_document" "lambda-assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type="Service"
      identifiers=["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "lambda" {
  name = "policy"
  role = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

data "aws_iam_policy_document" "lambda" {
  statement {
    actions = ["*"]
    resources = ["*"]
  }
}
