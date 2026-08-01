import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { DatabaseConfig } from '../config/environments';

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  config: DatabaseConfig;
}

/**
 * Database Stack - Aurora PostgreSQL Serverless v2
 */
export class DatabaseStack extends cdk.Stack {
  /** Port Aurora PostgreSQL listens on. */
  public static readonly PORT = 5432;

  public readonly database: rds.DatabaseCluster;
  public readonly secret: secretsmanager.ISecret;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Security Group for database
    this.securityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Aurora database',
      allowAllOutbound: false,
    });

    // Database credentials
    this.secret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: `${id}/aurora/credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'dbadmin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // Aurora Serverless v2 cluster
    this.database = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      credentials: rds.Credentials.fromSecret(this.secret),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.securityGroup],

      // Serverless v2 configuration
      serverlessV2MinCapacity: props.config.minCapacity,
      serverlessV2MaxCapacity: props.config.maxCapacity,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        publiclyAccessible: false,
      }),
      readers: props.config.multiAz
        ? [
            rds.ClusterInstance.serverlessV2('Reader1', {
              scaleWithWriter: true,
            }),
          ]
        : [],

      // Backup and maintenance
      backup: {
        retention: cdk.Duration.days(props.config.backupRetention),
      },
      deletionProtection: props.config.backupRetention > 7, // Protect prod
      removalPolicy:
        props.config.backupRetention > 7
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,

      // Monitoring
      cloudwatchLogsExports: ['postgresql'],
      monitoringInterval: cdk.Duration.seconds(60),
    });

    // Outputs
    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.database.clusterEndpoint.hostname,
      description: 'Database cluster endpoint',
      exportName: `${id}-ClusterEndpoint`,
    });

    new cdk.CfnOutput(this, 'SecretArn', {
      value: this.secret.secretArn,
      description: 'Database credentials secret ARN',
      exportName: `${id}-SecretArn`,
    });

    new cdk.CfnOutput(this, 'SecurityGroupId', {
      value: this.securityGroup.securityGroupId,
      description: 'Database security group ID',
      exportName: `${id}-SecurityGroupId`,
    });
  }
}
