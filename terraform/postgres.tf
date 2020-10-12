resource random_password pg {
  length = 20
  special = false
}

resource "aws_rds_cluster" "pg" {
  cluster_identifier = "battleship"
  engine ="aurora-postgresql"
  engine_version = "10.7"
  engine_mode = "serverless"

  database_name = "battleship"
  master_username = "battleship"
  master_password = random_password.pg.result
  skip_final_snapshot = true

  enable_http_endpoint = true

  scaling_configuration {
    auto_pause = true
    min_capacity = 2
    max_capacity = 2
    seconds_until_auto_pause = 300
  }
}

resource "aws_secretsmanager_secret" pg {
  name = "battleship_rds_pass"
}
resource "aws_secretsmanager_secret_version" pg {
  secret_id = aws_secretsmanager_secret.pg.id
  secret_string = jsonencode({
    username: aws_rds_cluster.pg.master_username,
    password: random_password.pg.result
  })
}

