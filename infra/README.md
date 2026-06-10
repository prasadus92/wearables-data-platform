# Infrastructure

Terraform for the full AWS stack (eu-central-1): ECS Fargate API and worker,
TimescaleDB on RDS, ElastiCache Redis, ALB with ACM cert, SSM secrets, S3 +
CloudFront web hosting, and the GitHub Actions deploy role. State is local
(demo scope).

## Deploying

Manual deploy from a workstation:

```sh
AWS_PROFILE=luminik ./infra/deploy.sh          # image build + push + service roll
APPLY=1 AWS_PROFILE=luminik ./infra/deploy.sh  # terraform apply first
```

## CI/CD pipeline

`.github/workflows/deploy.yml` runs on every push to main:

- **backend**: builds the backend Docker image, pushes it to ECR, forces a new
  deployment of the `api` and `worker` ECS services, and waits for them to
  stabilize. This is the non-terraform half of `infra/deploy.sh`.
- **web**: builds the SPA (`npm ci && npm run build`) with
  `VITE_API_URL=https://api.youth.luminik.io` and no `VITE_API_KEY`, so the
  public bundle never contains the service key (browser sessions authenticate
  with Clerk JWTs). The build is synced to the web S3 bucket and the
  CloudFront distribution is invalidated.

Auth is GitHub OIDC: the workflow assumes the IAM role from
`terraform/cicd.tf`, which only trusts pushes to main of
`prasadus92/youth-wearables`. No AWS keys are stored in GitHub.

Web hosting (`terraform/web_hosting.tf`) is a private S3 bucket behind
CloudFront with Origin Access Control. 403/404 fall back to `/index.html`
with a 200 so client-side routes like `/metrics/*` deep-link correctly. The
site uses the default `*.cloudfront.net` certificate; `terraform output
web_url` prints the public URL.

## One-time setup

1. Apply the infrastructure (creates bucket, distribution, OIDC provider,
   deploy role):

   ```sh
   APPLY=1 AWS_PROFILE=luminik ./infra/deploy.sh
   ```

2. Set the GitHub repository variables from the terraform outputs:

   ```sh
   gh variable set AWS_ROLE_ARN --body "$(terraform -chdir=infra/terraform output -raw github_actions_role_arn)"
   gh variable set WEB_BUCKET --body "$(terraform -chdir=infra/terraform output -raw web_bucket)"
   gh variable set CF_DISTRIBUTION_ID --body "$(terraform -chdir=infra/terraform output -raw web_distribution_id)"
   gh variable set VITE_CLERK_PUBLISHABLE_KEY --body "pk_..."  # from web/.env.local
   ```

3. Clerk dashboard: add the CloudFront URL (`terraform output web_url`) to
   the instance's allowed origins so sign-in works from the hosted site.
