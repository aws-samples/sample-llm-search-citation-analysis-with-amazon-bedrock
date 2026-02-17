import { Duration } from "aws-cdk-lib";
import {
  AccountRecovery,
  ClientAttributes,
  FeaturePlan,
  UserPool,
  UserPoolClient,
  UserPoolGroup,
} from "aws-cdk-lib/aws-cognito";
import {
  IdentityPool, UserPoolAuthenticationProvider 
} from "aws-cdk-lib/aws-cognito-identitypool";
import {
  Effect, PolicyStatement 
} from "aws-cdk-lib/aws-iam";
import {
  CfnWebACL, CfnWebACLAssociation 
} from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

interface AuthProps {
  urls: string[];
  appUrl?: string;
}

export class Auth extends Construct {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly identityPool: IdentityPool;
  public readonly regionalWebAclArn: string;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    const { urls, appUrl } = props;
    // Use placeholder URL initially - will be updated after CloudFront creation
    const displayUrl = appUrl ?? "[Your deployment URL will be provided separately]";

    // Email templates for Cognito
    const emailTemplates = this.createEmailTemplates(displayUrl);

    // Create Cognito User Pool
    // Self-registration: set to true to allow users to sign up themselves,
    // or false to require admin invites (see README for details)
    const userPool = new UserPool(this, "userPool", {
      selfSignUpEnabled: false,
      signInAliases: {email: true,},
      autoVerify: {email: true,},
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireDigits: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      featurePlan: FeaturePlan.ESSENTIALS,
      userInvitation: {
        emailSubject: emailTemplates.invite.subject,
        emailBody: emailTemplates.invite.body,
      },
      userVerification: {
        emailSubject: emailTemplates.verification.subject,
        emailBody: emailTemplates.verification.body,
      },
    });

    // Create user groups
    new UserPoolGroup(this, "adminUserPoolGroup", {
      userPool,
      groupName: "Admin",
    });

    new UserPoolGroup(this, "usersUserPoolGroup", {
      userPool,
      groupName: "Users",
    });

    // Create User Pool Client
    const tokenValidity = Duration.hours(8);
    const userPoolClient = new UserPoolClient(this, "userPoolClient", {
      userPool,
      generateSecret: false,
      refreshTokenValidity: tokenValidity,
      accessTokenValidity: tokenValidity,
      idTokenValidity: tokenValidity,
      readAttributes: new ClientAttributes().withStandardAttributes({email: true,}),
      authFlows: {
        adminUserPassword: true,
        custom: true,
        userSrp: true,
      },
      oAuth: {
        callbackUrls: urls,
        logoutUrls: urls,
      },
    });

