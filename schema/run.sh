#!/usr/bin/env bash
[[ -f "$1" ]] || {
  echo "Usage: [sql-file]"
  echo
  echo "Runs the given sql file against the remote DB"
}

echo "Finding db & password..."
db_arn="$(aws rds describe-db-clusters --db-cluster-identifier 'battleship' --query 'DBClusters[0].DBClusterArn' --output text)"
secret_arn="$(aws secretsmanager describe-secret --secret-id 'battleship_rds_pass' --query 'ARN' --output text)"

echo "Executing SQL in $1"
aws rds-data execute-statement \
  --continue-after-timeout \
  --database battleship \
  --include-result-metadata \
  --resource-arn "$db_arn" \
  --secret-arn "$secret_arn" \
  --sql "$(cat $1)"
