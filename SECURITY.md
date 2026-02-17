# Security

## Reporting Security Issues

If you discover a potential security issue in this project, please notify AWS Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). 

**Please do not create a public GitHub issue.**

## Known Dependencies with Advisories

This project uses the following dependencies with known advisories. We've evaluated these and determined they do not pose a risk in our usage:

### Development Dependencies (Not in Production)

- **esbuild** (<=0.24.2) - Moderate severity
  - Advisory: GHSA-67mh-4wv8-2f99
  - Impact: Development server vulnerability
  - Mitigation: Only used during local development, not in production builds
  - Status: Monitoring for updates

- **vite** (0.11.0 - 6.1.6) - Depends on vulnerable esbuild
  - Impact: Development server vulnerability
  - Mitigation: Only used during local development, not in production builds
  - Status: Monitoring for updates

### Production Dependencies

All production dependencies have been reviewed and updated to address known vulnerabilities. The project uses `xlsx-js-style` for Excel export functionality, which is actively maintained and does not have the vulnerabilities present in the original `xlsx` package.

## Security Best Practices

This project implements comprehensive security measures:

### Authentication & Authorization
1. **Amazon Cognito User Pool** - Email-based authentication with email verification
2. **Strong Password Policy** - 8+ characters, mixed case, digits, symbols required
3. **Cognito Authorizer** - JWT validation on all API Gateway endpoints
4. **User Groups** - Admin and Users groups for role-based access control
5. **Token Security** - 8-hour token validity with secure session management

### Web Application Firewall (WAF)
6. **API Gateway WAF** - Regional WAF created but not currently associated with API Gateway due to CloudFormation timing constraints. API is still protected by Cognito authorization, input validation, CORS restrictions, and API Gateway throttling. Uncomment the association in `citation-analysis-stack.ts` to enable.
7. **CloudFront WAF** - CloudFront-scoped WAF (us-east-1) with managed rules
8. **Cognito User Pool WAF** - Additional WAF protection for authentication endpoints
9. **Rate Limiting** - 1000-3000 requests per 5 minutes per IP across all WAFs

### XSS & Injection Protection
10. **DOMPurify Sanitization** - All HTML content sanitized before rendering
11. **Content Security Policy** - Strict CSP headers via CloudFront response policy
12. **Input Validation** - Comprehensive validation framework with length limits
13. **Parameterized Queries** - DynamoDB queries use parameterization (no injection risk)
14. **Sort Field Sanitization** - Only alphanumeric and underscore allowed

### Security Headers
15. **X-Frame-Options: DENY** - Clickjacking protection
16. **X-Content-Type-Options: nosniff** - MIME sniffing protection
17. **Referrer-Policy** - Strict origin when cross-origin
18. **Strict-Transport-Security** - HSTS with 1-year max-age
19. **X-XSS-Protection** - Browser XSS filter enabled

### Network Security
20. **HTTPS Enforcement** - CloudFront redirects HTTP to HTTPS
21. **CORS Restrictions** - Origin validation in Lambda functions
22. **API Gateway Throttling** - 100 req/sec, 200 burst limit
23. **CloudFront OAC** - Origin Access Control for S3 (not public)

### Data Protection
24. **Secrets Manager** - API keys stored securely with 5-minute cache TTL
25. **DynamoDB Encryption** - AWS-managed encryption at rest on all tables
26. **S3 Encryption** - S3-managed encryption on all buckets
27. **S3 Versioning** - Enabled on critical buckets for data recovery
28. **Point-in-Time Recovery** - Enabled on all DynamoDB tables
29. **Access Logging** - S3 access logs for audit trail (90-day retention)

### IAM & Permissions
30. **Least Privilege** - Lambda roles scoped to specific resources
31. **Resource Scoping** - Permissions limited to `CitationAnalysis-*` patterns
32. **Bedrock Scoping** - Limited to specific Claude model ARNs
33. **Minimal Wildcard Permissions** - Wildcards used only where required: `scheduler:ListSchedules` (read-only, requires wildcard), `bedrock-agentcore:*` (service does not yet document granular permissions for browser WebSocket streams), and `bedrock:InvokeAgent`/`bedrock:GetAgent` (AgentCore browser sessions require wildcard resources)

### Logging & Monitoring
34. **API Gateway Logging** - All requests logged to CloudWatch
35. **Lambda Logging** - Structured logging with security events
36. **WAF Logging** - Blocked requests tracked in CloudWatch metrics
37. **Error Sanitization** - Internal errors logged server-side only

### Secrets Management
38. **No Hardcoded Credentials** - All API keys in Secrets Manager
39. **Runtime Retrieval** - Secrets fetched at Lambda invocation
40. **Secret Rotation Support** - Keys can be updated without redeployment
41. **Fail-Secure CORS** - Returns empty string if SSM parameter unavailable

## Dependency Updates

We regularly monitor dependencies for security updates. To update dependencies:

```bash
# Update Node.js dependencies
npm update
cd web && npm update

# Update Python dependencies
pip3 install --upgrade -r lambda/layer/requirements.txt
```

## Cognito Authentication Configuration

### User Sign-Up
- **Self-sign-up enabled**: Users can create accounts without admin approval
- **Email required**: Email address is the username (not a separate username field)
- **Email verification**: Users must verify email before accessing the dashboard
- **Password requirements**: 8+ characters, uppercase, lowercase, digits, symbols
- **Account recovery**: Email-only recovery (no SMS)

### Frontend UI
- **Sign-up UI displayed**: No `hideSignUp` flag - users see "Create Account" option
- **Email field**: Cognito UI automatically shows email field (not username)
- **Clear labeling**: UI clearly indicates email address is required

### Token Security
- **Token validity**: 8 hours for access, ID, and refresh tokens
- **Secure transmission**: Tokens sent via Authorization header
- **JWT validation**: API Gateway validates tokens using Cognito authorizer
- **No localStorage**: Amplify manages tokens securely in session storage

## Security Review Checklist

Before deploying to production:

- [ ] All API keys stored in AWS Secrets Manager
- [ ] WAF rules configured and tested
- [ ] CORS origin restricted to your domain
- [ ] Cognito user pool configured with strong password policy
- [ ] CloudWatch logs enabled for audit trail
- [ ] S3 buckets have public access blocked
- [ ] IAM roles follow least privilege principle
- [ ] All dependencies reviewed for known vulnerabilities
