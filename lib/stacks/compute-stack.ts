import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EcsConfig } from '../config/environments';

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  config: EcsConfig;

  /**
   * Database connection details, passed as plain values rather than as the
   * DatabaseStack's constructs.
   *
   * Handing the whole `rds.DatabaseCluster` across and calling
   * `database.connections.allowFrom(service, ...)` reads naturally but is a
   * dependency cycle: the ingress rule lands on the database's security group,
   * which lives in DatabaseStack, and references this stack's service security
   * group. DatabaseStack then depends on ComputeStack while ComputeStack
   * already depends on DatabaseStack, and `cdk synth` fails with
   * «DependencyCycle».
   *
   * Passing IDs keeps the dependency one-directional: this stack imports the
   * database security group and creates the ingress rule on its own side.
   */
  databaseSecurityGroupId: string;
  databaseEndpoint: string;
  databasePort: number;
  databaseSecretArn: string;
}

/**
 * Compute Stack - ECS Fargate Service with ALB
 */
export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs_patterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      enableFargateCapacityProviders: true,
    });

    // The credentials secret created by DatabaseStack. Imported by ARN so this
    // stack does not need the DatabaseStack construct itself.
    const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'DbSecret',
      props.databaseSecretArn
    );

    // Fargate Service with ALB
    this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      'Service',
      {
        cluster: this.cluster,
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
          containerPort: 80,
          environment: {
            NODE_ENV: 'production',
            DB_HOST: props.databaseEndpoint,
            DB_PORT: String(props.databasePort),
          },
          // Injected at task start from Secrets Manager, so the values never
          // appear in the task definition or in CloudFormation.
          secrets: {
            DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
            DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
          },
        },
        cpu: props.config.cpu,
        memoryLimitMiB: props.config.memory,
        desiredCount: props.config.desiredCount,
        publicLoadBalancer: true,

        // Capacity providers
        capacityProviderStrategies: props.config.useFargateSpot
          ? [
              { capacityProvider: 'FARGATE_SPOT', weight: 80 },
              { capacityProvider: 'FARGATE', weight: 20 },
            ]
          : [{ capacityProvider: 'FARGATE', weight: 100 }],

        // Health check
        healthCheckGracePeriod: cdk.Duration.seconds(60),

        // Circuit breaker
        circuitBreaker: { rollback: true },
      }
    );

    // Auto-scaling
    const scaling = this.service.service.autoScaleTaskCount({
      minCapacity: props.config.minCapacity,
      maxCapacity: props.config.maxCapacity,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Allow ECS to reach the database.
    //
    // The security group is imported as mutable, so the ingress rule is
    // rendered into *this* stack rather than into DatabaseStack. That is what
    // keeps the dependency one-directional — see ComputeStackProps.
    const databaseSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'DbSecurityGroup',
      props.databaseSecurityGroupId,
      { mutable: true }
    );

    this.service.service.connections.allowTo(
      databaseSecurityGroup,
      ec2.Port.tcp(props.databasePort),
      'Allow ECS to access Aurora'
    );

    // Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: this.service.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS',
      exportName: `${id}-AlbDns`,
    });

    new cdk.CfnOutput(this, 'ServiceUrl', {
      value: `http://${this.service.loadBalancer.loadBalancerDnsName}`,
      description: 'Service URL',
    });
  }
}