    // Create Identity Pool
    const identityPool = new IdentityPool(this, "identityPool", {
      allowUnauthenticatedIdentities: false,
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({
            userPool,
            userPoolClient,
          }),
        ],
      },
    });
        
    // Deny all actions for unauthenticated role
    identityPool.unauthenticatedRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ["*"],
        resources: ["*"],
      })
    );

    // Create Regional WAF for User Pool
    const regionalWebAcl = new CfnWebACL(this, "regionalWebAcl", {
      defaultAction: { allow: {} },
      scope: "REGIONAL",
      visibilityConfig: {
        metricName: "regionalWebAcl",
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
      },
      rules: [
        {
          name: "ipRateLimitingRule",
          priority: 0,
          statement: {
            rateBasedStatement: {
              limit: 3000,
              aggregateKeyType: "IP",
            },
          },
          action: {block: {},},
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "ipRateLimitingRule",
          },
        },
        ...this.createManagedRules("regional", 1, [
          {
            name: "AWSManagedRulesCommonRuleSet",
            overrideAction: {count: {},},
          },
          {
            name: "AWSManagedRulesBotControlRuleSet",
            overrideAction: {count: {},},
          },
          {name: "AWSManagedRulesKnownBadInputsRuleSet",},
          {
            name: "AWSManagedRulesUnixRuleSet",
            ruleActionOverrides: [
              {
                name: "UNIXShellCommandsVariables_BODY",
                actionToUse: {count: {},},
              },
            ],
          },
          {
            name: "AWSManagedRulesSQLiRuleSet",
            ruleActionOverrides: [
              {
                name: "SQLi_BODY",
                actionToUse: {count: {},},
              },
            ],
          },
        ]),
      ],
    });
    const regionalWebAclArn = regionalWebAcl.attrArn;

    // Associate WAF with User Pool
    new CfnWebACLAssociation(this, "userPoolWebAclAssociation", {
      resourceArn: userPool.userPoolArn,
      webAclArn: regionalWebAclArn,
    });

    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.identityPool = identityPool;
    this.regionalWebAclArn = regionalWebAclArn;
  }

  /**
   * Update email templates with the actual CloudFront URL after distribution is created
   */
  public updateEmailTemplatesWithUrl(appUrl: string): void {
    const emailTemplates = this.createEmailTemplates(appUrl);
    
    const cfnUserPool = this.userPool.node.defaultChild as import("aws-cdk-lib/aws-cognito").CfnUserPool;
    
    // Update invite email (for admin-created users)
    cfnUserPool.addPropertyOverride("AdminCreateUserConfig.InviteMessageTemplate", {
      EmailSubject: emailTemplates.invite.subject,
      EmailMessage: emailTemplates.invite.body,
    });
    
    // Update verification email (for self-signup)
    cfnUserPool.addPropertyOverride("VerificationMessageTemplate", {
      DefaultEmailOption: "CONFIRM_WITH_CODE",
      EmailMessage: emailTemplates.verification.body,
      EmailSubject: emailTemplates.verification.subject,
    });
  }

  /**
   * Create branded email templates for Cognito
   */
  /**
     * Create branded HTML email templates for Cognito.
     * Styled to match the Citation Analysis web dashboard UI.
     */
  private createEmailTemplates(appUrl: string) {
    const emailShell = (content: string) => `<!DOCTYPE html>
  <html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
  <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <!-- Header -->
  <tr><td style="background-color:#111827;padding:24px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="width:36px;height:36px;background-color:#ffffff;border-radius:8px;text-align:center;vertical-align:middle;">
  <span style="font-size:18px;line-height:36px;color:#111827;">&#9636;</span>
  </td>
  <td style="padding-left:12px;font-size:18px;font-weight:600;color:#ffffff;">Citation Analysis</td>
  </tr></table>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:32px;">
  ${content}
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center;">
  <p style="margin:0;font-size:12px;color:#9ca3af;">This is an AWS sample application for AI citation analysis.</p>
  </td></tr>
  </table>
  </td></tr>
  </table>
  </body>
  </html>`;

    return {
      invite: {
        subject: "Welcome to Citation Analysis",
        body: emailShell(`
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Welcome aboard</h1>
  <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Your account has been created. Sign in with your email and the temporary password below, then set a new password on first login.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr><td style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;text-align:center;">
  <p style="margin:0 0 4px;font-size:12px;font-weight:500;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Your temporary password</p>
  <p style="margin:0;font-size:28px;font-weight:700;color:#111827;letter-spacing:0.1em;font-family:'Courier New',monospace;">{####}</p>
  </td></tr>
  </table>
  <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Username</p>
  <p style="margin:0 0 24px;font-size:14px;font-weight:500;color:#111827;">{username}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr><td style="background-color:#2563eb;border-radius:8px;">
  <a href="${appUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;">Open Dashboard</a>
  </td></tr>
  </table>
  <p style="margin:0;font-size:12px;color:#9ca3af;">Or visit: <a href="${appUrl}" style="color:#2563eb;text-decoration:none;">${appUrl}</a></p>`),
      },
      verification: {
        subject: "Verify your email — Citation Analysis",
        body: emailShell(`
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Verify your email</h1>
  <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Enter this code in the app to complete your sign-up.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr><td style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px;text-align:center;">
  <p style="margin:0 0 4px;font-size:12px;font-weight:500;color:#3b82f6;text-transform:uppercase;letter-spacing:0.05em;">Verification code</p>
  <p style="margin:0;font-size:32px;font-weight:700;color:#1e40af;letter-spacing:0.15em;font-family:'Courier New',monospace;">{####}</p>
  </td></tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr><td style="background-color:#2563eb;border-radius:8px;">
  <a href="${appUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;">Open Dashboard</a>
  </td></tr>
  </table>
  <p style="margin:0;font-size:12px;color:#9ca3af;">If you didn't create an account, you can safely ignore this email.</p>`),
      },
      passwordReset: {
        subject: "Reset your password — Citation Analysis",
        body: emailShell(`
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Reset your password</h1>
  <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Use this code to set a new password for your account.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr><td style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:20px;text-align:center;">
  <p style="margin:0 0 4px;font-size:12px;font-weight:500;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">Password reset code</p>
  <p style="margin:0;font-size:32px;font-weight:700;color:#78350f;letter-spacing:0.15em;font-family:'Courier New',monospace;">{####}</p>
  </td></tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr><td style="background-color:#2563eb;border-radius:8px;">
  <a href="${appUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;">Open Dashboard</a>
  </td></tr>
  </table>
  <p style="margin:0;font-size:12px;color:#9ca3af;">If you didn't request this, you can safely ignore this email.</p>`),
      },
    };
  }

  // Inlined createManagedRules helper from demo-starter-kit
  private createManagedRules(
    prefix: string,
    startingPriority: number,
    rules: {
      name: string;
      overrideAction?: CfnWebACL.OverrideActionProperty;
      ruleActionOverrides?: CfnWebACL.RuleActionOverrideProperty[];
    }[]
  ): CfnWebACL.RuleProperty[] {
    return rules.map((rule, index) => {
      const ruleName = `${prefix}-${rule.name}`;
      return {
        name: ruleName,
        priority: startingPriority + index,
        overrideAction: rule.overrideAction ?? {none: {},},
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: rule.name,
            ruleActionOverrides: rule.ruleActionOverrides,
          },
        },
        visibilityConfig: {
          metricName: ruleName,
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
        },
      };
    });
  }
}
