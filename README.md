# Dependencies

Node v12
Yarn v1.22
Terraform v0.13
AWS cli v2

# Setup

```shell script
(cd client && yarn install)
(cd lambda && yarn install)
(cd terraform && terraform init)
```

# Compile And Deploy
```shell script
(cd client && yarn assemble)
(cd lambda && yarn assemble)

# This will take ~5 minutes the first time. The hosted URL will be listed upon completion.
(cd terraform && terraform apply)

(cd schema && bash run.sh define-schema.sql)
```

# Dev Cycle

```shell script
# Terminal 1 - keep running to auto compile changes
cd client && yarn dev

# Terminal 2 - keep running to auto compile changes
cd lambda && yarn dev

# Terminal 3 - run to publish changes
cd terraform
terraform apply
```
